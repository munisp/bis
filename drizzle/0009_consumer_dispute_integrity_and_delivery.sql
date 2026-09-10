-- P0 remediation: consumer-dispute relational integrity, immutable report snapshots,
-- deadline escalation state, and encrypted provider-delivery transactional outbox.

ALTER TABLE consumer_dispute_events DROP CONSTRAINT consumer_dispute_events_type;
ALTER TABLE consumer_dispute_events ADD CONSTRAINT consumer_dispute_events_type CHECK (event_type IN (
  'submitted', 'identity_verified', 'accepted', 'assigned', 'item_held', 'source_task_created',
  'source_task_dispatched', 'source_response_recorded', 'extension_applied', 'frivolous_determined',
  'item_corrected', 'item_deleted', 'item_verified', 'item_unverifiable', 'notice_queued',
  'notice_delivered', 'method_description_requested', 'method_description_delivered', 'withdrawn',
  'completed', 'reinserted', 'recipient_remediation_queued', 'evidence_initiated',
  'evidence_verified', 'evidence_quarantined', 'deadline_escalated', 'deadline_acknowledged',
  'deadline_resolved', 'provider_outbox_enqueued', 'provider_outbox_delivered', 'provider_outbox_failed'
));

CREATE TABLE consumer_dispute_deadline_escalations (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  escalation_type TEXT NOT NULL,
  due_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  first_detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_dispute_deadline_escalations_type CHECK (
    escalation_type IN ('source_notice_due', 'reinvestigation_due', 'result_notice_due', 'method_description_due')
  ),
  CONSTRAINT consumer_dispute_deadline_escalations_status CHECK (status IN ('open', 'acknowledged', 'resolved')),
  CONSTRAINT consumer_dispute_deadline_escalations_acknowledgement CHECK (
    status = 'open' OR (acknowledged_at IS NOT NULL AND acknowledged_by_user_id IS NOT NULL)
  ),
  CONSTRAINT consumer_dispute_deadline_escalations_resolution CHECK (
    status <> 'resolved' OR (resolved_at IS NOT NULL AND resolved_by_user_id IS NOT NULL AND length(btrim(resolution_note)) >= 10)
  ),
  CONSTRAINT consumer_dispute_deadline_escalations_unique_due UNIQUE (case_id, escalation_type, due_at)
);
CREATE INDEX consumer_dispute_deadline_escalations_open_idx
  ON consumer_dispute_deadline_escalations (status, due_at ASC)
  WHERE status IN ('open', 'acknowledged');

