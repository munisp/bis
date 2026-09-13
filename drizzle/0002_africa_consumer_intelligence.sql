-- Africa-first consumer intelligence domain.
-- This schema is intentionally synthetic-only until a jurisdiction-specific provider
-- onboarding process grants a separate production ingestion path.

CREATE TABLE consumer_discovery_profiles (
  id BIGSERIAL PRIMARY KEY,
  profile_ref TEXT NOT NULL UNIQUE,
  dataset_origin TEXT NOT NULL DEFAULT 'synthetic_demo',
  synthetic_notice TEXT NOT NULL DEFAULT 'SYNTHETIC DEMONSTRATION DATA — NOT A REAL PERSON',
  country_code CHAR(2) NOT NULL DEFAULT 'NG',
  jurisdiction_code TEXT NOT NULL DEFAULT 'NG',
  state_or_region TEXT,
  city_or_locality TEXT,
  given_name TEXT NOT NULL,
  middle_name TEXT,
  family_name TEXT NOT NULL,
  aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
  date_of_birth DATE,
  normalized_phone TEXT,
  normalized_email TEXT,
  address_line TEXT,
  postal_code TEXT,
  occupation TEXT,
  education_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  public_profile_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  record_status TEXT NOT NULL DEFAULT 'active',
  source_observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_discovery_profiles_synthetic_only
    CHECK (dataset_origin = 'synthetic_demo'),
  CONSTRAINT consumer_discovery_profiles_country_code
    CHECK (country_code ~ '^[A-Z]{2}$'),
  CONSTRAINT consumer_discovery_profiles_status
    CHECK (record_status IN ('active', 'suppressed', 'expired')),
  CONSTRAINT consumer_discovery_profiles_synthetic_notice
    CHECK (synthetic_notice = 'SYNTHETIC DEMONSTRATION DATA — NOT A REAL PERSON')
);

CREATE INDEX consumer_discovery_profiles_name_idx
  ON consumer_discovery_profiles (country_code, family_name, given_name);
CREATE INDEX consumer_discovery_profiles_phone_idx
  ON consumer_discovery_profiles (country_code, normalized_phone)
  WHERE normalized_phone IS NOT NULL;
CREATE INDEX consumer_discovery_profiles_email_idx
  ON consumer_discovery_profiles (country_code, normalized_email)
  WHERE normalized_email IS NOT NULL;
CREATE INDEX consumer_discovery_profiles_active_idx
  ON consumer_discovery_profiles (country_code, record_status, source_observed_at DESC);

CREATE TABLE consumer_record_provenance (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES consumer_discovery_profiles(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  source_name TEXT NOT NULL DEFAULT 'bis-synthetic-nigeria-fixtures',
  source_record_ref TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'synthetic_fixture',
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ,
  confidence_score NUMERIC(5,4) NOT NULL,
  evidence_summary TEXT NOT NULL,
  is_synthetic BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_record_provenance_score
    CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT consumer_record_provenance_synthetic_only
    CHECK (is_synthetic = TRUE AND source_kind = 'synthetic_fixture')
);

CREATE INDEX consumer_record_provenance_profile_idx
  ON consumer_record_provenance (profile_id, field_name, collected_at DESC);

CREATE TABLE consumer_record_links (
  id BIGSERIAL PRIMARY KEY,
  profile_id BIGINT NOT NULL REFERENCES consumer_discovery_profiles(id) ON DELETE CASCADE,
  related_profile_id BIGINT NOT NULL REFERENCES consumer_discovery_profiles(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,
  linkage_method TEXT NOT NULL,
  confidence_score NUMERIC(5,4) NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  review_status TEXT NOT NULL DEFAULT 'confirmed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_record_links_distinct_profiles CHECK (profile_id <> related_profile_id),
  CONSTRAINT consumer_record_links_score CHECK (confidence_score >= 0 AND confidence_score <= 1),
  CONSTRAINT consumer_record_links_relationship_type
    CHECK (relationship_type IN ('relative', 'household', 'associate', 'former_address_match', 'possible_duplicate')),
  CONSTRAINT consumer_record_links_method
    CHECK (linkage_method IN ('shared_phone', 'shared_address', 'name_and_birthdate', 'manual_review')),
  CONSTRAINT consumer_record_links_review_status
    CHECK (review_status IN ('confirmed', 'pending_review', 'rejected')),
  CONSTRAINT consumer_record_links_unique_pair UNIQUE (profile_id, related_profile_id, relationship_type, linkage_method)
);

CREATE INDEX consumer_record_links_profile_idx
  ON consumer_record_links (profile_id, review_status, confidence_score DESC);
CREATE INDEX consumer_record_links_related_idx
  ON consumer_record_links (related_profile_id, review_status, confidence_score DESC);

CREATE TABLE consumer_lookup_access (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE RESTRICT,
  lookup_mode TEXT NOT NULL,
  purpose TEXT NOT NULL,
  query_fingerprint CHAR(64) NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  dataset_origin TEXT NOT NULL DEFAULT 'synthetic_demo',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_lookup_access_mode CHECK (lookup_mode IN ('consumer', 'institutional')),
  CONSTRAINT consumer_lookup_access_purpose
    CHECK (purpose IN ('self', 'personal_safety', 'fraud_prevention', 'account_security', 'compliance_investigation', 'legal_authority')),
  CONSTRAINT consumer_lookup_access_result_count CHECK (result_count >= 0),
  CONSTRAINT consumer_lookup_access_synthetic_only CHECK (dataset_origin = 'synthetic_demo')
);

CREATE INDEX consumer_lookup_access_actor_idx
  ON consumer_lookup_access (actor_user_id, created_at DESC);
CREATE INDEX consumer_lookup_access_tenant_idx
  ON consumer_lookup_access (tenant_id, created_at DESC)
  WHERE tenant_id IS NOT NULL;

CREATE TABLE consumer_synthetic_fixture_runs (
  id BIGSERIAL PRIMARY KEY,
  fixture_version TEXT NOT NULL UNIQUE,
  fixture_checksum_sha256 CHAR(64) NOT NULL,
  profile_count INTEGER NOT NULL,
  country_code CHAR(2) NOT NULL DEFAULT 'NG',
  generated_by TEXT NOT NULL DEFAULT 'bis-fixture-seeder',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_synthetic_fixture_runs_profile_count CHECK (profile_count > 0),
  CONSTRAINT consumer_synthetic_fixture_runs_checksum CHECK (fixture_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT consumer_synthetic_fixture_runs_country_code CHECK (country_code = 'NG')
);

COMMENT ON TABLE consumer_discovery_profiles IS
  'Synthetic Nigeria-first consumer discovery profiles for local/demo validation only. Production provider data must not be inserted into this table.';
COMMENT ON TABLE consumer_record_provenance IS
  'Field-level source, freshness, confidence, and synthetic-data marker for consumer discovery results.';
COMMENT ON TABLE consumer_record_links IS
  'Explainable linkage edges between synthetic consumer profiles; relationship presentation requires a confirmed review status.';
COMMENT ON TABLE consumer_lookup_access IS
  'Purpose-bound, minimal lookup audit record. Query terms are represented only by a SHA-256 fingerprint.';
