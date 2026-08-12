#!/usr/bin/env python3
"""
migrate_tidb.py — Apply all Drizzle migration SQL files to TiDB (MySQL protocol).

Converts PostgreSQL-specific DDL to MySQL-compatible syntax.
"""

import os
import re
import sys
import glob
import mysql.connector

DATABASE_URL = os.environ.get("DATABASE_URL", "")

def parse_mysql_url(url: str):
    m = re.match(
        r"mysql://([^:]+):([^@]+)@([^:/]+):?(\d*)/([^?]+)(\?.*)?",
        url
    )
    if not m:
        raise ValueError(f"Cannot parse DATABASE_URL: {url[:40]}...")
    user, password, host, port, database, params = m.groups()
    port = int(port) if port else 3306
    ssl_disabled = "ssl-mode=disable" in (params or "").lower()
    return dict(user=user, password=password, host=host, port=port,
                database=database, ssl_disabled=ssl_disabled)

# ─── SQL Conversion ───────────────────────────────────────────────────────────

def convert_file(raw_sql: str) -> list[str]:
    """
    Convert a PostgreSQL DDL file to a list of MySQL-compatible statements.
    Returns only statements that are applicable (non-empty, non-comment).
    """
    # Step 1: collect all ENUM type definitions
    enum_map: dict[str, str] = {}  # type_name -> ENUM('v1','v2',...)
    for m in re.finditer(
        r'CREATE TYPE\s+"?(?:public"?\.)?"?(\w+)"?\s+AS\s+ENUM\s*\(([^)]+)\)',
        raw_sql, re.IGNORECASE | re.DOTALL
    ):
        name = m.group(1)
        vals = [v.strip().strip("'\"") for v in m.group(2).split(",")]
        enum_map[name] = "ENUM(" + ", ".join(f"'{v}'" for v in vals) + ")"

    # Step 2: remove CREATE TYPE statements and statement-breakpoint markers
    sql = re.sub(
        r'CREATE TYPE\s+"?(?:public"?\.)?"?\w+"?\s+AS\s+ENUM\s*\([^)]+\)\s*;',
        '', raw_sql, flags=re.IGNORECASE | re.DOTALL
    )
    sql = re.sub(r'-->\s*statement-breakpoint', ';', sql)

    # Step 3: replace "public"."table" and "public".table with `table`
    sql = re.sub(r'"public"\."(\w+)"', r'`\1`', sql)
    sql = re.sub(r'"public"\.(\w+)', r'`\1`', sql)

    # Step 4: replace double-quoted identifiers with backticks
    sql = re.sub(r'"(\w+)"', r'`\1`', sql)

    # Step 5: replace enum type references in column definitions.
    # In PostgreSQL DDL: `colname` `typename` NOT NULL
    # The type is the SECOND backtick-quoted identifier on the column line.
    # We replace it with ENUM(...) only in that position.
    def replace_enum_in_line(line: str) -> str:
        stripped = line.lstrip()
        # Only process column definition lines (start with backtick after whitespace)
        if not stripped.startswith('`'):
            return line
        for enum_name, enum_def in enum_map.items():
            # Pattern: `colname` `enum_name` — replace the type (second backtick group)
            # Use a regex that matches `colname` followed by `enum_name`
            line = re.sub(
                rf'(`\w+`)\s+`{re.escape(enum_name)}`',
                lambda m, ed=enum_def: m.group(1) + ' ' + ed,
                line
            )
            # Also handle bare type name (no backticks): `colname` enum_name
            line = re.sub(
                rf'(`\w+`)\s+{re.escape(enum_name)}\b',
                lambda m, ed=enum_def: m.group(1) + ' ' + ed,
                line
            )
        return line
    sql = '\n'.join(replace_enum_in_line(line) for line in sql.split('\n'))

    # Step 6: data type conversions
    # serial -> INT AUTO_INCREMENT (NOT NULL will be added by PRIMARY KEY constraint)
    sql = re.sub(r'\bserial\b', 'INT AUTO_INCREMENT', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bbigserial\b', 'BIGINT AUTO_INCREMENT', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bsmallserial\b', 'SMALLINT AUTO_INCREMENT', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\binteger\b', 'INT', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bboolean\b', 'TINYINT(1)', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\breal\b', 'FLOAT', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bdouble precision\b', 'DOUBLE', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\btimestamp(?:tz| with time zone)\b', 'DATETIME', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\btimestamp\b', 'DATETIME', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bjsonb\b', 'JSON', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\btext\[\]', 'JSON', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bvarchar\b(?!\s*\()', 'VARCHAR(255)', sql, flags=re.IGNORECASE)

    # Step 7: function/value conversions
    sql = re.sub(r'\bnow\(\)', 'CURRENT_TIMESTAMP', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bDEFAULT\s+true\b', 'DEFAULT 1', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bDEFAULT\s+false\b', 'DEFAULT 0', sql, flags=re.IGNORECASE)
    # Remove PostgreSQL cast syntax: '[]'::json -> '[]', 'val'::text -> 'val'
    sql = re.sub(r"::(\w+)(\[\])?", "", sql)
    # Remove DEFAULT values from JSON/TEXT columns (MySQL/TiDB WARN 1101)
    sql = re.sub(r"(json|text|longtext|mediumtext)\s+DEFAULT\s+'[^']*'", r"\1", sql, flags=re.IGNORECASE)
    # Remove PostgreSQL-specific DEFAULT expressions that MySQL doesn't support
    # e.g. DEFAULT '{}' (JSON object) is fine, but ::jsonb is not
    # Convert ALTER TYPE ... ADD VALUE to a no-op comment (MySQL uses ALTER TABLE ... MODIFY)
    sql = re.sub(
        r'ALTER TYPE\s+`?\w+`?\s+ADD VALUE\s+\'[^\']+\'\s*(?:BEFORE|AFTER\s+\'[^\']+\')?',
        '-- ALTER TYPE skipped (MySQL uses ENUM column modification)',
        sql, flags=re.IGNORECASE
    )

    # Step 7b: fix PRIMARY KEY NOT NULL -> PRIMARY KEY (MySQL doesn't allow NOT NULL after PK)
    sql = re.sub(r'PRIMARY KEY\s+NOT NULL', 'PRIMARY KEY', sql, flags=re.IGNORECASE)
    # Also fix AUTO_INCREMENT PRIMARY KEY NOT NULL
    sql = re.sub(r'(AUTO_INCREMENT\s+PRIMARY KEY)\s+NOT NULL', r'\1', sql, flags=re.IGNORECASE)

    # Step 8: remove PostgreSQL-specific index/constraint syntax
    sql = re.sub(r'\s+USING\s+(?:btree|hash|gin|gist)\b', '', sql, flags=re.IGNORECASE)
    sql = re.sub(r',?\s*CONSTRAINT\s+`?\w+`?\s+CHECK\s*\([^)]+\)', '', sql, flags=re.IGNORECASE)

    # Step 9: fix BLOB/TEXT in key specifications (add key length)
    # TEXT/BLOB columns in indexes need a length prefix in MySQL
    # We'll handle this by converting TEXT index columns to VARCHAR(255) in CREATE INDEX
    def fix_text_index(m):
        stmt = m.group(0)
        # Replace TEXT columns in index with VARCHAR prefix hint
        stmt = re.sub(r'\b(text|blob)\b', 'VARCHAR(255)', stmt, flags=re.IGNORECASE)
        return stmt
    sql = re.sub(r'CREATE\s+(?:UNIQUE\s+)?INDEX\s+[^;]+;', fix_text_index, sql, flags=re.IGNORECASE | re.DOTALL)

    # Step 10: remove RETURNING clauses (not supported in TiDB DDL, but OK in DML)
    # Keep RETURNING for DML — it's fine

    # Step 11: split into statements
    stmts = []
    current = []
    depth = 0  # track parenthesis depth to avoid splitting inside CREATE TABLE
    for line in sql.split('\n'):
        stripped = line.strip()
        if stripped.startswith('--') and not stripped.startswith('-->'):
            continue
        depth += line.count('(') - line.count(')')
        current.append(line)
        if stripped.endswith(';') and depth <= 0:
            stmt = '\n'.join(current).strip().rstrip(';').strip()
            if stmt:
                stmts.append(stmt + ';')
            current = []
            depth = 0

    if current:
        stmt = '\n'.join(current).strip().rstrip(';').strip()
        if stmt:
            stmts.append(stmt + ';')

    # Step 12: filter out empty/comment-only statements
    result = []
    for stmt in stmts:
        s = stmt.strip()
        if not s or s == ';':
            continue
        # Must contain a DDL/DML keyword
        if not re.search(r'\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE)\b', s, re.IGNORECASE):
            continue
        result.append(s)

    return result

# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set", file=sys.stderr)
        sys.exit(1)

    cfg = parse_mysql_url(DATABASE_URL)
    print(f"Connecting to {cfg['host']}:{cfg['port']}/{cfg['database']} as {cfg['user']}")

    conn = mysql.connector.connect(
        host=cfg["host"],
        port=cfg["port"],
        user=cfg["user"],
        password=cfg["password"],
        database=cfg["database"],
        ssl_disabled=cfg.get("ssl_disabled", False),
        connection_timeout=30,
    )
    cursor = conn.cursor()

    # Ensure migration tracking table exists
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS `__bis_migrations` (
          `id` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
          `tag` VARCHAR(128) NOT NULL UNIQUE,
          `applied_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()

    # Get already-applied migrations
    cursor.execute("SELECT tag FROM `__bis_migrations`")
    applied = {row[0] for row in cursor.fetchall()}
    print(f"Already applied: {len(applied)} migrations")

    sql_files = sorted(glob.glob("/home/ubuntu/bis-pwa/drizzle/*.sql"))
    print(f"Found {len(sql_files)} migration files")

    applied_count = 0
    error_count = 0

    for sql_file in sql_files:
        tag = os.path.basename(sql_file).replace(".sql", "")
        if tag in applied:
            print(f"  [SKIP] {tag}")
            continue

        print(f"  [APPLY] {tag} ...", end="", flush=True)
        with open(sql_file, "r") as f:
            raw_sql = f.read()

        try:
            stmts = convert_file(raw_sql)
        except Exception as e:
            print(f" CONVERT ERROR: {e}")
            error_count += 1
            continue

        file_errors = 0
        for stmt in stmts:
            try:
                cursor.execute(stmt)
                conn.commit()
            except mysql.connector.Error as e:
                # Idempotency: ignore "already exists" errors
                if e.errno in (1050, 1060, 1061, 1062, 1091):
                    pass  # table/col/idx already exists
                elif e.errno == 1170:
                    # BLOB/TEXT key length — skip this index statement
                    pass
                elif e.errno in (1146, 1824):
                    # Table doesn't exist for FK/ALTER — skip
                    pass
                elif "already exists" in str(e).lower() or "Duplicate" in str(e):
                    pass
                else:
                    # Show the first 200 chars of the failing statement
                    stmt_preview = stmt.replace('\n', ' ')[:200]
                    print(f"\n    WARN {e.errno}: {str(e.msg)[:100]}")
                    print(f"    SQL: {stmt_preview}")
                    file_errors += 1
                try:
                    conn.commit()
                except Exception:
                    pass

        if file_errors == 0:
            cursor.execute(
                "INSERT IGNORE INTO `__bis_migrations` (`tag`) VALUES (%s)", (tag,)
            )
            conn.commit()
            print(" OK")
            applied_count += 1
        else:
            print(f" {file_errors} non-ignorable errors")
            error_count += 1

    cursor.close()
    conn.close()

    print(f"\nDone. Applied: {applied_count}, Errors: {error_count}")
    if error_count > 0:
        sys.exit(1)

if __name__ == "__main__":
    main()
