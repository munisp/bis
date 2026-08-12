with open('/home/ubuntu/bis-pwa/scripts/migrate_tidb.py', 'r') as f:
    content = f.read()

# Find and replace the cast removal line
old = r"""    sql = re.sub(r"::(\\w+)(\\[\\])?(?=[,\\s\\n\\)])", '', sql)"""
new = r"""    sql = re.sub(r"::(\\w+)(\\[\\])?", "", sql)"""

if old in content:
    content = content.replace(old, new, 1)
    with open('/home/ubuntu/bis-pwa/scripts/migrate_tidb.py', 'w') as f:
        f.write(content)
    print("FIXED")
else:
    # Show what's on line 106
    lines = content.split('\n')
    print("NOT FOUND. Line 106:", repr(lines[105]))
    # Try a broader replacement
    import re
    content2 = re.sub(
        r'sql = re\.sub\(r"::.*?lookahead.*?"\)', 
        'sql = re.sub(r"::(\\\\w+)(\\\\[\\\\])?", "", sql)',
        content
    )
    if content2 != content:
        with open('/home/ubuntu/bis-pwa/scripts/migrate_tidb.py', 'w') as f:
            f.write(content2)
        print("FIXED via broad regex")
    else:
        print("Could not fix automatically")
