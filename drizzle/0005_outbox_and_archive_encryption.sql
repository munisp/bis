-- Key-versioned envelope-encryption metadata for durable events and Parquet archives.
-- Existing outbox rows are intentionally preserved for explicit operator rekeying;
-- new application writes place ciphertext in payload_ciphertext and leave payload NULL.

ALTER TABLE gateway_transactional_outbox
  ALTER COLUMN payload DROP NOT NULL,
  ADD COLUMN payload_ciphertext BYTEA,
  ADD COLUMN payload_nonce BYTEA,
  ADD COLUMN payload_key_version TEXT,
  ADD COLUMN payload_algorithm TEXT,
  ADD CONSTRAINT gateway_transactional_outbox_encryption_shape CHECK (
    (payload_ciphertext IS NULL AND payload_nonce IS NULL AND payload_key_version IS NULL AND payload_algorithm IS NULL)
    OR
    (payload_ciphertext IS NOT NULL AND octet_length(payload_nonce) = 12
      AND payload_key_version IS NOT NULL AND payload_key_version <> ''
      AND payload_algorithm = 'AES-256-GCM')
  );

CREATE INDEX gateway_transactional_outbox_key_version_idx
  ON gateway_transactional_outbox (payload_key_version)
  WHERE payload_key_version IS NOT NULL;

ALTER TABLE cold_archive_batches
  ADD COLUMN object_encryption_algorithm TEXT,
  ADD COLUMN object_encryption_key_id TEXT,
  ADD CONSTRAINT cold_archive_batches_encryption_metadata CHECK (
    (object_encryption_algorithm IS NULL AND object_encryption_key_id IS NULL)
    OR
    (object_encryption_algorithm = 'aws:kms' AND object_encryption_key_id IS NOT NULL AND object_encryption_key_id <> '')
  );

COMMENT ON COLUMN gateway_transactional_outbox.payload IS
  'Legacy plaintext compatibility only. Production writers must leave this NULL.';
COMMENT ON COLUMN gateway_transactional_outbox.payload_ciphertext IS
  'AES-256-GCM encrypted canonical event JSON; key version and 96-bit nonce are stored alongside.';
COMMENT ON COLUMN cold_archive_batches.object_encryption_key_id IS
  'Immutable object-store KMS key identifier used to encrypt the committed Parquet object.';
