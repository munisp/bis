-- Immutable manifest and idempotency state for cold Parquet archival.
-- PostgreSQL is the source of truth until a Parquet object and manifest are verified.

CREATE TABLE IF NOT EXISTS cold_archive_batches (
  id uuid PRIMARY KEY,
  schema_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('planned', 'uploading', 'verified', 'committed', 'failed', 'quarantined')),
  lower_created_at timestamptz,
  upper_created_at timestamptz NOT NULL,
  row_count integer NOT NULL CHECK (row_count > 0),
  object_key text NOT NULL UNIQUE,
  object_version_id text,
  sha256_hex char(64),
  byte_count bigint CHECK (byte_count IS NULL OR byte_count >= 0),
  source_query_fingerprint char(64) NOT NULL,
  manifest_key text,
  error_detail text,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_at timestamptz,
  verified_at timestamptz,
  committed_at timestamptz,
  CHECK (
    (status IN ('planned', 'uploading', 'failed', 'quarantined'))
    OR (sha256_hex IS NOT NULL AND byte_count IS NOT NULL AND manifest_key IS NOT NULL)
  )
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS cold_archive_batch_items (
  batch_id uuid NOT NULL REFERENCES cold_archive_batches(id) ON DELETE RESTRICT,
  transaction_id integer NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  PRIMARY KEY (batch_id, transaction_id),
  UNIQUE (transaction_id)
);
--> statement-breakpoint

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS "coldArchiveBatchId" uuid REFERENCES cold_archive_batches(id) ON DELETE RESTRICT;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS cold_archive_batches_status_created_at_idx
  ON cold_archive_batches(status, created_at);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS cold_archive_batch_items_transaction_id_idx
  ON cold_archive_batch_items(transaction_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS transactions_cold_archive_batch_id_idx
  ON transactions("coldArchiveBatchId")
  WHERE "archivedTier" = 'cold';