CREATE TABLE consumer_dispute_provider_outbox (
  id UUID PRIMARY KEY,
  case_id BIGINT NOT NULL REFERENCES consumer_dispute_cases(id) ON DELETE RESTRICT,
  source_task_id BIGINT NOT NULL REFERENCES consumer_dispute_source_tasks(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  payload_ciphertext BYTEA NOT NULL,
  payload_nonce BYTEA NOT NULL,
  payload_key_version TEXT NOT NULL,
  payload_algorithm TEXT NOT NULL DEFAULT 'aes-256-gcm',
  payload_sha256 CHAR(64) NOT NULL,
  idempotency_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error_code TEXT,
  provider_transaction_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_dispute_provider_outbox_event_type CHECK (event_type IN ('provider_reinvestigation_request', 'provider_status_poll')),
  CONSTRAINT consumer_dispute_provider_outbox_algorithm CHECK (payload_algorithm = 'aes-256-gcm'),
  CONSTRAINT consumer_dispute_provider_outbox_digest CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT consumer_dispute_provider_outbox_nonce CHECK (octet_length(payload_nonce) = 12),
  CONSTRAINT consumer_dispute_provider_outbox_state CHECK (state IN ('pending', 'leased', 'delivered', 'dead_letter', 'cancelled')),
  CONSTRAINT consumer_dispute_provider_outbox_attempts CHECK (attempt_count >= 0 AND attempt_count <= 12),
  CONSTRAINT consumer_dispute_provider_outbox_idempotency UNIQUE (event_type, idempotency_key),
  CONSTRAINT consumer_dispute_provider_outbox_task_event UNIQUE (source_task_id, event_type)
);
CREATE INDEX consumer_dispute_provider_outbox_dispatch_idx
  ON consumer_dispute_provider_outbox (state, available_at ASC, created_at ASC)
  WHERE state = 'pending';
CREATE INDEX consumer_dispute_provider_outbox_case_idx
  ON consumer_dispute_provider_outbox (case_id, created_at ASC);

CREATE OR REPLACE FUNCTION consumer_report_snapshots_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.superseded_at IS NOT NULL
     OR NEW.superseded_at IS NULL
     OR NEW.snapshot_ref IS DISTINCT FROM OLD.snapshot_ref
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id
     OR NEW.screening_order_id IS DISTINCT FROM OLD.screening_order_id
     OR NEW.report_id IS DISTINCT FROM OLD.report_id
     OR NEW.jurisdiction_code IS DISTINCT FROM OLD.jurisdiction_code
     OR NEW.report_purpose IS DISTINCT FROM OLD.report_purpose
     OR NEW.report_version IS DISTINCT FROM OLD.report_version
     OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
     OR NEW.manifest IS DISTINCT FROM OLD.manifest
     OR NEW.encrypted_object_key IS DISTINCT FROM OLD.encrypted_object_key
     OR NEW.object_version_id IS DISTINCT FROM OLD.object_version_id
     OR NEW.kms_key_id IS DISTINCT FROM OLD.kms_key_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'consumer_report_snapshots is immutable; only one NULL-to-timestamp supersession transition is permitted';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_report_snapshots_immutable_update
  BEFORE UPDATE ON consumer_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION consumer_report_snapshots_immutable();
CREATE TRIGGER consumer_report_snapshots_immutable_delete
  BEFORE DELETE ON consumer_report_snapshots
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_events_append_only();

CREATE OR REPLACE FUNCTION consumer_dispute_case_references_valid()
RETURNS TRIGGER AS $$
DECLARE
  binding_row consumer_subject_bindings%ROWTYPE;
  snapshot_row consumer_report_snapshots%ROWTYPE;
  rights_tenant BIGINT;
  rights_requester BIGINT;
  adverse_candidate INTEGER;
  adverse_order INTEGER;
BEGIN
  SELECT * INTO binding_row FROM consumer_subject_bindings WHERE id = NEW.subject_binding_id;
  IF NOT FOUND OR binding_row.revoked_at IS NOT NULL
     OR binding_row.tenant_id IS DISTINCT FROM NEW.tenant_id
     OR binding_row.user_id <> NEW.requester_user_id THEN
    RAISE EXCEPTION 'consumer dispute binding must be active and belong to the same requester and tenant';
  END IF;

  IF NEW.report_snapshot_id IS NULL AND NEW.case_type <> 'access' THEN
    RAISE EXCEPTION 'a non-access consumer dispute requires an immutable report snapshot';
  END IF;

  IF NEW.report_snapshot_id IS NOT NULL THEN
    SELECT * INTO snapshot_row FROM consumer_report_snapshots WHERE id = NEW.report_snapshot_id;
    IF NOT FOUND OR snapshot_row.tenant_id <> NEW.tenant_id THEN
      RAISE EXCEPTION 'consumer dispute snapshot must belong to the same tenant';
    END IF;
    IF binding_row.candidate_id IS DISTINCT FROM snapshot_row.candidate_id THEN
      RAISE EXCEPTION 'consumer dispute binding and snapshot must reference the same candidate';
    END IF;
    IF snapshot_row.screening_order_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM screening_orders o
       WHERE o.id = snapshot_row.screening_order_id
         AND o."tenantId" = NEW.tenant_id
         AND o."candidateId" IS NOT DISTINCT FROM snapshot_row.candidate_id
    ) THEN
      RAISE EXCEPTION 'consumer dispute snapshot screening order must match tenant and candidate';
    END IF;
  END IF;

  IF NEW.rights_request_id IS NOT NULL THEN
    SELECT tenant_id, requester_user_id INTO rights_tenant, rights_requester
      FROM consumer_rights_requests WHERE id = NEW.rights_request_id;
    IF NOT FOUND OR rights_tenant IS DISTINCT FROM NEW.tenant_id OR rights_requester IS DISTINCT FROM NEW.requester_user_id THEN
      RAISE EXCEPTION 'consumer rights request must belong to the same requester and tenant';
    END IF;
  END IF;

  IF NEW.adverse_action_id IS NOT NULL THEN
    SELECT aa."candidateId", aa."orderId" INTO adverse_candidate, adverse_order
      FROM adverse_actions aa WHERE aa.id = NEW.adverse_action_id;
    IF NOT FOUND OR binding_row.candidate_id IS DISTINCT FROM adverse_candidate THEN
      RAISE EXCEPTION 'adverse action must reference the dispute subject candidate';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM screening_orders o WHERE o.id = adverse_order AND o."tenantId" = NEW.tenant_id) THEN
      RAISE EXCEPTION 'adverse action screening order must belong to the same tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_dispute_cases_reference_guard
  BEFORE INSERT OR UPDATE OF tenant_id, requester_user_id, subject_binding_id, report_snapshot_id, rights_request_id, adverse_action_id, case_type
  ON consumer_dispute_cases
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_case_references_valid();

CREATE OR REPLACE FUNCTION consumer_dispute_item_reference_valid()
RETURNS TRIGGER AS $$
DECLARE
  snapshot_order_id INTEGER;
  snapshot_candidate_id INTEGER;
  dispute_adverse_action_id INTEGER;
  result_order_id INTEGER;
  adverse_action_for_item INTEGER;
