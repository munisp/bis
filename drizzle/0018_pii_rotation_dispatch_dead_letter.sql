-- Terminalize exhausted non-PII rotation dispatch leases without retaining PII.
-- A worker may claim at most 12 times. The 13th claim moves the dispatch row to
-- a durable terminal queue state and the tenant-scoped job is marked failed by
-- the worker with an append-only, PII-suppressed forensic audit event.

ALTER TABLE pii_rotation_dispatch_queue
  DROP CONSTRAINT IF EXISTS pii_rotation_dispatch_queue_state_check,
  ADD COLUMN dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN dead_letter_reason TEXT,
  ADD CONSTRAINT pii_rotation_dispatch_queue_state_check
    CHECK (state IN ('queued','leased','terminalizing','dead_letter')),
  ADD CONSTRAINT pii_rotation_dispatch_queue_terminal_shape_check CHECK (
    (state IN ('queued','leased') AND dead_lettered_at IS NULL AND dead_letter_reason IS NULL)
    OR (state = 'terminalizing' AND leased_at IS NOT NULL AND dead_lettered_at IS NULL AND dead_letter_reason = 'PII_ROTATION_ATTEMPTS_EXHAUSTED')
    OR (state = 'dead_letter' AND leased_at IS NULL AND dead_lettered_at IS NOT NULL AND dead_letter_reason = 'PII_ROTATION_ATTEMPTS_EXHAUSTED')
  );

CREATE INDEX pii_rotation_dispatch_queue_terminalizing_idx
  ON pii_rotation_dispatch_queue (leased_at ASC)
  WHERE state = 'terminalizing';
CREATE INDEX pii_rotation_dispatch_queue_dead_letter_idx
  ON pii_rotation_dispatch_queue (dead_lettered_at DESC)
  WHERE state = 'dead_letter';

CREATE OR REPLACE FUNCTION sync_pii_rotation_dispatch_queue() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.state IN ('queued','leased') THEN
      INSERT INTO pii_rotation_dispatch_queue (rotation_job_id,rotation_ref,tenant_id,state,leased_at,attempt_count)
      VALUES (NEW.id,NEW.rotation_ref,NEW.tenant_id,NEW.state,NEW.leased_at,NEW.attempt_count)
      ON CONFLICT (rotation_job_id) DO NOTHING;
    END IF;
  ELSIF NEW.state IN ('queued','leased') THEN
    INSERT INTO pii_rotation_dispatch_queue (rotation_job_id,rotation_ref,tenant_id,state,leased_at,attempt_count,dead_lettered_at,dead_letter_reason,updated_at)
    VALUES (NEW.id,NEW.rotation_ref,NEW.tenant_id,NEW.state,NEW.leased_at,NEW.attempt_count,NULL,NULL,NOW())
    ON CONFLICT (rotation_job_id) DO UPDATE SET
      state=EXCLUDED.state,
      leased_at=EXCLUDED.leased_at,
      attempt_count=EXCLUDED.attempt_count,
      dead_lettered_at=NULL,
      dead_letter_reason=NULL,
      updated_at=NOW();
  ELSE
    -- Keep terminalizing/dead-letter evidence while a tenant-scoped worker records
    -- the failed job and append-only forensic event. Ordinary terminal job states
    -- still remove their non-terminal dispatch rows.
    DELETE FROM pii_rotation_dispatch_queue
    WHERE rotation_job_id=NEW.id AND state NOT IN ('terminalizing','dead_letter');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION reject_pii_rotation_dispatch_terminal_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'dead_letter' THEN
    RAISE EXCEPTION 'terminal PII rotation dispatch records are immutable';
  END IF;
  IF OLD.state = 'terminalizing' AND NEW.state NOT IN ('terminalizing','dead_letter') THEN
    RAISE EXCEPTION 'terminalizing PII rotation dispatch may only become dead_letter';
  END IF;
  IF OLD.state = 'queued' AND NEW.state NOT IN ('queued','leased','terminalizing') THEN
    RAISE EXCEPTION 'queued PII rotation dispatch may only be leased or terminalized';
  END IF;
  IF OLD.state = 'leased' AND NEW.state NOT IN ('queued','leased','terminalizing') THEN
    RAISE EXCEPTION 'leased PII rotation dispatch must requeue, renew, or terminalize';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER pii_rotation_dispatch_terminal_immutable
  BEFORE UPDATE ON pii_rotation_dispatch_queue
  FOR EACH ROW EXECUTE FUNCTION reject_pii_rotation_dispatch_terminal_mutation();
