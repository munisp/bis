-- BIS Platform — PostgreSQL Initialization Script
-- Runs once when the PostgreSQL container is first created.
-- Sets up extensions, roles, schemas, and baseline configuration.

-- ─── Extensions ───────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";       -- uuid_generate_v4()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- crypt(), gen_salt(), digest()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";         -- trigram indexes for ILIKE search
CREATE EXTENSION IF NOT EXISTS "btree_gin";       -- GIN indexes on scalar types
CREATE EXTENSION IF NOT EXISTS "unaccent";        -- accent-insensitive search
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- query performance monitoring

-- ─── Roles ────────────────────────────────────────────────────────────────────
-- Application role (used by the BFF and microservices)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bis_app') THEN
    CREATE ROLE bis_app WITH LOGIN PASSWORD 'bis_app_dev_password' NOINHERIT;
  END IF;
END
$$;

-- Read-only role (used by analytics / reporting services)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bis_readonly') THEN
    CREATE ROLE bis_readonly WITH LOGIN PASSWORD 'bis_readonly_dev_password' NOINHERIT;
  END IF;
END
$$;

-- ─── Schema ───────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS bis;
CREATE SCHEMA IF NOT EXISTS audit;
CREATE SCHEMA IF NOT EXISTS analytics;

-- Grant schema usage
GRANT USAGE ON SCHEMA bis TO bis_app, bis_readonly;
GRANT USAGE ON SCHEMA audit TO bis_app, bis_readonly;
GRANT USAGE ON SCHEMA analytics TO bis_readonly;

-- ─── Default privileges ───────────────────────────────────────────────────────
-- bis_app: full DML on bis schema
ALTER DEFAULT PRIVILEGES IN SCHEMA bis
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bis_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA bis
  GRANT USAGE, SELECT ON SEQUENCES TO bis_app;

-- bis_readonly: SELECT only
ALTER DEFAULT PRIVILEGES IN SCHEMA bis
  GRANT SELECT ON TABLES TO bis_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT SELECT ON TABLES TO bis_readonly;

-- ─── Connection limits ────────────────────────────────────────────────────────
ALTER ROLE bis_app CONNECTION LIMIT 50;
ALTER ROLE bis_readonly CONNECTION LIMIT 10;

-- ─── pg_stat_statements configuration ────────────────────────────────────────
-- Track all statements (not just top-level)
ALTER SYSTEM SET pg_stat_statements.track = 'all';
ALTER SYSTEM SET pg_stat_statements.max = 10000;

-- ─── Performance tuning ───────────────────────────────────────────────────────
-- These are conservative defaults for a 4GB RAM container.
-- Adjust based on actual hardware.
ALTER SYSTEM SET shared_buffers = '512MB';
ALTER SYSTEM SET effective_cache_size = '1536MB';
ALTER SYSTEM SET maintenance_work_mem = '128MB';
ALTER SYSTEM SET checkpoint_completion_target = '0.9';
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = '100';
ALTER SYSTEM SET random_page_cost = '1.1';         -- SSD storage
ALTER SYSTEM SET effective_io_concurrency = '200'; -- SSD
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET min_wal_size = '1GB';
ALTER SYSTEM SET max_wal_size = '4GB';
ALTER SYSTEM SET max_worker_processes = '8';
ALTER SYSTEM SET max_parallel_workers_per_gather = '4';
ALTER SYSTEM SET max_parallel_workers = '8';
ALTER SYSTEM SET max_parallel_maintenance_workers = '4';

-- ─── Logging ──────────────────────────────────────────────────────────────────
ALTER SYSTEM SET log_min_duration_statement = '1000'; -- log queries > 1s
ALTER SYSTEM SET log_checkpoints = 'on';
ALTER SYSTEM SET log_connections = 'on';
ALTER SYSTEM SET log_disconnections = 'on';
ALTER SYSTEM SET log_lock_waits = 'on';
ALTER SYSTEM SET log_temp_files = '0';
ALTER SYSTEM SET log_autovacuum_min_duration = '250ms';

-- ─── Security ─────────────────────────────────────────────────────────────────
-- Revoke CREATE on public schema from PUBLIC (PostgreSQL 14 default)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE bis FROM PUBLIC;
GRANT CONNECT ON DATABASE bis TO bis_app, bis_readonly;

-- ─── Audit schema tables ──────────────────────────────────────────────────────
-- Low-level DDL audit log (tracks schema changes)
CREATE TABLE IF NOT EXISTS audit.ddl_log (
  id          BIGSERIAL PRIMARY KEY,
  event_time  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_name   TEXT NOT NULL DEFAULT CURRENT_USER,
  command_tag TEXT NOT NULL,
  object_type TEXT,
  schema_name TEXT,
  object_name TEXT,
  query       TEXT
);

-- ─── Reload configuration ─────────────────────────────────────────────────────
SELECT pg_reload_conf();

-- ─── Verify extensions ────────────────────────────────────────────────────────
DO $$
DECLARE
  ext TEXT;
  required_exts TEXT[] := ARRAY['uuid-ossp', 'pgcrypto', 'pg_trgm', 'btree_gin', 'unaccent'];
BEGIN
  FOREACH ext IN ARRAY required_exts LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = ext) THEN
      RAISE WARNING 'Extension % is NOT installed', ext;
    ELSE
      RAISE NOTICE 'Extension % OK', ext;
    END IF;
  END LOOP;
END
$$;

-- ─── Seed: platform settings ──────────────────────────────────────────────────
-- These are inserted only if the table exists (created by Drizzle migrations).
-- The DO block is idempotent — safe to run multiple times.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'platform_settings') THEN
    INSERT INTO platform_settings (key, value, description, updated_at)
    VALUES
      ('platform_name',       '"BIS — Background Intelligence System"', 'Platform display name',          NOW()),
      ('platform_version',    '"1.0.0"',                                'Current platform version',       NOW()),
      ('max_file_upload_mb',  '50',                                     'Maximum file upload size in MB', NOW()),
      ('session_timeout_min', '480',                                    'Session timeout in minutes',     NOW()),
      ('mfa_required',        'false',                                  'Require MFA for all users',      NOW()),
      ('audit_retention_days','2555',                                   'Audit log retention (7 years)',  NOW()),
      ('aml_threshold_ngn',   '5000000',                                'AML reporting threshold (NGN)',  NOW()),
      ('str_deadline_days',   '3',                                      'STR filing deadline (business days)', NOW()),
      ('ctr_threshold_ngn',   '5000000',                                'CTR reporting threshold (NGN)',  NOW()),
      ('sandbox_mode',        'true',                                   'Enable sandbox/demo mode',       NOW())
    ON CONFLICT (key) DO NOTHING;
    RAISE NOTICE 'Platform settings seeded';
  END IF;
END
$$;