BEGIN
  SELECT s.screening_order_id, s.candidate_id, c.adverse_action_id
    INTO snapshot_order_id, snapshot_candidate_id, dispute_adverse_action_id
    FROM consumer_dispute_cases c
    LEFT JOIN consumer_report_snapshots s ON s.id = c.report_snapshot_id
   WHERE c.id = NEW.case_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'dispute item must belong to an existing dispute case';
  END IF;
  IF NEW.screening_result_id IS NOT NULL THEN
    SELECT "orderId" INTO result_order_id FROM screening_results WHERE id = NEW.screening_result_id;
    IF NOT FOUND OR snapshot_order_id IS NULL OR result_order_id <> snapshot_order_id THEN
      RAISE EXCEPTION 'screening result must belong to the dispute snapshot screening order';
    END IF;
  END IF;
  IF NEW.adverse_item_id IS NOT NULL THEN
    SELECT "adverseActionId" INTO adverse_action_for_item FROM adverse_items WHERE id = NEW.adverse_item_id;
    IF NOT FOUND OR dispute_adverse_action_id IS NULL OR adverse_action_for_item <> dispute_adverse_action_id THEN
      RAISE EXCEPTION 'adverse item must belong to the dispute adverse action';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_dispute_items_reference_guard
  BEFORE INSERT OR UPDATE OF case_id, screening_result_id, adverse_item_id
  ON consumer_dispute_items
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_item_reference_valid();

CREATE OR REPLACE FUNCTION consumer_dispute_evidence_owner_valid()
RETURNS TRIGGER AS $$
DECLARE
  case_requester INTEGER;
BEGIN
  SELECT requester_user_id INTO case_requester FROM consumer_dispute_cases WHERE id = NEW.case_id;
  IF NOT FOUND OR NEW.submitted_by_user_id IS NULL OR NEW.submitted_by_user_id <> case_requester THEN
    RAISE EXCEPTION 'consumer dispute evidence must be submitted by the dispute requester';
  END IF;
  IF NEW.expires_at <= NEW.created_at THEN
    RAISE EXCEPTION 'consumer dispute evidence expiry must be after creation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_dispute_evidence_owner_guard
  BEFORE INSERT OR UPDATE OF case_id, submitted_by_user_id, expires_at
  ON consumer_dispute_evidence
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_evidence_owner_valid();

CREATE OR REPLACE FUNCTION consumer_dispute_source_task_reference_valid()
RETURNS TRIGGER AS $$
DECLARE
  case_tenant INTEGER;
  item_case BIGINT;
  authorization_source INTEGER;
  authorization_tenant INTEGER;
BEGIN
  SELECT tenant_id INTO case_tenant FROM consumer_dispute_cases WHERE id = NEW.case_id;
  SELECT case_id INTO item_case FROM consumer_dispute_items WHERE id = NEW.dispute_item_id;
  SELECT data_source_id, tenant_id INTO authorization_source, authorization_tenant
    FROM data_provider_authorizations WHERE id = NEW.provider_authorization_id;
  IF NOT FOUND OR case_tenant IS NULL OR item_case IS DISTINCT FROM NEW.case_id
     OR authorization_source <> NEW.data_source_id
     OR (authorization_tenant IS NOT NULL AND authorization_tenant <> case_tenant) THEN
    RAISE EXCEPTION 'source task provider authorization, data source, item, and case must share scope';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_dispute_source_tasks_reference_guard
  BEFORE INSERT OR UPDATE OF case_id, dispute_item_id, provider_authorization_id, data_source_id
  ON consumer_dispute_source_tasks
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_source_task_reference_valid();

CREATE OR REPLACE FUNCTION consumer_dispute_completion_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'resolved' AND OLD.status IS DISTINCT FROM 'resolved' AND EXISTS (
    SELECT 1 FROM consumer_dispute_deadline_escalations e
     WHERE e.case_id = NEW.id AND e.status <> 'resolved'
  ) THEN
    RAISE EXCEPTION 'consumer dispute cannot be resolved while a deadline escalation remains open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER consumer_dispute_cases_completion_guard
  BEFORE UPDATE OF status ON consumer_dispute_cases
  FOR EACH ROW EXECUTE FUNCTION consumer_dispute_completion_guard();

ALTER TABLE data_provider_authorizations
  ADD CONSTRAINT data_provider_authorizations_nonblank_metadata CHECK (
    length(btrim(provider_code)) > 0
    AND length(btrim(contract_reference)) > 0
    AND length(btrim(contract_version)) > 0
    AND length(btrim(credential_secret_ref)) > 0
  ),
  ADD CONSTRAINT data_provider_authorizations_array_metadata CHECK (
    jsonb_typeof(approved_use_cases) = 'array'
    AND jsonb_typeof(approved_jurisdictions) = 'array'
    AND jsonb_typeof(approved_data_fields) = 'array'
    AND jsonb_typeof(lawful_basis_requirements) = 'array'
  );

COMMENT ON TABLE consumer_dispute_deadline_escalations IS
  'Deduplicated, auditable deadline escalations created by the consumer-dispute deadline worker. An unresolved P0 escalation blocks ordinary case closure.';
COMMENT ON TABLE consumer_dispute_provider_outbox IS
  'AES-256-GCM encrypted transactional outbox. Payloads carry opaque references only; a contract-specific worker retrieves minimal authorized data at dispatch time.';
