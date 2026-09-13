CREATE TYPE "public"."access_review_status" AS ENUM('pending', 'approved', 'revoked', 'escalated', 'expired');
CREATE TYPE "public"."adverse_action_status" AS ENUM('pending_pre_adverse', 'pre_adverse_sent', 'dispute_received', 'dispute_resolved', 'final_adverse_sent', 'withdrawn', 'cleared');
CREATE TYPE "public"."agent_status" AS ENUM('active', 'inactive', 'suspended', 'training');
CREATE TYPE "public"."agent_tier" AS ENUM('junior', 'senior', 'lead', 'specialist');
CREATE TYPE "public"."alert_rule_metric" AS ENUM('risk_score', 'sanctions_confidence', 'pep_confidence', 'adverse_media_count', 'duplicate_identity_score', 'velocity_hourly', 'velocity_daily', 'credit_score');
CREATE TYPE "public"."alert_rule_operator" AS ENUM('gt', 'gte', 'lt', 'lte', 'eq', 'neq');
CREATE TYPE "public"."alert_type" AS ENUM('sanctions_hit', 'pep_detected', 'risk_threshold', 'velocity', 'adverse_media', 'field_report', 'system');
CREATE TYPE "public"."aml_alert_status" AS ENUM('open', 'under_review', 'escalated', 'cleared', 'filed', 'false_positive');
CREATE TYPE "public"."aml_risk_level" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "public"."aml_rule_type" AS ENUM('threshold', 'velocity', 'structuring', 'round_trip', 'layering', 'high_risk_country', 'pep_transaction', 'sanctions_match', 'unusual_pattern');
CREATE TYPE "public"."api_token_scope" AS ENUM('investigations:read', 'investigations:write', 'kyc:read', 'kyc:write', 'alerts:read', 'alerts:write', 'reports:read', 'reports:write', 'screening:read', 'screening:write', 'field_agents:read', 'field_agents:write', 'audit:read', 'data_sources:read', 'admin:read', 'admin:write');
CREATE TYPE "public"."assessment_outcome" AS ENUM('clear', 'consider', 'suspended_licence', 'revoked_licence', 'adverse', 'pending', 'unverified');
CREATE TYPE "public"."audit_category" AS ENUM('investigation', 'kyc', 'alert', 'report', 'user', 'system', 'api');
CREATE TYPE "public"."audit_result" AS ENUM('success', 'warning', 'failure');
CREATE TYPE "public"."biometric_modality" AS ENUM('fingerprint', 'face', 'iris', 'voice');
CREATE TYPE "public"."candidate_status" AS ENUM('invited', 'applying', 'submitted', 'processing', 'completed', 'withdrawn', 'expired');
CREATE TYPE "public"."case_party_role" AS ENUM('subject', 'witness', 'associate', 'victim', 'entity');
CREATE TYPE "public"."case_priority" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "public"."case_stakeholder_role" AS ENUM('lead_analyst', 'reviewer', 'external_counsel', 'regulator', 'compliance_officer', 'subject_representative');
CREATE TYPE "public"."case_status" AS ENUM('draft', 'open', 'under_review', 'pending_decision', 'closed', 'archived');
CREATE TYPE "public"."case_timeline_event_type" AS ENUM('case_created', 'status_changed', 'party_added', 'document_uploaded', 'document_deleted', 'comment_added', 'investigation_linked', 'stakeholder_invited', 'field_task_dispatched', 'alert_triggered', 'decision_recorded', 'case_closed');
CREATE TYPE "public"."case_type" AS ENUM('fraud', 'aml', 'kyc_failure', 'sanctions', 'corruption', 'cyber', 'regulatory', 'other');
CREATE TYPE "public"."channel_status" AS ENUM('active', 'inactive', 'error', 'pending');
CREATE TYPE "public"."channel_type" AS ENUM('whatsapp', 'telegram', 'ussd', 'sms', 'email');
CREATE TYPE "public"."collection_site_status" AS ENUM('active', 'inactive', 'suspended');
CREATE TYPE "public"."compliance_report_status" AS ENUM('generating', 'ready', 'submitted', 'failed');
CREATE TYPE "public"."compliance_report_type" AS ENUM('sar_xml', 'goaml_str', 'goaml_ctr', 'cbn_monthly', 'cbn_quarterly', 'fatf_risk', 'nfiu_annual', 'custom');
CREATE TYPE "public"."consent_purpose" AS ENUM('pre_employment', 'employment', 'contractor', 'volunteer', 'tenancy', 'financial_services', 'healthcare', 'government');
CREATE TYPE "public"."correspondent_bank_status" AS ENUM('active', 'suspended', 'terminated', 'under_review');
CREATE TYPE "public"."court_type" AS ENUM('magistrate', 'high_court', 'federal_high_court', 'court_of_appeal', 'supreme_court', 'national_industrial_court', 'sharia_court', 'customary_court');
CREATE TYPE "public"."criminal_request_status" AS ENUM('draft', 'submitted', 'acknowledged', 'processing', 'completed', 'rejected', 'expired');
CREATE TYPE "public"."criminal_verdict" AS ENUM('convicted', 'acquitted', 'discharged', 'pending', 'nolle_prosequi', 'unknown');
CREATE TYPE "public"."data_source_category" AS ENUM('identity', 'financial', 'legal', 'social', 'biometric', 'government', 'commercial');
CREATE TYPE "public"."data_source_status" AS ENUM('active', 'degraded', 'offline', 'maintenance');
CREATE TYPE "public"."document_vault_status" AS ENUM('pending', 'verified', 'rejected', 'expired');
CREATE TYPE "public"."duplicate_check_status" AS ENUM('pending', 'no_match', 'possible_match', 'confirmed_duplicate');
CREATE TYPE "public"."evidence_status" AS ENUM('collected', 'in_transit', 'secured', 'analyzed', 'submitted', 'returned', 'destroyed');
CREATE TYPE "public"."evidence_type" AS ENUM('document', 'photo', 'video', 'audio', 'digital_artifact', 'physical', 'witness_statement', 'financial_record', 'communication_log', 'other');
CREATE TYPE "public"."field_visit_schedule_status" AS ENUM('scheduled', 'confirmed', 'in_progress', 'completed', 'cancelled', 'rescheduled');
CREATE TYPE "public"."hosted_link_status" AS ENUM('active', 'completed', 'expired', 'revoked');
CREATE TYPE "public"."incoming_report_status" AS ENUM('new', 'processing', 'verified', 'dismissed', 'escalated');
CREATE TYPE "public"."insider_category" AS ENUM('data_exfiltration', 'privilege_abuse', 'off_hours_access', 'peer_anomaly', 'dead_man_switch', 'failed_auth_spike', 'unusual_ip', 'bulk_download', 'policy_violation', 'access_review_overdue');
CREATE TYPE "public"."insider_event_status" AS ENUM('open', 'under_review', 'escalated', 'dismissed', 'resolved');
CREATE TYPE "public"."insider_severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');
CREATE TYPE "public"."investigation_status" AS ENUM('draft', 'pending', 'processing', 'completed', 'flagged', 'archived', 'thin_file');
CREATE TYPE "public"."key_status" AS ENUM('active', 'revoked', 'expired');
CREATE TYPE "public"."kyc_document_review_status" AS ENUM('pending', 'approved', 'rejected', 'reupload_requested');
CREATE TYPE "public"."kyc_status" AS ENUM('pending', 'processing', 'passed', 'failed', 'review');
CREATE TYPE "public"."law_enforcement_agency" AS ENUM('npf', 'efcc', 'icpc', 'dss', 'ndlea', 'nscdc', 'frsc', 'custom_state');
CREATE TYPE "public"."lc_status" AS ENUM('draft', 'issued', 'advised', 'confirmed', 'amended', 'presented', 'accepted', 'paid', 'discrepant', 'rejected', 'expired', 'cancelled');
CREATE TYPE "public"."lc_type" AS ENUM('sight', 'usance', 'deferred', 'revolving', 'standby');
CREATE TYPE "public"."lex_agency_status" AS ENUM('active', 'suspended', 'retired');
CREATE TYPE "public"."lex_agency_type" AS ENUM('npf', 'efcc', 'icpc', 'dss', 'nscdc', 'customs', 'immigration', 'other');
CREATE TYPE "public"."lex_channel" AS ENUM('web', 'sms', 'physical');
CREATE TYPE "public"."lex_incident_type" AS ENUM('arrest', 'seizure', 'witness_statement', 'court_order', 'intel_tip', 'missing_person', 'homicide', 'fraud', 'cybercrime', 'other');
CREATE TYPE "public"."lex_submission_status" AS ENUM('pending', 'under_review', 'validated', 'rejected', 'escalated', 'expunged');
CREATE TYPE "public"."lex_submitter_status" AS ENUM('active', 'suspended', 'revoked');
CREATE TYPE "public"."mention_sentiment" AS ENUM('positive', 'neutral', 'negative', 'critical');
CREATE TYPE "public"."ml_model_status" AS ENUM('training', 'staging', 'production', 'deprecated', 'failed');
CREATE TYPE "public"."mojaloop_status" AS ENUM('initiated', 'pending', 'completed', 'failed', 'reversed', 'expired');
CREATE TYPE "public"."monitor_status" AS ENUM('active', 'paused', 'triggered', 'expired');
CREATE TYPE "public"."monitor_type" AS ENUM('sanctions', 'pep', 'adverse_media', 'social', 'transaction', 'biometric');
CREATE TYPE "public"."nigerian_state" AS ENUM('AB', 'AD', 'AK', 'AN', 'BA', 'BY', 'BE', 'BO', 'CR', 'DE', 'EB', 'ED', 'EK', 'EN', 'GO', 'IM', 'JI', 'KD', 'KN', 'KT', 'KE', 'KO', 'KW', 'LA', 'NA', 'NI', 'OG', 'ON', 'OS', 'OY', 'PL', 'RI', 'SO', 'TA', 'YO', 'ZA', 'FC');
CREATE TYPE "public"."offence_category" AS ENUM('violent', 'financial', 'drug', 'cybercrime', 'terrorism', 'corruption', 'traffic', 'sexual', 'property', 'other');
CREATE TYPE "public"."onboarding_application_status" AS ENUM('draft', 'submitted', 'awaiting_documents', 'under_review', 'approved', 'rejected');
CREATE TYPE "public"."package_tier" AS ENUM('basic', 'standard', 'executive', 'transport', 'healthcare', 'financial', 'custom');
CREATE TYPE "public"."playbook_category" AS ENUM('kyc_physical', 'kyb_premises', 'asset_verification', 'surveillance', 'address_verification', 'interview', 'evidence_collection', 'emergency');
CREATE TYPE "public"."priority" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "public"."professional_body" AS ENUM('COREN', 'NBA', 'MDCN', 'ICAN', 'CIBN', 'NIM', 'NSE', 'NIPR', 'TOPREC', 'ARCON', 'ICSAN', 'ACCA', 'CIS', 'CIPD', 'HRCI');
CREATE TYPE "public"."push_broadcast_status" AS ENUM('scheduled', 'sent', 'cancelled');
CREATE TYPE "public"."regulatory_report_status" AS ENUM('draft', 'generated', 'reviewed', 'submitted', 'acknowledged', 'rejected');
CREATE TYPE "public"."regulatory_report_type" AS ENUM('CTR', 'STR', 'goAML_XML', 'NFIU_monthly', 'CBN_quarterly', 'FATF_travel_rule', 'PEP_disclosure', 'sanctions_screening', 'annual_AML_report');
CREATE TYPE "public"."report_format" AS ENUM('pdf', 'docx', 'csv', 'json');
CREATE TYPE "public"."report_status" AS ENUM('generating', 'ready', 'failed');
CREATE TYPE "public"."risk_profile_status" AS ENUM('active', 'under_review', 'escalated', 'archived');
CREATE TYPE "public"."risk_tier" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "public"."sanctions_list_type" AS ENUM('un_sc', 'ofac_sdn', 'eu_consolidated', 'uk_hmt', 'cbn_watchlist', 'nfiu_watchlist', 'interpol_red', 'custom');
CREATE TYPE "public"."sanctions_match_status" AS ENUM('pending_review', 'confirmed_hit', 'false_positive', 'escalated');
CREATE TYPE "public"."sar_category" AS ENUM('money_laundering', 'terrorist_financing', 'fraud', 'corruption', 'tax_evasion', 'sanctions_evasion', 'human_trafficking', 'drug_trafficking', 'cybercrime', 'other');
CREATE TYPE "public"."sar_status" AS ENUM('draft', 'under_review', 'approved', 'rejected', 'filed', 'acknowledged', 'withdrawn');
CREATE TYPE "public"."screening_status" AS ENUM('pending', 'processing', 'completed', 'failed', 'review');
CREATE TYPE "public"."screening_type" AS ENUM('mvr', 'drug', 'work_authorization', 'biometric', 'zero_footprint', 'nin_trace', 'bvn_fraud_check', 'nin_address_history', 'npf_criminal', 'efcc_watchlist', 'icpc_debarment', 'ndlea_drug', 'state_court', 'federal_court', 'pep_check', 'adverse_media_ng', 'frsc_mvr', 'frsc_commercial_driver', 'waec_education', 'neco_education', 'nabteb_education', 'employment_verification', 'pencom_history', 'nysc_discharge', 'professional_licence', 'cac_directorship', 'cac_full_profile', 'firs_tax_clearance', 'beneficial_owner', 'corporate_sanctions', 'mdcn_licence', 'nis_work_permit', 'international_criminal', 'international_education', 'international_employment', 'continuous_check');
CREATE TYPE "public"."sepa_payment_status" AS ENUM('pending', 'accepted', 'rejected', 'returned', 'settled');
CREATE TYPE "public"."sepa_payment_type" AS ENUM('credit_transfer', 'direct_debit', 'instant_credit');
CREATE TYPE "public"."severity" AS ENUM('info', 'low', 'medium', 'high', 'critical');
CREATE TYPE "public"."social_platform" AS ENUM('twitter', 'facebook', 'instagram', 'tiktok', 'linkedin', 'news', 'whatsapp_group', 'youtube');
CREATE TYPE "public"."spoof_type" AS ENUM('genuine', 'printed_photo', 'screen_replay', 'paper_mask', 'three_d_mask', 'deepfake', 'high_quality_photo', 'unknown');
CREATE TYPE "public"."stablecoin_status" AS ENUM('pending', 'confirmed', 'failed', 'reversed');
CREATE TYPE "public"."str_status" AS ENUM('draft', 'submitted', 'accepted', 'rejected', 'pending_review');
CREATE TYPE "public"."subject_type" AS ENUM('individual', 'corporate');
CREATE TYPE "public"."swift_message_status" AS ENUM('received', 'processing', 'completed', 'failed', 'rejected', 'pending_compliance');
CREATE TYPE "public"."swift_message_type" AS ENUM('MT103', 'MT202', 'MT202COV', 'MT199', 'MT299', 'MT900', 'MT910', 'MT940', 'MT950');
CREATE TYPE "public"."task_status" AS ENUM('pending', 'dispatched', 'in_progress', 'completed', 'failed', 'cancelled');
CREATE TYPE "public"."task_type" AS ENUM('address_verification', 'biometric_capture', 'document_collection', 'surveillance', 'interview');
CREATE TYPE "public"."tenant_plan" AS ENUM('starter', 'professional', 'enterprise', 'government');
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended', 'trial', 'churned');
CREATE TYPE "public"."tier" AS ENUM('basic', 'standard', 'comprehensive');
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'completed', 'failed', 'reversed', 'flagged', 'blocked', 'under_review');
CREATE TYPE "public"."transaction_type" AS ENUM('wire_transfer', 'cash_deposit', 'cash_withdrawal', 'cheque', 'rtgs', 'nip', 'swift_mt103', 'swift_mt202', 'sepa_credit', 'sepa_debit', 'internal_transfer', 'trade_settlement', 'fx_conversion', 'card_payment', 'mobile_money');
CREATE TYPE "public"."travel_rule_status" AS ENUM('pending', 'sent', 'acknowledged', 'rejected', 'exempted');
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin', 'analyst', 'supervisor', 'auditor', 'readonly');
CREATE TYPE "public"."waf_severity" AS ENUM('low', 'medium', 'high', 'critical');
CREATE TYPE "public"."webhook_status" AS ENUM('active', 'paused', 'failed');
CREATE TYPE "public"."work_permit_type" AS ENUM('expatriate_quota', 'combined_expatriate_residence_permit', 'temporary_work_permit', 'subject_to_regularisation', 'business_visa');
CREATE TABLE "access_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"reviewType" varchar(64) DEFAULT 'periodic' NOT NULL,
	"status" "access_review_status" DEFAULT 'pending' NOT NULL,
	"triggeredBy" varchar(64),
	"insiderEventId" integer,
	"assignedTo" integer,
	"dueAt" timestamp NOT NULL,
	"completedAt" timestamp,
	"completedBy" integer,
	"decision" text,
	"permifyChanges" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "adverse_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"adverseRef" varchar(32) NOT NULL,
	"orderId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"status" "adverse_action_status" DEFAULT 'pending_pre_adverse' NOT NULL,
	"preAdverseSentAt" timestamp,
	"preAdverseDeadline" timestamp,
	"disputeReceivedAt" timestamp,
	"disputeResolvedAt" timestamp,
	"finalAdverseSentAt" timestamp,
	"candidateEmail" varchar(320),
	"preAdversePdfUrl" text,
	"finalAdversePdfUrl" text,
	"reason" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "adverse_actions_adverseRef_unique" UNIQUE("adverseRef")
);

CREATE TABLE "adverse_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"adverseActionId" integer NOT NULL,
	"resultId" integer,
	"screeningType" "screening_type" NOT NULL,
	"description" text NOT NULL,
	"source" varchar(128),
	"date" date,
	"jurisdiction" varchar(128),
	"disputed" boolean DEFAULT false NOT NULL,
	"disputeNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"metric" "alert_rule_metric" NOT NULL,
	"operator" "alert_rule_operator" DEFAULT 'gte' NOT NULL,
	"threshold" real NOT NULL,
	"severity" "severity" DEFAULT 'high' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"autoEscalate" boolean DEFAULT false NOT NULL,
	"notifyOwner" boolean DEFAULT true NOT NULL,
	"createdBy" varchar(255),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"investigationId" integer,
	"type" "alert_type" NOT NULL,
	"severity" "severity" NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"subjectRef" varchar(64),
	"sourceService" varchar(64),
	"read" boolean DEFAULT false NOT NULL,
	"acknowledged" boolean DEFAULT false NOT NULL,
	"acknowledgedBy" integer,
	"acknowledgedAt" timestamp,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolvedBy" integer,
	"resolvedAt" timestamp,
	"dismissed" boolean DEFAULT false NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "aml_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"alertRef" varchar(32) NOT NULL,
	"transactionId" integer,
	"ruleId" integer,
	"status" "aml_alert_status" DEFAULT 'open' NOT NULL,
	"riskLevel" "aml_risk_level" DEFAULT 'medium' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"triggeredValue" real,
	"assignedTo" integer,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNotes" text,
	"investigationId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aml_alerts_alertRef_unique" UNIQUE("alertRef")
);

CREATE TABLE "aml_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"ruleType" "aml_rule_type" NOT NULL,
	"threshold" real,
	"currency" varchar(3) DEFAULT 'NGN',
	"windowHours" integer DEFAULT 24,
	"enabled" boolean DEFAULT true NOT NULL,
	"riskLevel" "aml_risk_level" DEFAULT 'medium' NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"keyHash" varchar(128) NOT NULL,
	"keyPrefix" varchar(16) NOT NULL,
	"status" "key_status" DEFAULT 'active' NOT NULL,
	"permissions" jsonb DEFAULT '[]'::jsonb,
	"lastUsedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_keyHash_unique" UNIQUE("keyHash")
);

CREATE TABLE "api_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"name" varchar(255) NOT NULL,
	"prefix" varchar(20) NOT NULL,
	"tokenHash" varchar(64) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rateLimit" integer DEFAULT 60 NOT NULL,
	"usageCount" integer DEFAULT 0 NOT NULL,
	"tokensConsumed" integer DEFAULT 0 NOT NULL,
	"tokenQuota" integer,
	"lastUsedAt" timestamp,
	"expiresAt" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "api_tokens_tokenHash_unique" UNIQUE("tokenHash")
);

CREATE TABLE "apisix_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestId" varchar(64),
	"routeId" varchar(64),
	"clientIp" varchar(45),
	"method" varchar(10),
	"uri" text,
	"statusCode" integer,
	"latencyMs" integer,
	"wafStatus" varchar(32),
	"wafAttackType" varchar(64),
	"tenantId" integer,
	"userId" integer,
	"rawLog" jsonb,
	"loggedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"userId" integer,
	"userEmail" varchar(320),
	"category" "audit_category" NOT NULL,
	"action" varchar(255) NOT NULL,
	"targetRef" varchar(64),
	"result" "audit_result" DEFAULT 'success' NOT NULL,
	"ipAddress" varchar(45),
	"detail" jsonb,
	"integrityHash" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "billing_topups" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" varchar(64) NOT NULL,
	"reference" varchar(256) NOT NULL,
	"amountKobo" integer NOT NULL,
	"channel" varchar(64) DEFAULT 'unknown' NOT NULL,
	"tbTransferId" varchar(64),
	"verifiedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "billing_topups_reference_unique" UNIQUE("reference")
);

CREATE TABLE "biometric_liveness_nonces" (
	"id" serial PRIMARY KEY NOT NULL,
	"frames_hash" varchar(64) NOT NULL,
	"subject_ref" varchar(128),
	"challenge" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "biometric_liveness_nonces_frames_hash_unique" UNIQUE("frames_hash")
);

CREATE TABLE "biometric_session_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" varchar(64) NOT NULL,
	"subject_ref" varchar(128),
	"kyc_record_id" integer,
	"liveness_score" real,
	"liveness_live" boolean,
	"liveness_reason" varchar(128),
	"liveness_landmarks_found" boolean,
	"liveness_ear" real,
	"liveness_texture_score" real,
	"liveness_face_area_ratio" real,
	"liveness_landmark_variance" real,
	"active_liveness_score" real,
	"active_liveness_live" boolean,
	"active_liveness_challenge" varchar(32),
	"active_liveness_challenge_completed" boolean,
	"active_liveness_frames_analysed" integer,
	"face_detected" boolean,
	"face_count" integer,
	"face_quality_score" real,
	"face_bbox_x" real,
	"face_bbox_y" real,
	"face_bbox_w" real,
	"face_bbox_h" real,
	"landmarks_68" text,
	"embedding_dimension" integer,
	"embedding_model" varchar(64),
	"match_score" real,
	"match_cosine_similarity" real,
	"match_decision" boolean,
	"match_threshold" real,
	"anti_spoof_score" real,
	"anti_spoof_genuine" boolean,
	"anti_spoof_type" "spoof_type" DEFAULT 'unknown',
	"anti_spoof_model" varchar(64),
	"anti_spoof_sharpness" real,
	"anti_spoof_colour_depth" real,
	"anti_spoof_hf_score" real,
	"anti_spoof_freq_anomaly_score" real,
	"anti_spoof_reflection_score" real,
	"anti_spoof_depth_score" real,
	"overall_score" real,
	"overall_verified" boolean,
	"failure_reasons" text,
	"request_id" varchar(64),
	"latency_ms" real,
	"engine_version" varchar(32),
	"kafka_published" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "biometric_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectRef" varchar(64) NOT NULL,
	"tenantId" integer,
	"modality" "biometric_modality" NOT NULL,
	"templateData" text NOT NULL,
	"quality" real,
	"deviceId" varchar(128),
	"enrolledBy" integer,
	"enrolledAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "candidate_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"consentRef" varchar(32) NOT NULL,
	"candidateId" integer NOT NULL,
	"orderId" integer,
	"purpose" "consent_purpose" DEFAULT 'pre_employment' NOT NULL,
	"consentText" text NOT NULL,
	"signatureData" text,
	"signedAt" timestamp,
	"signerIp" varchar(45),
	"signerUserAgent" text,
	"pdfUrl" text,
	"revokedAt" timestamp,
	"revokeReason" text,
	"ndprVersion" varchar(16) DEFAULT '2019',
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_consents_consentRef_unique" UNIQUE("consentRef")
);

CREATE TABLE "candidate_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"candidateRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"firstName" varchar(128) NOT NULL,
	"middleName" varchar(128),
	"lastName" varchar(128) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(20),
	"nin" varchar(11),
	"bvn" varchar(11),
	"dob" date,
	"gender" varchar(16),
	"nationality" varchar(64) DEFAULT 'Nigerian',
	"stateOfOrigin" varchar(64),
	"lgaOfOrigin" varchar(64),
	"currentAddress" text,
	"currentState" varchar(64),
	"currentLga" varchar(64),
	"addressHistory" jsonb DEFAULT '[]'::jsonb,
	"passportNumber" varchar(20),
	"passportExpiry" date,
	"consentStatus" "candidate_status" DEFAULT 'invited' NOT NULL,
	"ndprConsentAt" timestamp,
	"ndprConsentIp" varchar(45),
	"inviteToken" varchar(128),
	"inviteExpiresAt" timestamp,
	"invitedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_profiles_candidateRef_unique" UNIQUE("candidateRef"),
	CONSTRAINT "candidate_profiles_inviteToken_unique" UNIQUE("inviteToken")
);

CREATE TABLE "candidate_stories" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"screeningType" "screening_type" NOT NULL,
	"story" text NOT NULL,
	"attachmentUrls" jsonb DEFAULT '[]'::jsonb,
	"reviewedBy" integer,
	"reviewNote" text,
	"reviewedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "case_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"content" text NOT NULL,
	"authorId" integer,
	"authorName" varchar(200),
	"authorRole" varchar(100),
	"stakeholderId" integer,
	"confidential" boolean DEFAULT false NOT NULL,
	"editedAt" timestamp,
	"deletedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "case_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"filename" varchar(300) NOT NULL,
	"mimeType" varchar(100),
	"fileKey" varchar(500) NOT NULL,
	"url" text NOT NULL,
	"sizeBytes" integer,
	"category" varchar(100),
	"description" text,
	"confidential" boolean DEFAULT false NOT NULL,
	"uploadedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "case_parties" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"role" "case_party_role" DEFAULT 'subject' NOT NULL,
	"name" varchar(200) NOT NULL,
	"nin" varchar(20),
	"bvn" varchar(20),
	"phone" varchar(20),
	"email" varchar(200),
	"address" text,
	"entityType" varchar(50),
	"notes" text,
	"investigationRef" varchar(50),
	"addedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "case_stakeholders" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"role" "case_stakeholder_role" NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(200) NOT NULL,
	"organisation" varchar(200),
	"accessToken" varchar(64),
	"accessExpiresAt" timestamp,
	"canComment" boolean DEFAULT false NOT NULL,
	"canViewDocuments" boolean DEFAULT true NOT NULL,
	"lastAccessedAt" timestamp,
	"invitedBy" integer,
	"lastNotifiedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "case_stakeholders_accessToken_unique" UNIQUE("accessToken")
);

CREATE TABLE "case_timeline" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"eventType" "case_timeline_event_type" NOT NULL,
	"title" varchar(300) NOT NULL,
	"detail" jsonb,
	"actorId" integer,
	"actorName" varchar(200),
	"actorRole" varchar(100),
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"ref" varchar(30) NOT NULL,
	"title" varchar(300) NOT NULL,
	"type" "case_type" DEFAULT 'other' NOT NULL,
	"status" "case_status" DEFAULT 'draft' NOT NULL,
	"priority" "case_priority" DEFAULT 'medium' NOT NULL,
	"summary" text,
	"legalBasis" text,
	"jurisdiction" varchar(100),
	"regulatoryFramework" varchar(200),
	"leadAnalystId" integer,
	"tenantId" integer,
	"investigationRefs" jsonb DEFAULT '[]'::jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"dueAt" timestamp,
	"closedAt" timestamp,
	"closureReason" text,
	"riskScore" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cases_ref_unique" UNIQUE("ref"),
	CONSTRAINT "cases_risk_score_check" CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100))
);

CREATE TABLE "collection_sites" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"name" varchar(256) NOT NULL,
	"address" text NOT NULL,
	"city" varchar(128) NOT NULL,
	"state" varchar(64) NOT NULL,
	"phone" varchar(32),
	"email" varchar(320),
	"lat" real,
	"lng" real,
	"labPartner" varchar(128),
	"panelTypes" json DEFAULT '[]'::json NOT NULL,
	"turnaround" varchar(64),
	"status" "collection_site_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "compliance_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"reportType" "compliance_report_type" NOT NULL,
	"status" "compliance_report_status" DEFAULT 'generating' NOT NULL,
	"title" varchar(255) NOT NULL,
	"periodStart" timestamp,
	"periodEnd" timestamp,
	"xmlPayload" text,
	"pdfUrl" varchar(512),
	"submittedTo" varchar(64),
	"submittedAt" timestamp,
	"referenceNumber" varchar(128),
	"errorMessage" text,
	"metadata" jsonb,
	"generatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "continuous_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"checkRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"screeningTypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"frequency" varchar(32) DEFAULT 'monthly' NOT NULL,
	"status" "monitor_status" DEFAULT 'active' NOT NULL,
	"lastCheckedAt" timestamp,
	"nextCheckAt" timestamp,
	"alertCount" integer DEFAULT 0 NOT NULL,
	"lastAlertAt" timestamp,
	"expiresAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "continuous_checks_checkRef_unique" UNIQUE("checkRef")
);

CREATE TABLE "corporate_screening_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"profileRef" varchar(32) NOT NULL,
	"investigationRef" varchar(32),
	"tenantId" integer NOT NULL,
	"companyName" varchar(255) NOT NULL,
	"rcNumber" varchar(20) NOT NULL,
	"tinNumber" varchar(20),
	"incorporationDate" timestamp,
	"companyType" varchar(64),
	"registeredAddress" text,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"overallOutcome" "assessment_outcome",
	"cacResult" jsonb,
	"firsResult" jsonb,
	"directorsResult" jsonb,
	"sanctionsResult" jsonb,
	"riskScore" real,
	"notes" text,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "corporate_screening_profiles_profileRef_unique" UNIQUE("profileRef")
);

CREATE TABLE "correspondent_banks" (
	"id" serial PRIMARY KEY NOT NULL,
	"bankName" varchar(255) NOT NULL,
	"bic" varchar(11) NOT NULL,
	"country" varchar(2) NOT NULL,
	"city" varchar(128),
	"status" "correspondent_bank_status" DEFAULT 'active' NOT NULL,
	"riskRating" varchar(16) DEFAULT 'medium',
	"relationshipSince" timestamp,
	"lastReviewDate" timestamp,
	"nextReviewDate" timestamp,
	"services" jsonb,
	"currencies" jsonb,
	"nostroAccountCount" integer DEFAULT 0,
	"annualVolume" real,
	"amlPolicyUrl" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "correspondent_banks_bic_unique" UNIQUE("bic")
);

CREATE TABLE "criminal_record_attachments" (
	"id" serial PRIMARY KEY NOT NULL,
	"attachmentRef" varchar(32) NOT NULL,
	"recordRef" varchar(32),
	"requestRef" varchar(32),
	"tenantId" integer,
	"fileName" text NOT NULL,
	"fileUrl" text NOT NULL,
	"fileKey" text NOT NULL,
	"mimeType" varchar(128),
	"fileSize" integer,
	"documentType" varchar(64),
	"description" text,
	"uploadedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_record_attachments_attachmentRef_unique" UNIQUE("attachmentRef")
);

CREATE TABLE "criminal_record_audit" (
	"id" serial PRIMARY KEY NOT NULL,
	"auditRef" varchar(32) NOT NULL,
	"requestRef" varchar(32),
	"recordRef" varchar(32),
	"tenantId" integer,
	"action" varchar(64) NOT NULL,
	"actorId" integer,
	"actorName" text,
	"details" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_record_audit_auditRef_unique" UNIQUE("auditRef")
);

CREATE TABLE "criminal_record_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestRef" varchar(32) NOT NULL,
	"tenantId" integer,
	"investigationRef" varchar(32),
	"subjectName" text NOT NULL,
	"subjectType" "subject_type" DEFAULT 'individual' NOT NULL,
	"nin" varchar(20),
	"bvn" varchar(20),
	"dob" date,
	"gender" varchar(16),
	"nationality" varchar(64) DEFAULT 'Nigerian',
	"agency" "law_enforcement_agency" NOT NULL,
	"stateCommand" varchar(64),
	"agencyRefNumber" varchar(64),
	"contactOfficer" text,
	"contactEmail" varchar(320),
	"contactPhone" varchar(32),
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "criminal_request_status" DEFAULT 'draft' NOT NULL,
	"purpose" text,
	"requestedChecks" jsonb DEFAULT '[]'::jsonb,
	"submittedAt" timestamp,
	"acknowledgedAt" timestamp,
	"processingAt" timestamp,
	"completedAt" timestamp,
	"rejectedAt" timestamp,
	"rejectedReason" text,
	"expiresAt" timestamp,
	"requestedBy" integer,
	"assignedTo" integer,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_record_requests_requestRef_unique" UNIQUE("requestRef")
);

CREATE TABLE "criminal_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"recordRef" varchar(32) NOT NULL,
	"requestRef" varchar(32),
	"investigationRef" varchar(32),
	"tenantId" integer,
	"agency" "law_enforcement_agency" NOT NULL,
	"agencyRef" varchar(64),
	"stateCommand" varchar(64),
	"subjectName" text NOT NULL,
	"nin" varchar(20),
	"dob" date,
	"gender" varchar(16),
	"nationality" varchar(64),
	"aliases" jsonb DEFAULT '[]'::jsonb,
	"offenceCategory" "offence_category" NOT NULL,
	"offenceCode" varchar(32),
	"offenceDescription" text NOT NULL,
	"offenceDate" date,
	"offenceLocation" text,
	"offenceState" varchar(64),
	"dateArrested" date,
	"arrestingStation" text,
	"dateCharged" date,
	"chargingAuthority" text,
	"courtName" text,
	"caseNumber" varchar(64),
	"verdict" "criminal_verdict" DEFAULT 'unknown',
	"dateConvicted" date,
	"sentence" text,
	"dateReleased" date,
	"outstandingWarrant" boolean DEFAULT false,
	"warrantDetails" text,
	"warrantIssuedBy" text,
	"warrantIssuedAt" date,
	"dataSource" varchar(64) DEFAULT 'agency_response',
	"confidence" real,
	"verifiedBy" integer,
	"verifiedAt" timestamp,
	"rawPayload" jsonb,
	"recordedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "criminal_records_recordRef_unique" UNIQUE("recordRef")
);

CREATE TABLE "dapr_event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"topic" varchar(128) NOT NULL,
	"pubsubName" varchar(64) DEFAULT 'bis-pubsub' NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(32) DEFAULT 'published' NOT NULL,
	"tenantId" integer,
	"entityRef" varchar(128),
	"publishedAt" timestamp DEFAULT now() NOT NULL,
	"failReason" text
);

CREATE TABLE "data_source_health_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"dataSourceId" integer NOT NULL,
	"status" "data_source_status" NOT NULL,
	"responseMs" integer DEFAULT 0 NOT NULL,
	"httpStatus" integer,
	"error" text,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" "data_source_category" NOT NULL,
	"status" "data_source_status" DEFAULT 'active' NOT NULL,
	"provider" varchar(128),
	"baseUrl" text,
	"apiKeyRef" varchar(128),
	"description" text,
	"recordCount" integer DEFAULT 0,
	"lastSyncAt" timestamp,
	"uptimePct" real DEFAULT 100,
	"avgResponseMs" integer DEFAULT 0,
	"requestsToday" integer DEFAULT 0,
	"requestsTotal" integer DEFAULT 0,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"lastCheckedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "data_sources_code_unique" UNIQUE("code")
);

CREATE TABLE "document_vault" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"ownerId" integer,
	"ownerRef" varchar(128),
	"documentType" varchar(64) NOT NULL,
	"documentName" varchar(255) NOT NULL,
	"storageKey" varchar(512) NOT NULL,
	"mimeType" varchar(128),
	"sizeBytes" bigint,
	"checksum" varchar(128),
	"status" "document_vault_status" DEFAULT 'pending' NOT NULL,
	"expiresAt" timestamp,
	"verifiedBy" integer,
	"verifiedAt" timestamp,
	"tags" jsonb,
	"metadata" jsonb,
	"deletedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "duplicate_identity_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"investigationRef" varchar(50),
	"subjectName" varchar(200) NOT NULL,
	"faceImageUrl" varchar(500),
	"nin" varchar(20),
	"bvn" varchar(20),
	"phone" varchar(20),
	"status" "duplicate_check_status" DEFAULT 'pending' NOT NULL,
	"matchCount" integer DEFAULT 0 NOT NULL,
	"matchDetails" text,
	"confidenceScore" integer DEFAULT 0 NOT NULL,
	"requestedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp
);

CREATE TABLE "event_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"eventType" varchar(128) NOT NULL,
	"aggregateId" varchar(128),
	"tenantId" integer,
	"actorId" integer,
	"payload" json,
	"source" varchar(64),
	"traceId" varchar(64),
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "evidence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidenceRef" varchar(32) NOT NULL,
	"caseId" integer,
	"investigationId" integer,
	"tenantId" integer,
	"type" "evidence_type" NOT NULL,
	"status" "evidence_status" DEFAULT 'collected' NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"fileUrl" text,
	"fileHash" varchar(64),
	"fileSize" integer,
	"mimeType" varchar(64),
	"collectedBy" integer,
	"collectedAt" timestamp DEFAULT now(),
	"collectionLocation" text,
	"chainOfCustody" jsonb,
	"integrityVerified" boolean DEFAULT false,
	"integrityVerifiedAt" timestamp,
	"integrityVerifiedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_items_evidenceRef_unique" UNIQUE("evidenceRef")
);

CREATE TABLE "export_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"exportType" varchar(64) NOT NULL,
	"format" varchar(16) DEFAULT 'csv' NOT NULL,
	"filters" jsonb,
	"cronExpression" varchar(64) DEFAULT '0 8 * * 1' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"lastRunAt" timestamp,
	"nextRunAt" timestamp,
	"lastFileUrl" varchar(1024),
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "field_agent_playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(200) NOT NULL,
	"category" "playbook_category" NOT NULL,
	"description" text NOT NULL,
	"estimatedHours" integer DEFAULT 4 NOT NULL,
	"requiredTier" "agent_tier" DEFAULT 'junior' NOT NULL,
	"steps" text NOT NULL,
	"dataToCollect" text NOT NULL,
	"safetyNotes" text,
	"legalNotes" text,
	"nigeriaContext" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "field_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"agentCode" varchar(32) NOT NULL,
	"name" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"phone" varchar(20),
	"state" varchar(64),
	"lga" varchar(64),
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"tier" "agent_tier" DEFAULT 'junior' NOT NULL,
	"specializations" jsonb DEFAULT '[]'::jsonb,
	"tasksCompleted" integer DEFAULT 0 NOT NULL,
	"tasksActive" integer DEFAULT 0 NOT NULL,
	"rating" real DEFAULT 0,
	"gpsLat" real,
	"gpsLng" real,
	"lastSeen" timestamp,
	"notes" text,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_agents_agentCode_unique" UNIQUE("agentCode"),
	CONSTRAINT "field_agents_email_unique" UNIQUE("email")
);

CREATE TABLE "field_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"taskRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"agentId" varchar(64) NOT NULL,
	"agentName" varchar(255) NOT NULL,
	"taskType" "task_type" NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"subjectName" varchar(255),
	"address" text,
	"state" varchar(64),
	"lga" varchar(64),
	"gpsLat" real,
	"gpsLng" real,
	"deadline" timestamp,
	"instructions" text,
	"result" jsonb,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "field_tasks_taskRef_unique" UNIQUE("taskRef")
);

CREATE TABLE "field_visit_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitRef" varchar(32) NOT NULL,
	"taskRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"agentId" varchar(64) NOT NULL,
	"agentName" varchar(255) NOT NULL,
	"checkInAt" timestamp,
	"checkInLat" real,
	"checkInLng" real,
	"checkOutAt" timestamp,
	"checkOutLat" real,
	"checkOutLng" real,
	"durationMinutes" integer,
	"subjectPresent" boolean,
	"addressConfirmed" boolean,
	"findings" text,
	"structuredFindings" jsonb,
	"photoUrls" jsonb DEFAULT '[]'::jsonb,
	"dataCompleteness" real,
	"sourcesChecked" jsonb DEFAULT '[]'::jsonb,
	"sourcesReturned" jsonb DEFAULT '[]'::jsonb,
	"recommendedNextSteps" jsonb DEFAULT '[]'::jsonb,
	"outcome" varchar(32),
	"submittedAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "field_visit_reports_visitRef_unique" UNIQUE("visitRef")
);

CREATE TABLE "field_visit_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"investigationId" integer,
	"caseId" integer,
	"agentId" integer,
	"subjectName" varchar(255),
	"subjectAddress" text,
	"visitType" varchar(64) DEFAULT 'residential' NOT NULL,
	"status" "field_visit_schedule_status" DEFAULT 'scheduled' NOT NULL,
	"scheduledAt" timestamp NOT NULL,
	"confirmedAt" timestamp,
	"completedAt" timestamp,
	"cancelledAt" timestamp,
	"cancellationReason" text,
	"notes" text,
	"coordinates" jsonb,
	"metadata" jsonb,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "fluvio_topic_registry" (
	"id" serial PRIMARY KEY NOT NULL,
	"topicName" varchar(128) NOT NULL,
	"description" text,
	"partitions" integer DEFAULT 1,
	"replication" integer DEFAULT 1,
	"retentionMs" bigint DEFAULT 604800000,
	"isActive" boolean DEFAULT true,
	"lastMessageAt" timestamp,
	"messageCount" bigint DEFAULT 0,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "fluvio_topic_registry_topicName_unique" UNIQUE("topicName")
);

CREATE TABLE "force_credit_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"reference" varchar(256) NOT NULL,
	"tenantId" varchar(64) NOT NULL,
	"amountKobo" integer NOT NULL,
	"auditNote" text NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"requesterId" integer NOT NULL,
	"approverId" integer,
	"approvalNote" text,
	"ledgerTransferId" varchar(128),
	"requestedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"approvedAt" timestamp,
	"executedAt" timestamp,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "force_credit_approvers" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"designatedBy" integer,
	"designatedAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "frozen_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" varchar(64) NOT NULL,
	"accountName" varchar(255),
	"reason" text NOT NULL,
	"frozenBy" integer,
	"frozenByName" varchar(255),
	"affectedTransactions" integer DEFAULT 0 NOT NULL,
	"frozenAt" timestamp DEFAULT now() NOT NULL,
	"unfrozenAt" timestamp,
	"unfrozenBy" integer,
	"unfrozenByName" varchar(255),
	"notes" text
);

CREATE TABLE "goaml_filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"filingRef" varchar(32) NOT NULL,
	"investigationRef" varchar(32),
	"status" "str_status" DEFAULT 'draft' NOT NULL,
	"reportType" varchar(32) DEFAULT 'STR' NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"subjectBvn" varchar(20),
	"subjectNin" varchar(20),
	"subjectAccountNumber" varchar(30),
	"subjectBank" varchar(100),
	"transactionDate" timestamp,
	"transactionAmount" real,
	"transactionCurrency" varchar(3) DEFAULT 'NGN',
	"suspiciousActivity" text NOT NULL,
	"narrativeDetails" text,
	"goamlXml" text,
	"goamlReferenceNumber" varchar(64),
	"submittedAt" timestamp,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "goaml_filings_filingRef_unique" UNIQUE("filingRef")
);

CREATE TABLE "hosted_verification_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"tenantId" integer,
	"investigationRef" varchar(50),
	"subjectName" varchar(200),
	"requiredChecks" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"status" "hosted_link_status" DEFAULT 'active' NOT NULL,
	"completedAt" timestamp,
	"resultRef" varchar(50),
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "hosted_verification_links_token_unique" UNIQUE("token")
);

CREATE TABLE "incoming_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"channelId" integer NOT NULL,
	"channelType" "channel_type" NOT NULL,
	"sender" varchar(100) NOT NULL,
	"content" text NOT NULL,
	"status" "incoming_report_status" DEFAULT 'new' NOT NULL,
	"riskScore" integer DEFAULT 0 NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"attachmentCount" integer DEFAULT 0 NOT NULL,
	"linkedSubjectRef" varchar(32),
	"linkedInvestigationRef" varchar(32),
	"assignedTo" integer,
	"metadata" text,
	"receivedAt" timestamp DEFAULT now() NOT NULL,
	"processedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "insider_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"category" "insider_category" NOT NULL,
	"severity" "insider_severity" DEFAULT 'medium' NOT NULL,
	"status" "insider_event_status" DEFAULT 'open' NOT NULL,
	"anomalyScore" real,
	"driftScore" real,
	"sourceIp" varchar(64),
	"userAgent" text,
	"resourcePath" text,
	"payloadBytes" bigint,
	"ruleId" varchar(64),
	"evidence" jsonb,
	"assignedTo" integer,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"resolution" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "investigation_case_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"investigationId" integer NOT NULL,
	"caseId" integer NOT NULL,
	"linkedBy" integer,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "investigations" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"ref" varchar(32) NOT NULL,
	"subjectType" "subject_type" NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"country" varchar(3) DEFAULT 'NG' NOT NULL,
	"tier" "tier" DEFAULT 'standard' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "investigation_status" DEFAULT 'pending' NOT NULL,
	"riskScore" real,
	"riskTier" "risk_tier",
	"nin" varchar(11),
	"bvn" varchar(11),
	"rcNumber" varchar(20),
	"phone" varchar(20),
	"email" varchar(320),
	"address" text,
	"purpose" text,
	"assignedTo" integer,
	"createdBy" integer NOT NULL,
	"dataSources" jsonb,
	"gatewayResults" jsonb,
	"riskFactors" jsonb,
	"dueAt" timestamp,
	"candidateProfileId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "investigations_ref_unique" UNIQUE("ref"),
	CONSTRAINT "investigations_risk_score_check" CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100))
);

CREATE TABLE "keycloak_auth_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" varchar(128) NOT NULL,
	"nonce" varchar(128) NOT NULL,
	"codeVerifierEncrypted" text NOT NULL,
	"redirectUri" text NOT NULL,
	"returnTo" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "keycloak_auth_transactions_state_unique" UNIQUE("state")
);

CREATE TABLE "keycloak_onboarding_drafts" (
	"id" varchar(128) PRIMARY KEY NOT NULL,
	"payloadEncrypted" text NOT NULL,
	"claimedByUserId" integer,
	"claimedAt" timestamp,
	"consumedAt" timestamp,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "keycloak_refresh_sessions" (
	"familyId" varchar(128) PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"refreshTokenEncrypted" text NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"leaseId" varchar(128),
	"leaseExpiresAt" timestamp,
	"expiresAt" timestamp NOT NULL,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "keycloak_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"keycloakId" varchar(128),
	"bisUserId" integer,
	"operation" varchar(32) NOT NULL,
	"status" varchar(16) NOT NULL,
	"detail" jsonb,
	"errorMessage" text,
	"syncedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "kyc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"kycRecordId" integer NOT NULL,
	"tenantId" integer,
	"documentType" varchar(64) NOT NULL,
	"fileName" varchar(255) NOT NULL,
	"fileKey" varchar(512) NOT NULL,
	"fileUrl" text NOT NULL,
	"fileSizeBytes" integer,
	"mimeType" varchar(64),
	"reviewStatus" "kyc_document_review_status" DEFAULT 'pending' NOT NULL,
	"reviewedBy" integer,
	"reviewNote" text,
	"reviewedAt" timestamp,
	"uploadedBy" integer NOT NULL,
	"capturedAt" timestamp,
	"previousOcrData" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "kyc_ocr_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"documentId" integer NOT NULL,
	"fieldName" varchar(64) NOT NULL,
	"oldValue" text,
	"oldConfidence" real,
	"newValue" text,
	"newConfidence" real,
	"triggeredBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "kyc_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"investigationId" integer,
	"subjectName" varchar(255) NOT NULL,
	"nin" varchar(11),
	"bvn" varchar(11),
	"dob" varchar(10),
	"phone" varchar(20),
	"status" "kyc_status" DEFAULT 'pending' NOT NULL,
	"riskScore" real,
	"ninResult" jsonb,
	"bvnResult" jsonb,
	"sanctionsResult" jsonb,
	"pepResult" jsonb,
	"creditResult" jsonb,
	"subjectRef" varchar(64),
	"onboardingApplicationId" integer,
	"biometricStatus" varchar(32) DEFAULT 'not_enrolled',
	"biometricFaceId" varchar(128),
	"documentOcrData" jsonb,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_records_risk_score_check" CHECK ("riskScore" IS NULL OR ("riskScore" >= 0 AND "riskScore" <= 100))
);

CREATE TABLE "kyc_scheduled_reruns" (
	"id" serial PRIMARY KEY NOT NULL,
	"kycRecordId" integer NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"nin" varchar(20),
	"bvn" varchar(22),
	"dob" varchar(20),
	"phone" varchar(20),
	"scheduledAt" timestamp NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"resultKycRecordId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "letters_of_credit" (
	"id" serial PRIMARY KEY NOT NULL,
	"lcRef" varchar(32) NOT NULL,
	"type" "lc_type" DEFAULT 'sight' NOT NULL,
	"status" "lc_status" DEFAULT 'draft' NOT NULL,
	"amount" real NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"applicantName" varchar(255) NOT NULL,
	"applicantBank" varchar(128) NOT NULL,
	"applicantCountry" varchar(2) DEFAULT 'NG',
	"beneficiaryName" varchar(255) NOT NULL,
	"beneficiaryBank" varchar(128),
	"beneficiaryCountry" varchar(2),
	"issuingBank" varchar(128) NOT NULL,
	"advisingBank" varchar(128),
	"confirmingBank" varchar(128),
	"goodsDescription" text,
	"portOfLoading" varchar(128),
	"portOfDischarge" varchar(128),
	"latestShipmentDate" timestamp,
	"expiryDate" timestamp,
	"presentationPeriod" integer DEFAULT 21,
	"documents" jsonb,
	"amendments" jsonb,
	"discrepancies" jsonb,
	"investigationId" integer,
	"tenantId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "letters_of_credit_lcRef_unique" UNIQUE("lcRef")
);

CREATE TABLE "lex_agencies" (
	"id" serial PRIMARY KEY NOT NULL,
	"agencyCode" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"type" "lex_agency_type" NOT NULL,
	"state" "nigerian_state" NOT NULL,
	"lga" varchar(100),
	"commandUnit" varchar(255),
	"contactName" varchar(255),
	"contactPhone" varchar(20),
	"contactEmail" varchar(320),
	"status" "lex_agency_status" DEFAULT 'active' NOT NULL,
	"registeredBy" integer,
	"registeredAt" timestamp DEFAULT now() NOT NULL,
	"suspendedAt" timestamp,
	"suspendedReason" text,
	"notes" text,
	"flagged" boolean DEFAULT false NOT NULL,
	"flagReason" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lex_agencies_agencyCode_unique" UNIQUE("agencyCode")
);

CREATE TABLE "lex_submissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"submissionRef" varchar(32) NOT NULL,
	"agencyId" integer NOT NULL,
	"submitterId" integer,
	"channel" "lex_channel" DEFAULT 'web' NOT NULL,
	"incidentType" "lex_incident_type" NOT NULL,
	"incidentState" "nigerian_state" NOT NULL,
	"incidentLga" varchar(100),
	"incidentAddress" text,
	"gpsLat" real,
	"gpsLng" real,
	"incidentDate" timestamp,
	"subjectName" varchar(255),
	"subjectNin" varchar(11),
	"subjectPhone" varchar(20),
	"subjectAddress" text,
	"narrative" text NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb,
	"status" "lex_submission_status" DEFAULT 'pending' NOT NULL,
	"validationScore" integer,
	"validationNotes" jsonb,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"linkedCaseId" integer,
	"rejectionReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "lex_submissions_submissionRef_unique" UNIQUE("submissionRef")
);

CREATE TABLE "lex_submitters" (
	"id" serial PRIMARY KEY NOT NULL,
	"submitterId" varchar(64) NOT NULL,
	"agencyId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"rank" varchar(100),
	"phone" varchar(20) NOT NULL,
	"pinHash" varchar(255) NOT NULL,
	"reputationScore" integer DEFAULT 50 NOT NULL,
	"status" "lex_submitter_status" DEFAULT 'active' NOT NULL,
	"lastSubmissionAt" timestamp,
	"totalSubmissions" integer DEFAULT 0 NOT NULL,
	"validatedSubmissions" integer DEFAULT 0 NOT NULL,
	"rejectedSubmissions" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"revokedAt" timestamp,
	CONSTRAINT "lex_submitters_submitterId_unique" UNIQUE("submitterId")
);

CREATE TABLE "messaging_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"channelType" "channel_type" NOT NULL,
	"name" varchar(100) NOT NULL,
	"identifier" varchar(100) NOT NULL,
	"status" "channel_status" DEFAULT 'inactive' NOT NULL,
	"webhookUrl" varchar(500),
	"apiKey" varchar(255),
	"totalReports" integer DEFAULT 0 NOT NULL,
	"todayReports" integer DEFAULT 0 NOT NULL,
	"activeUsers" integer DEFAULT 0 NOT NULL,
	"lastActivityAt" timestamp,
	"config" text,
	"tenantId" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ml_model_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"modelName" varchar(128) NOT NULL,
	"version" varchar(32) NOT NULL,
	"modelType" varchar(64) NOT NULL,
	"status" "ml_model_status" DEFAULT 'staging' NOT NULL,
	"artifactPath" varchar(512),
	"metrics" jsonb,
	"hyperparams" jsonb,
	"trainedOn" timestamp,
	"promotedAt" timestamp,
	"deprecatedAt" timestamp,
	"promotedBy" integer,
	"description" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "mojaloop_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(128) NOT NULL,
	"externalRef" varchar(128),
	"rail" varchar(32) DEFAULT 'mojaloop' NOT NULL,
	"originatorAccount" varchar(64) NOT NULL,
	"originatorName" varchar(255),
	"beneficiaryAccount" varchar(64) NOT NULL,
	"beneficiaryName" varchar(255),
	"beneficiaryBankCode" varchar(16),
	"amountKobo" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"narration" text,
	"status" "mojaloop_status" DEFAULT 'initiated' NOT NULL,
	"failureReason" text,
	"metadata" jsonb,
	"completedAt" timestamp,
	"initiatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mojaloop_transfers_txRef_unique" UNIQUE("txRef"),
	CONSTRAINT "mjl_amount_check" CHECK ("amountKobo" > 0)
);

CREATE TABLE "monitors" (
	"id" serial PRIMARY KEY NOT NULL,
	"monitorRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"subjectName" varchar(255) NOT NULL,
	"subjectRef" varchar(64),
	"type" "monitor_type" NOT NULL,
	"status" "monitor_status" DEFAULT 'active' NOT NULL,
	"frequency" varchar(32) DEFAULT 'daily' NOT NULL,
	"lastCheckedAt" timestamp,
	"nextCheckAt" timestamp,
	"alertCount" integer DEFAULT 0 NOT NULL,
	"lastAlertAt" timestamp,
	"expiresAt" timestamp,
	"config" jsonb,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "monitors_monitorRef_unique" UNIQUE("monitorRef")
);

CREATE TABLE "ng_court_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"resultId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"courtType" "court_type" NOT NULL,
	"courtName" varchar(255),
	"state" varchar(64),
	"caseNumber" varchar(128),
	"offence" text,
	"verdict" varchar(128),
	"sentence" text,
	"hearingDate" date,
	"dispositionDate" date,
	"isAppeal" boolean DEFAULT false,
	"rawData" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ng_professional_licences" (
	"id" serial PRIMARY KEY NOT NULL,
	"resultId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"professionalBody" "professional_body" NOT NULL,
	"licenceNumber" varchar(128),
	"membershipGrade" varchar(64),
	"issueDate" date,
	"expiryDate" date,
	"status" "assessment_outcome" DEFAULT 'pending' NOT NULL,
	"suspensionReason" text,
	"verificationDate" date,
	"rawData" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "nigerian_data_bundle_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"runRef" varchar(32) NOT NULL,
	"fullName" varchar(255),
	"nin" varchar(20),
	"bvn" varchar(22),
	"phone" varchar(20),
	"dateOfBirth" varchar(20),
	"selectedSources" jsonb NOT NULL,
	"results" jsonb NOT NULL,
	"overallScore" integer DEFAULT 0 NOT NULL,
	"verifiedCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nigerian_data_bundle_runs_runRef_unique" UNIQUE("runRef")
);

CREATE TABLE "nostro_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountNumber" varchar(64) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"correspondentBankId" integer,
	"balance" real DEFAULT 0,
	"lastReconciled" timestamp,
	"status" varchar(32) DEFAULT 'active',
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"type" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"link" varchar(512),
	"read" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "ollama_models" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"displayName" varchar(200),
	"family" varchar(50),
	"parameterSize" varchar(20),
	"quantization" varchar(20),
	"sizeBytes" integer,
	"status" varchar(20) DEFAULT 'available' NOT NULL,
	"useCase" jsonb DEFAULT '[]'::jsonb,
	"isDefault" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ollama_models_name_unique" UNIQUE("name")
);

CREATE TABLE "onboarding_applications" (
	"id" serial PRIMARY KEY NOT NULL,
	"referenceId" varchar(64) NOT NULL,
	"entityType" varchar(32) NOT NULL,
	"legalName" varchar(255) NOT NULL,
	"tradingName" varchar(255),
	"countryCode" varchar(8),
	"stateProvince" varchar(128),
	"city" varchar(128),
	"address" text,
	"website" varchar(255),
	"businessCategory" varchar(128),
	"contactName" varchar(255),
	"contactEmail" varchar(255),
	"contactPhone" varchar(64),
	"contactTitle" varchar(128),
	"useCase" text,
	"pepDeclaration" boolean DEFAULT false,
	"agreedToTerms" boolean DEFAULT false,
	"status" "onboarding_application_status" DEFAULT 'draft' NOT NULL,
	"stakeholders" jsonb DEFAULT '[]'::jsonb,
	"documentUrls" jsonb DEFAULT '[]'::jsonb,
	"createdBy" varchar(255),
	"adminNotes" text,
	"reviewerLog" jsonb DEFAULT '[]'::jsonb,
	"slaDeadline" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "payment_rails_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(128) NOT NULL,
	"rail" varchar(32) NOT NULL,
	"direction" varchar(8) DEFAULT 'outbound' NOT NULL,
	"amountKobo" bigint,
	"currency" varchar(3) DEFAULT 'NGN',
	"status" varchar(32) NOT NULL,
	"requestBody" jsonb,
	"responseBody" jsonb,
	"errorMessage" text,
	"latencyMs" integer,
	"initiatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "permify_relationship_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity" varchar(64) NOT NULL,
	"entityId" varchar(128) NOT NULL,
	"relation" varchar(64) NOT NULL,
	"subject" varchar(64) NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"operation" varchar(16) DEFAULT 'write' NOT NULL,
	"tenantId" integer,
	"actorId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "platform_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"namespace" varchar(64) DEFAULT 'default' NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" jsonb,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"updatedBy" varchar(255)
);

CREATE TABLE "push_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"body" varchar(512) NOT NULL,
	"url" text,
	"tag" varchar(64),
	"sentCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"deactivatedCount" integer DEFAULT 0 NOT NULL,
	"createdBy" integer,
	"sentAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"token" text NOT NULL,
	"platform" varchar(16) DEFAULT 'fcm' NOT NULL,
	"device_label" varchar(128),
	"p256dh" text,
	"auth" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "regulatory_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reportRef" varchar(32) NOT NULL,
	"type" "regulatory_report_type" NOT NULL,
	"status" "regulatory_report_status" DEFAULT 'draft' NOT NULL,
	"title" varchar(255) NOT NULL,
	"periodStart" timestamp,
	"periodEnd" timestamp,
	"regulatorName" varchar(128) DEFAULT 'NFIU',
	"submissionDeadline" timestamp,
	"fileUrl" text,
	"submittedAt" timestamp,
	"submittedBy" integer,
	"acknowledgementRef" varchar(64),
	"rejectionReason" text,
	"metadata" jsonb,
	"tenantId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regulatory_reports_reportRef_unique" UNIQUE("reportRef")
);

CREATE TABLE "report_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(16) DEFAULT '#6B7280',
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"reportRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"template" varchar(64) NOT NULL,
	"title" varchar(255) NOT NULL,
	"format" "report_format" DEFAULT 'pdf' NOT NULL,
	"status" "report_status" DEFAULT 'generating' NOT NULL,
	"fileUrl" text,
	"sections" jsonb,
	"generatedBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reports_reportRef_unique" UNIQUE("reportRef")
);

CREATE TABLE "risk_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"subjectRef" varchar(128) NOT NULL,
	"subjectName" varchar(255),
	"subjectType" varchar(32) DEFAULT 'individual' NOT NULL,
	"overallScore" real,
	"amlScore" real,
	"kycScore" real,
	"sanctionsScore" real,
	"fraudScore" real,
	"pepExposure" boolean DEFAULT false,
	"sanctionsHit" boolean DEFAULT false,
	"adverseMedia" boolean DEFAULT false,
	"riskBand" varchar(16) DEFAULT 'medium' NOT NULL,
	"status" "risk_profile_status" DEFAULT 'active' NOT NULL,
	"mlModelVersion" varchar(64),
	"factors" jsonb,
	"lastScoredAt" timestamp,
	"nextReviewAt" timestamp,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "rp_score_check" CHECK ("overallScore" IS NULL OR ("overallScore" >= 0 AND "overallScore" <= 100))
);

CREATE TABLE "rule_evaluations" (
	"id" serial PRIMARY KEY NOT NULL,
	"ruleId" integer NOT NULL,
	"subjectRef" varchar(255) NOT NULL,
	"metric" varchar(64) NOT NULL,
	"value" real NOT NULL,
	"threshold" real NOT NULL,
	"triggered" boolean DEFAULT false NOT NULL,
	"alertCreated" boolean DEFAULT false NOT NULL,
	"context" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sanctions_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"listType" "sanctions_list_type" NOT NULL,
	"listName" varchar(128) NOT NULL,
	"source" varchar(255),
	"version" varchar(32),
	"entryCount" integer DEFAULT 0,
	"isActive" boolean DEFAULT true,
	"lastSyncAt" timestamp,
	"nextSyncAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sanctions_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"listId" integer,
	"subjectRef" varchar(128) NOT NULL,
	"subjectName" varchar(255),
	"matchedName" varchar(255),
	"matchScore" real,
	"matchType" varchar(32),
	"status" "sanctions_match_status" DEFAULT 'pending_review' NOT NULL,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNotes" text,
	"linkedAlertId" integer,
	"metadata" jsonb,
	"detectedAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sm_score_check" CHECK ("matchScore" IS NULL OR ("matchScore" >= 0 AND "matchScore" <= 100))
);

CREATE TABLE "sar_filings" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"sarRef" varchar(32) NOT NULL,
	"status" "sar_status" DEFAULT 'draft' NOT NULL,
	"category" "sar_category" NOT NULL,
	"title" varchar(255) NOT NULL,
	"narrative" text NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"subjectNin" varchar(11),
	"subjectBvn" varchar(11),
	"subjectDob" varchar(10),
	"subjectAddress" text,
	"subjectOccupation" varchar(128),
	"suspiciousAmount" real,
	"suspiciousCurrency" varchar(3) DEFAULT 'NGN',
	"activityStartDate" timestamp,
	"activityEndDate" timestamp,
	"relatedTransactions" jsonb,
	"relatedInvestigationId" integer,
	"relatedGoamlFilingId" integer,
	"createdBy" integer,
	"reviewedBy" integer,
	"reviewedAt" timestamp,
	"reviewNotes" text,
	"approvedBy" integer,
	"approvedAt" timestamp,
	"filedAt" timestamp,
	"filedWith" varchar(64) DEFAULT 'NFIU',
	"filingReference" varchar(64),
	"acknowledgedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sar_filings_sarRef_unique" UNIQUE("sarRef")
);

CREATE TABLE "scheduled_broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar(128) NOT NULL,
	"body" varchar(512) NOT NULL,
	"url" text,
	"tag" varchar(64),
	"scheduledAt" bigint NOT NULL,
	"status" "push_broadcast_status" DEFAULT 'scheduled' NOT NULL,
	"createdBy" integer,
	"dispatchedAt" bigint,
	"broadcastId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "screening_ai_summaries" (
	"id" serial PRIMARY KEY NOT NULL,
	"summaryRef" varchar(32) NOT NULL,
	"investigationRef" varchar(32) NOT NULL,
	"orderRefs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overallRisk" varchar(16) NOT NULL,
	"headline" text NOT NULL,
	"keyFindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"redFlags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"fullNarrative" text NOT NULL,
	"compositeScore" real,
	"modelVersion" varchar(32) DEFAULT 'gpt-4o',
	"generatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_ai_summaries_summaryRef_unique" UNIQUE("summaryRef")
);

CREATE TABLE "screening_assessments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"packageId" integer,
	"screeningType" "screening_type" NOT NULL,
	"clearConditions" jsonb,
	"considerConditions" jsonb,
	"adverseConditions" jsonb,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "screening_geos" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"state" varchar(64) NOT NULL,
	"screeningType" "screening_type" NOT NULL,
	"lookbackYears" integer,
	"excludedOffences" jsonb DEFAULT '[]'::jsonb,
	"requiresConsent" boolean DEFAULT true NOT NULL,
	"disclosureText" text,
	"isActive" boolean DEFAULT true NOT NULL,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "screening_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"candidateId" integer NOT NULL,
	"packageId" integer,
	"programId" integer,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"overallOutcome" "assessment_outcome",
	"screeningTypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"etaAt" timestamp,
	"completedAt" timestamp,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"temporalRunId" varchar(128),
	"tigerBeetleRef" varchar(64),
	"investigationRef" varchar(32),
	"priceNgn" integer DEFAULT 0,
	"notes" text,
	"createdBy" integer,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_orders_orderRef_unique" UNIQUE("orderRef")
);

CREATE TABLE "screening_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"packageRef" varchar(32) NOT NULL,
	"tenantId" integer,
	"name" varchar(128) NOT NULL,
	"description" text,
	"tier" "package_tier" DEFAULT 'standard' NOT NULL,
	"screeningTypes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"priceNgn" integer DEFAULT 0 NOT NULL,
	"etaHours" integer DEFAULT 48 NOT NULL,
	"isPublic" boolean DEFAULT false NOT NULL,
	"isActive" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_packages_packageRef_unique" UNIQUE("packageRef")
);

CREATE TABLE "screening_programs" (
	"id" serial PRIMARY KEY NOT NULL,
	"programRef" varchar(32) NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"description" text,
	"packageId" integer,
	"geoRules" jsonb,
	"assessRules" jsonb,
	"isActive" boolean DEFAULT true NOT NULL,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "screening_programs_programRef_unique" UNIQUE("programRef")
);

CREATE TABLE "screening_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"requestRef" varchar(32) NOT NULL,
	"investigationId" integer,
	"type" "screening_type" NOT NULL,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"subjectName" varchar(255) NOT NULL,
	"subjectType" "subject_type" DEFAULT 'individual' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"requestData" jsonb,
	"result" jsonb,
	"resultSummary" text,
	"riskScore" real,
	"processedBy" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	CONSTRAINT "screening_requests_requestRef_unique" UNIQUE("requestRef")
);

CREATE TABLE "screening_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"orderId" integer NOT NULL,
	"screeningType" "screening_type" NOT NULL,
	"status" "screening_status" DEFAULT 'pending' NOT NULL,
	"outcome" "assessment_outcome",
	"rawResult" jsonb,
	"summary" text,
	"riskScore" real,
	"dataSourceRef" varchar(64),
	"externalRef" varchar(128),
	"completedAt" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "sepa_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"endToEndId" varchar(64) NOT NULL,
	"paymentType" "sepa_payment_type" NOT NULL,
	"status" "sepa_payment_status" DEFAULT 'pending' NOT NULL,
	"amount" real NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"debtorName" varchar(255) NOT NULL,
	"debtorIban" varchar(34) NOT NULL,
	"debtorBic" varchar(11),
	"creditorName" varchar(255) NOT NULL,
	"creditorIban" varchar(34) NOT NULL,
	"creditorBic" varchar(11),
	"remittanceInfo" text,
	"executionDate" timestamp,
	"settlementDate" timestamp,
	"rejectReason" varchar(255),
	"transactionId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sepa_payments_endToEndId_unique" UNIQUE("endToEndId")
);

CREATE TABLE "service_health_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"service" varchar(64) NOT NULL,
	"status" varchar(16) NOT NULL,
	"latencyMs" integer,
	"detail" jsonb,
	"checkedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "social_mentions" (
	"id" serial PRIMARY KEY NOT NULL,
	"monitorId" integer NOT NULL,
	"platform" "social_platform" NOT NULL,
	"content" text NOT NULL,
	"author" varchar(100) NOT NULL,
	"authorHandle" varchar(100),
	"externalUrl" varchar(500),
	"sentiment" "mention_sentiment" DEFAULT 'neutral' NOT NULL,
	"riskScore" integer DEFAULT 0 NOT NULL,
	"keywords" text,
	"engagementCount" integer DEFAULT 0 NOT NULL,
	"isVerified" boolean DEFAULT false NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"isAcknowledged" boolean DEFAULT false NOT NULL,
	"acknowledgedBy" integer,
	"publishedAt" timestamp NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "social_monitor_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"keywords" text NOT NULL,
	"platforms" text NOT NULL,
	"subjectRef" varchar(32),
	"investigationRef" varchar(32),
	"isActive" boolean DEFAULT true NOT NULL,
	"alertThreshold" integer DEFAULT 60 NOT NULL,
	"totalMentions" integer DEFAULT 0 NOT NULL,
	"criticalMentions" integer DEFAULT 0 NOT NULL,
	"lastMentionAt" timestamp,
	"tenantId" integer,
	"createdBy" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "stablecoin_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(128) NOT NULL,
	"txHash" varchar(128),
	"network" varchar(32) NOT NULL,
	"currency" varchar(16) NOT NULL,
	"fromAddress" varchar(128),
	"toAddress" varchar(128),
	"amountUnits" varchar(64) NOT NULL,
	"status" "stablecoin_status" DEFAULT 'pending' NOT NULL,
	"blockNumber" bigint,
	"gasUsed" varchar(64),
	"sandbox" boolean DEFAULT false,
	"metadata" jsonb,
	"confirmedAt" timestamp,
	"initiatedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stablecoin_transactions_txRef_unique" UNIQUE("txRef")
);

CREATE TABLE "swift_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"uetr" varchar(64) NOT NULL,
	"messageType" "swift_message_type" NOT NULL,
	"status" "swift_message_status" DEFAULT 'received' NOT NULL,
	"senderBic" varchar(11) NOT NULL,
	"receiverBic" varchar(11) NOT NULL,
	"amount" real NOT NULL,
	"currency" varchar(3) NOT NULL,
	"valueDate" timestamp,
	"orderingCustomer" varchar(255),
	"beneficiaryCustomer" varchar(255),
	"remittanceInfo" text,
	"rawMessage" text,
	"parsedFields" jsonb,
	"complianceStatus" varchar(32) DEFAULT 'pending',
	"complianceNotes" text,
	"transactionId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "swift_messages_uetr_unique" UNIQUE("uetr")
);

CREATE TABLE "temporal_workflow_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflowId" varchar(256) NOT NULL,
	"runId" varchar(256),
	"workflowType" varchar(128) NOT NULL,
	"namespace" varchar(128) DEFAULT 'bis' NOT NULL,
	"status" varchar(32) DEFAULT 'running' NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"errorMessage" text,
	"tenantId" integer,
	"initiatedBy" integer,
	"entityRef" varchar(128),
	"entityType" varchar(64),
	"startedAt" timestamp DEFAULT now() NOT NULL,
	"completedAt" timestamp,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporal_workflow_state_workflowId_unique" UNIQUE("workflowId")
);

CREATE TABLE "tenant_billing_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"tigerbeetleAccountId" varchar(64),
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"balanceKobo" bigint DEFAULT 0 NOT NULL,
	"creditLimitKobo" bigint DEFAULT 0,
	"billingEmail" varchar(255),
	"billingCycle" varchar(16) DEFAULT 'monthly' NOT NULL,
	"nextBillingAt" timestamp,
	"lastBilledAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_billing_accounts_tenantId_unique" UNIQUE("tenantId"),
	CONSTRAINT "tba_balance_check" CHECK ("balanceKobo" >= 0)
);

CREATE TABLE "tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"plan" "tenant_plan" DEFAULT 'starter' NOT NULL,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"contactEmail" varchar(255),
	"contactName" varchar(255),
	"country" varchar(64),
	"industry" varchar(128),
	"monthlyQuota" integer DEFAULT 100 NOT NULL,
	"usedThisMonth" integer DEFAULT 0 NOT NULL,
	"ngnBalance" real DEFAULT 0 NOT NULL,
	"logoUrl" text,
	"primaryColor" varchar(32),
	"reportFooter" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);

CREATE TABLE "tigerbeetle_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" varchar(64) NOT NULL,
	"tenantId" integer,
	"ledger" integer DEFAULT 1 NOT NULL,
	"code" integer DEFAULT 700 NOT NULL,
	"creditsPending" bigint DEFAULT 0,
	"creditsPosted" bigint DEFAULT 0,
	"debitsPending" bigint DEFAULT 0,
	"debitsPosted" bigint DEFAULT 0,
	"flags" integer DEFAULT 0,
	"lastReconciledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_accounts_accountId_unique" UNIQUE("accountId")
);

CREATE TABLE "tigerbeetle_transfers" (
	"id" serial PRIMARY KEY NOT NULL,
	"transferId" varchar(64) NOT NULL,
	"debitAccountId" varchar(64) NOT NULL,
	"creditAccountId" varchar(64) NOT NULL,
	"amount" bigint NOT NULL,
	"ledger" integer DEFAULT 1 NOT NULL,
	"code" integer DEFAULT 1 NOT NULL,
	"flags" integer DEFAULT 0,
	"userData" jsonb,
	"tenantId" integer,
	"txRef" varchar(128),
	"reconciledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tigerbeetle_transfers_transferId_unique" UNIQUE("transferId")
);

CREATE TABLE "token_usage_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"tokenId" integer NOT NULL,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) DEFAULT 'GET' NOT NULL,
	"statusCode" integer,
	"latencyMs" integer,
	"ipAddress" varchar(45),
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"txRef" varchar(64) NOT NULL,
	"idempotencyKey" varchar(256),
	"tigerBeetleId" varchar(32),
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'pending' NOT NULL,
	"amount" real NOT NULL,
	"currency" varchar(3) DEFAULT 'NGN' NOT NULL,
	"amountUsd" real,
	"originatorName" varchar(255) NOT NULL,
	"originatorAccount" varchar(64),
	"originatorBank" varchar(128),
	"originatorCountry" varchar(2) DEFAULT 'NG',
	"beneficiaryName" varchar(255) NOT NULL,
	"beneficiaryAccount" varchar(64),
	"beneficiaryBank" varchar(128),
	"beneficiaryCountry" varchar(2) DEFAULT 'NG',
	"purposeCode" varchar(16),
	"narration" text,
	"amlRiskLevel" "aml_risk_level" DEFAULT 'low',
	"amlScore" real DEFAULT 0,
	"amlFlags" jsonb,
	"flaggedAt" timestamp,
	"flaggedBy" integer,
	"investigationId" integer,
	"goamlFilingId" integer,
	"valueDate" timestamp,
	"archivedTier" varchar(8),
	"archivedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"deletedBy" integer,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_txRef_unique" UNIQUE("txRef"),
	CONSTRAINT "transactions_idempotencyKey_unique" UNIQUE("idempotencyKey")
);

CREATE TABLE "travel_rule_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"recordRef" varchar(64) NOT NULL,
	"transactionId" integer,
	"status" "travel_rule_status" DEFAULT 'pending' NOT NULL,
	"thresholdAmount" real DEFAULT 1000 NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"originatorName" varchar(255) NOT NULL,
	"originatorAccount" varchar(64),
	"originatorAddress" text,
	"originatorCountry" varchar(2),
	"originatorDob" varchar(10),
	"originatorId" varchar(64),
	"beneficiaryName" varchar(255) NOT NULL,
	"beneficiaryAccount" varchar(64),
	"beneficiaryAddress" text,
	"beneficiaryCountry" varchar(2),
	"vasp" varchar(128),
	"sentAt" timestamp,
	"acknowledgedAt" timestamp,
	"rejectionReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "travel_rule_records_recordRef_unique" UNIQUE("recordRef")
);

CREATE TABLE "ueba_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"subjectId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"eventCount" integer DEFAULT 0 NOT NULL,
	"anomalyScore" real DEFAULT 0 NOT NULL,
	"driftScore" real DEFAULT 0 NOT NULL,
	"riskLevel" "insider_severity" DEFAULT 'info' NOT NULL,
	"hourHistogram" jsonb,
	"dayHistogram" jsonb,
	"uniqueIpCount" integer DEFAULT 0 NOT NULL,
	"offHoursRatio" real DEFAULT 0 NOT NULL,
	"privChangeCount" integer DEFAULT 0 NOT NULL,
	"failedAuthCount" integer DEFAULT 0 NOT NULL,
	"baselineReady" boolean DEFAULT false NOT NULL,
	"lastScoredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ueba_profiles_subjectId_unique" UNIQUE("subjectId")
);

CREATE TABLE "user_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"sessionToken" varchar(255) NOT NULL,
	"ipAddress" varchar(45),
	"userAgent" text,
	"deviceName" varchar(255),
	"lastActiveAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_sessionToken_unique" UNIQUE("sessionToken")
);

CREATE TABLE "user_totp_secrets" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"secret" varchar(64) NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"backupCodes" jsonb DEFAULT '[]'::jsonb,
	"enabledAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_totp_secrets_userId_unique" UNIQUE("userId")
);

CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"openId" varchar(64) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'analyst' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"lastSignedIn" timestamp DEFAULT now() NOT NULL,
	"pushToken" varchar(512),
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);

CREATE TABLE "velocity_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"accountId" varchar(128) NOT NULL,
	"tenantId" varchar(64),
	"txRef" varchar(128),
	"amountKobo" bigint NOT NULL,
	"windowCount" integer NOT NULL,
	"windowSeconds" integer NOT NULL,
	"threshold" integer NOT NULL,
	"decision" varchar(32) DEFAULT 'block' NOT NULL,
	"reason" text,
	"reviewedAt" timestamp,
	"reviewedBy" integer,
	"reviewNote" text,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "waf_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer,
	"sourceIp" varchar(45),
	"method" varchar(10),
	"uri" text,
	"attackType" varchar(64),
	"severity" "waf_severity" DEFAULT 'medium' NOT NULL,
	"blocked" boolean DEFAULT true NOT NULL,
	"ruleId" varchar(64),
	"userAgent" text,
	"requestBody" text,
	"responseCode" integer,
	"country" varchar(3),
	"apisixRouteId" varchar(128),
	"openappsecEventId" varchar(128),
	"metadata" jsonb,
	"resolvedAt" timestamp,
	"resolvedBy" integer,
	"occurredAt" timestamp DEFAULT now() NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "webhook_retry_queue" (
	"id" bigint PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY (sequence name "webhook_retry_queue_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"reference" varchar(256) NOT NULL,
	"tenantId" varchar(64) NOT NULL,
	"amountKobo" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextRetryAt" timestamp NOT NULL,
	"status" varchar(32) DEFAULT 'pending' NOT NULL,
	"leasedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_retry_queue_reference_unique" UNIQUE("reference"),
	CONSTRAINT "webhook_retry_amount_positive" CHECK ("webhook_retry_queue"."amountKobo" > 0)
);

CREATE TABLE "webhooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"url" text NOT NULL,
	"status" "webhook_status" DEFAULT 'active' NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb,
	"secret" varchar(64),
	"failureCount" integer DEFAULT 0 NOT NULL,
	"lastDeliveredAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "work_permits" (
	"id" serial PRIMARY KEY NOT NULL,
	"permitRef" varchar(32) NOT NULL,
	"candidateId" integer NOT NULL,
	"orderId" integer,
	"permitType" "work_permit_type" NOT NULL,
	"permitNumber" varchar(64),
	"issueDate" date,
	"expiryDate" date,
	"issuingAuthority" varchar(128) DEFAULT 'Nigerian Immigration Service',
	"employerName" varchar(255),
	"worksiteId" integer,
	"verificationStatus" "assessment_outcome" DEFAULT 'pending',
	"verificationData" jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_permits_permitRef_unique" UNIQUE("permitRef")
);

CREATE TABLE "worksites" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenantId" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"state" varchar(64),
	"lga" varchar(64),
	"rcNumber" varchar(32),
	"isActive" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);

ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_insiderEventId_insider_events_id_fk" FOREIGN KEY ("insiderEventId") REFERENCES "public"."insider_events"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "access_reviews" ADD CONSTRAINT "access_reviews_completedBy_users_id_fk" FOREIGN KEY ("completedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "adverse_actions" ADD CONSTRAINT "adverse_actions_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "adverse_actions" ADD CONSTRAINT "adverse_actions_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "adverse_actions" ADD CONSTRAINT "adverse_actions_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "adverse_items" ADD CONSTRAINT "adverse_items_adverseActionId_adverse_actions_id_fk" FOREIGN KEY ("adverseActionId") REFERENCES "public"."adverse_actions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "adverse_items" ADD CONSTRAINT "adverse_items_resultId_screening_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."screening_results"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_ruleId_aml_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."aml_rules"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "aml_rules" ADD CONSTRAINT "aml_rules_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "apisix_audit_log" ADD CONSTRAINT "apisix_audit_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "apisix_audit_log" ADD CONSTRAINT "apisix_audit_log_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "biometric_templates" ADD CONSTRAINT "biometric_templates_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "biometric_templates" ADD CONSTRAINT "biometric_templates_enrolledBy_users_id_fk" FOREIGN KEY ("enrolledBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "candidate_consents" ADD CONSTRAINT "candidate_consents_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "candidate_consents" ADD CONSTRAINT "candidate_consents_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "candidate_profiles" ADD CONSTRAINT "candidate_profiles_invitedBy_users_id_fk" FOREIGN KEY ("invitedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "candidate_stories" ADD CONSTRAINT "candidate_stories_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "candidate_stories" ADD CONSTRAINT "candidate_stories_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "candidate_stories" ADD CONSTRAINT "candidate_stories_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "case_comments" ADD CONSTRAINT "case_comments_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "case_documents" ADD CONSTRAINT "case_documents_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "case_parties" ADD CONSTRAINT "case_parties_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "case_stakeholders" ADD CONSTRAINT "case_stakeholders_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "case_timeline" ADD CONSTRAINT "case_timeline_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "collection_sites" ADD CONSTRAINT "collection_sites_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "compliance_reports" ADD CONSTRAINT "compliance_reports_generatedBy_users_id_fk" FOREIGN KEY ("generatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "continuous_checks" ADD CONSTRAINT "continuous_checks_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "continuous_checks" ADD CONSTRAINT "continuous_checks_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "continuous_checks" ADD CONSTRAINT "continuous_checks_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "corporate_screening_profiles" ADD CONSTRAINT "corporate_screening_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "corporate_screening_profiles" ADD CONSTRAINT "corporate_screening_profiles_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_record_attachments" ADD CONSTRAINT "criminal_record_attachments_uploadedBy_users_id_fk" FOREIGN KEY ("uploadedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_record_audit" ADD CONSTRAINT "criminal_record_audit_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_record_requests" ADD CONSTRAINT "criminal_record_requests_requestedBy_users_id_fk" FOREIGN KEY ("requestedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_record_requests" ADD CONSTRAINT "criminal_record_requests_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_records" ADD CONSTRAINT "criminal_records_verifiedBy_users_id_fk" FOREIGN KEY ("verifiedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "criminal_records" ADD CONSTRAINT "criminal_records_recordedBy_users_id_fk" FOREIGN KEY ("recordedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "dapr_event_log" ADD CONSTRAINT "dapr_event_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "data_source_health_logs" ADD CONSTRAINT "data_source_health_logs_dataSourceId_data_sources_id_fk" FOREIGN KEY ("dataSourceId") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_ownerId_users_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "document_vault" ADD CONSTRAINT "document_vault_verifiedBy_users_id_fk" FOREIGN KEY ("verifiedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "event_log" ADD CONSTRAINT "event_log_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_collectedBy_users_id_fk" FOREIGN KEY ("collectedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_integrityVerifiedBy_users_id_fk" FOREIGN KEY ("integrityVerifiedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "export_schedules" ADD CONSTRAINT "export_schedules_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "field_visit_reports" ADD CONSTRAINT "field_visit_reports_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_agentId_field_agents_id_fk" FOREIGN KEY ("agentId") REFERENCES "public"."field_agents"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "field_visit_schedules" ADD CONSTRAINT "field_visit_schedules_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "force_credit_approvals" ADD CONSTRAINT "force_credit_approvals_requesterId_users_id_fk" FOREIGN KEY ("requesterId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "force_credit_approvals" ADD CONSTRAINT "force_credit_approvals_approverId_users_id_fk" FOREIGN KEY ("approverId") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "force_credit_approvers" ADD CONSTRAINT "force_credit_approvers_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "force_credit_approvers" ADD CONSTRAINT "force_credit_approvers_designatedBy_users_id_fk" FOREIGN KEY ("designatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "frozen_accounts" ADD CONSTRAINT "frozen_accounts_frozenBy_users_id_fk" FOREIGN KEY ("frozenBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "frozen_accounts" ADD CONSTRAINT "frozen_accounts_unfrozenBy_users_id_fk" FOREIGN KEY ("unfrozenBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "insider_events" ADD CONSTRAINT "insider_events_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "insider_events" ADD CONSTRAINT "insider_events_resolvedBy_users_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "investigation_case_links" ADD CONSTRAINT "investigation_case_links_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "investigation_case_links" ADD CONSTRAINT "investigation_case_links_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "investigation_case_links" ADD CONSTRAINT "investigation_case_links_linkedBy_users_id_fk" FOREIGN KEY ("linkedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "keycloak_onboarding_drafts" ADD CONSTRAINT "keycloak_onboarding_drafts_claimedByUserId_users_id_fk" FOREIGN KEY ("claimedByUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "keycloak_refresh_sessions" ADD CONSTRAINT "keycloak_refresh_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "keycloak_sync_log" ADD CONSTRAINT "keycloak_sync_log_bisUserId_users_id_fk" FOREIGN KEY ("bisUserId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "kyc_documents" ADD CONSTRAINT "kyc_documents_kycRecordId_kyc_records_id_fk" FOREIGN KEY ("kycRecordId") REFERENCES "public"."kyc_records"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "kyc_ocr_history" ADD CONSTRAINT "kyc_ocr_history_documentId_kyc_documents_id_fk" FOREIGN KEY ("documentId") REFERENCES "public"."kyc_documents"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "kyc_ocr_history" ADD CONSTRAINT "kyc_ocr_history_triggeredBy_users_id_fk" FOREIGN KEY ("triggeredBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "kyc_scheduled_reruns" ADD CONSTRAINT "kyc_scheduled_reruns_kycRecordId_kyc_records_id_fk" FOREIGN KEY ("kycRecordId") REFERENCES "public"."kyc_records"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "kyc_scheduled_reruns" ADD CONSTRAINT "kyc_scheduled_reruns_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lex_submissions" ADD CONSTRAINT "lex_submissions_agencyId_lex_agencies_id_fk" FOREIGN KEY ("agencyId") REFERENCES "public"."lex_agencies"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lex_submissions" ADD CONSTRAINT "lex_submissions_submitterId_lex_submitters_id_fk" FOREIGN KEY ("submitterId") REFERENCES "public"."lex_submitters"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lex_submissions" ADD CONSTRAINT "lex_submissions_linkedCaseId_cases_id_fk" FOREIGN KEY ("linkedCaseId") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "lex_submitters" ADD CONSTRAINT "lex_submitters_agencyId_lex_agencies_id_fk" FOREIGN KEY ("agencyId") REFERENCES "public"."lex_agencies"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ml_model_versions" ADD CONSTRAINT "ml_model_versions_promotedBy_users_id_fk" FOREIGN KEY ("promotedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "mojaloop_transfers" ADD CONSTRAINT "mojaloop_transfers_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "mojaloop_transfers" ADD CONSTRAINT "mojaloop_transfers_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "ng_court_records" ADD CONSTRAINT "ng_court_records_resultId_screening_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."screening_results"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ng_court_records" ADD CONSTRAINT "ng_court_records_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "ng_professional_licences" ADD CONSTRAINT "ng_professional_licences_resultId_screening_results_id_fk" FOREIGN KEY ("resultId") REFERENCES "public"."screening_results"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ng_professional_licences" ADD CONSTRAINT "ng_professional_licences_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "nigerian_data_bundle_runs" ADD CONSTRAINT "nigerian_data_bundle_runs_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "nostro_accounts" ADD CONSTRAINT "nostro_accounts_correspondentBankId_correspondent_banks_id_fk" FOREIGN KEY ("correspondentBankId") REFERENCES "public"."correspondent_banks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "payment_rails_log" ADD CONSTRAINT "payment_rails_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "payment_rails_log" ADD CONSTRAINT "payment_rails_log_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "permify_relationship_log" ADD CONSTRAINT "permify_relationship_log_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "permify_relationship_log" ADD CONSTRAINT "permify_relationship_log_actorId_users_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "push_broadcasts" ADD CONSTRAINT "push_broadcasts_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_submittedBy_users_id_fk" FOREIGN KEY ("submittedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "report_tags" ADD CONSTRAINT "report_tags_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "risk_profiles" ADD CONSTRAINT "risk_profiles_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "rule_evaluations" ADD CONSTRAINT "rule_evaluations_ruleId_alert_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."alert_rules"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sanctions_matches" ADD CONSTRAINT "sanctions_matches_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sanctions_matches" ADD CONSTRAINT "sanctions_matches_listId_sanctions_lists_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."sanctions_lists"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "sanctions_matches" ADD CONSTRAINT "sanctions_matches_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_relatedInvestigationId_investigations_id_fk" FOREIGN KEY ("relatedInvestigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_relatedGoamlFilingId_goaml_filings_id_fk" FOREIGN KEY ("relatedGoamlFilingId") REFERENCES "public"."goaml_filings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_approvedBy_users_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scheduled_broadcasts" ADD CONSTRAINT "scheduled_broadcasts_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "scheduled_broadcasts" ADD CONSTRAINT "scheduled_broadcasts_broadcastId_push_broadcasts_id_fk" FOREIGN KEY ("broadcastId") REFERENCES "public"."push_broadcasts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_ai_summaries" ADD CONSTRAINT "screening_ai_summaries_generatedBy_users_id_fk" FOREIGN KEY ("generatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_assessments" ADD CONSTRAINT "screening_assessments_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "screening_assessments" ADD CONSTRAINT "screening_assessments_packageId_screening_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."screening_packages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_assessments" ADD CONSTRAINT "screening_assessments_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_geos" ADD CONSTRAINT "screening_geos_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_packageId_screening_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."screening_packages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_programId_screening_programs_id_fk" FOREIGN KEY ("programId") REFERENCES "public"."screening_programs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_orders" ADD CONSTRAINT "screening_orders_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_packages" ADD CONSTRAINT "screening_packages_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "screening_packages" ADD CONSTRAINT "screening_packages_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_programs" ADD CONSTRAINT "screening_programs_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "screening_programs" ADD CONSTRAINT "screening_programs_packageId_screening_packages_id_fk" FOREIGN KEY ("packageId") REFERENCES "public"."screening_packages"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_programs" ADD CONSTRAINT "screening_programs_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "screening_results" ADD CONSTRAINT "screening_results_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sepa_payments" ADD CONSTRAINT "sepa_payments_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "stablecoin_transactions" ADD CONSTRAINT "stablecoin_transactions_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "stablecoin_transactions" ADD CONSTRAINT "stablecoin_transactions_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "swift_messages" ADD CONSTRAINT "swift_messages_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "temporal_workflow_state" ADD CONSTRAINT "temporal_workflow_state_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "temporal_workflow_state" ADD CONSTRAINT "temporal_workflow_state_initiatedBy_users_id_fk" FOREIGN KEY ("initiatedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "tenant_billing_accounts" ADD CONSTRAINT "tenant_billing_accounts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tigerbeetle_accounts" ADD CONSTRAINT "tigerbeetle_accounts_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tigerbeetle_transfers" ADD CONSTRAINT "tigerbeetle_transfers_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "token_usage_log" ADD CONSTRAINT "token_usage_log_tokenId_api_tokens_id_fk" FOREIGN KEY ("tokenId") REFERENCES "public"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_flaggedBy_users_id_fk" FOREIGN KEY ("flaggedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_goamlFilingId_goaml_filings_id_fk" FOREIGN KEY ("goamlFilingId") REFERENCES "public"."goaml_filings"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "travel_rule_records" ADD CONSTRAINT "travel_rule_records_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "user_totp_secrets" ADD CONSTRAINT "user_totp_secrets_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "velocity_blocks" ADD CONSTRAINT "velocity_blocks_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "waf_incidents" ADD CONSTRAINT "waf_incidents_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "waf_incidents" ADD CONSTRAINT "waf_incidents_resolvedBy_users_id_fk" FOREIGN KEY ("resolvedBy") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_candidateId_candidate_profiles_id_fk" FOREIGN KEY ("candidateId") REFERENCES "public"."candidate_profiles"("id") ON DELETE restrict ON UPDATE no action;
ALTER TABLE "work_permits" ADD CONSTRAINT "work_permits_orderId_screening_orders_id_fk" FOREIGN KEY ("orderId") REFERENCES "public"."screening_orders"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "worksites" ADD CONSTRAINT "worksites_tenantId_tenants_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "ar_subject_idx" ON "access_reviews" USING btree ("subjectId");
CREATE INDEX "ar_status_idx" ON "access_reviews" USING btree ("status");
CREATE INDEX "ar_due_idx" ON "access_reviews" USING btree ("dueAt");
CREATE INDEX "aa_order_idx" ON "adverse_actions" USING btree ("orderId");
CREATE INDEX "aa_candidate_idx" ON "adverse_actions" USING btree ("candidateId");
CREATE INDEX "aa_status_idx" ON "adverse_actions" USING btree ("status");
CREATE INDEX "ai_adverse_idx" ON "adverse_items" USING btree ("adverseActionId");
CREATE INDEX "alerts_created_at_idx" ON "alerts" USING btree ("createdAt");
CREATE INDEX "alerts_read_idx" ON "alerts" USING btree ("read");
CREATE INDEX "alerts_acknowledged_idx" ON "alerts" USING btree ("acknowledged");
CREATE INDEX "alerts_severity_idx" ON "alerts" USING btree ("severity");
CREATE INDEX "alerts_investigation_id_idx" ON "alerts" USING btree ("investigationId");
CREATE INDEX "alerts_subject_ref_idx" ON "alerts" USING btree ("subjectRef");
CREATE INDEX "aml_alerts_created_at_idx" ON "aml_alerts" USING btree ("createdAt");
CREATE INDEX "aml_alerts_status_idx" ON "aml_alerts" USING btree ("status");
CREATE INDEX "aml_alerts_rule_id_idx" ON "aml_alerts" USING btree ("ruleId");
CREATE INDEX "aal_ip_idx" ON "apisix_audit_log" USING btree ("clientIp");
CREATE INDEX "aal_route_idx" ON "apisix_audit_log" USING btree ("routeId");
CREATE INDEX "aal_status_idx" ON "apisix_audit_log" USING btree ("statusCode");
CREATE INDEX "aal_ts_idx" ON "apisix_audit_log" USING btree ("loggedAt");
CREATE INDEX "aal_tenant_idx" ON "apisix_audit_log" USING btree ("tenantId");
CREATE INDEX "audit_log_created_at_idx" ON "audit_log" USING btree ("createdAt");
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("userId");
CREATE INDEX "audit_log_category_idx" ON "audit_log" USING btree ("category");
CREATE INDEX "audit_log_target_ref_idx" ON "audit_log" USING btree ("targetRef");
CREATE INDEX "billing_topups_ref_idx" ON "billing_topups" USING btree ("reference");
CREATE INDEX "billing_topups_tenant_idx" ON "billing_topups" USING btree ("tenantId");
CREATE INDEX "bio_nonce_hash_idx" ON "biometric_liveness_nonces" USING btree ("frames_hash");
CREATE INDEX "bio_nonce_expires_idx" ON "biometric_liveness_nonces" USING btree ("expires_at");
CREATE INDEX "bio_session_subject_idx" ON "biometric_session_logs" USING btree ("subject_ref");
CREATE INDEX "bio_session_created_at_idx" ON "biometric_session_logs" USING btree ("created_at");
CREATE INDEX "bio_session_spoof_type_idx" ON "biometric_session_logs" USING btree ("anti_spoof_type");
CREATE INDEX "bio_session_kyc_record_idx" ON "biometric_session_logs" USING btree ("kyc_record_id");
CREATE INDEX "bt_subject_idx" ON "biometric_templates" USING btree ("subjectRef");
CREATE INDEX "bt_tenant_idx" ON "biometric_templates" USING btree ("tenantId");
CREATE INDEX "bt_modality_idx" ON "biometric_templates" USING btree ("modality");
CREATE INDEX "cc_candidate_idx" ON "candidate_consents" USING btree ("candidateId");
CREATE INDEX "cc_order_idx" ON "candidate_consents" USING btree ("orderId");
CREATE INDEX "cp_tenant_idx" ON "candidate_profiles" USING btree ("tenantId");
CREATE INDEX "cp_email_idx" ON "candidate_profiles" USING btree ("email");
CREATE INDEX "cp_nin_idx" ON "candidate_profiles" USING btree ("nin");
CREATE INDEX "cp_bvn_idx" ON "candidate_profiles" USING btree ("bvn");
CREATE INDEX "cs_order_idx" ON "candidate_stories" USING btree ("orderId");
CREATE INDEX "cs_candidate_idx" ON "candidate_stories" USING btree ("candidateId");
CREATE INDEX "cases_status_idx" ON "cases" USING btree ("status");
CREATE INDEX "cases_created_at_idx" ON "cases" USING btree ("createdAt");
CREATE INDEX "cases_lead_analyst_id_idx" ON "cases" USING btree ("leadAnalystId");
CREATE INDEX "cases_priority_idx" ON "cases" USING btree ("priority");
CREATE INDEX "cases_created_by_idx" ON "cases" USING btree ("createdBy");
CREATE INDEX "cases_tenant_idx" ON "cases" USING btree ("tenantId");
CREATE INDEX "cases_deleted_at_idx" ON "cases" USING btree ("deletedAt");
CREATE INDEX "cases_search_idx" ON "cases" USING gin (to_tsvector('english', coalesce("title", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("summary", '')));
CREATE INDEX "site_state_idx" ON "collection_sites" USING btree ("state");
CREATE INDEX "site_status_idx" ON "collection_sites" USING btree ("status");
CREATE INDEX "cr_tenant_idx" ON "compliance_reports" USING btree ("tenantId");
CREATE INDEX "cr_type_idx" ON "compliance_reports" USING btree ("reportType");
CREATE INDEX "cr_status_idx" ON "compliance_reports" USING btree ("status");
CREATE INDEX "cont_tenant_idx" ON "continuous_checks" USING btree ("tenantId");
CREATE INDEX "cont_candidate_idx" ON "continuous_checks" USING btree ("candidateId");
CREATE INDEX "cont_status_idx" ON "continuous_checks" USING btree ("status");
CREATE INDEX "csp_inv_idx" ON "corporate_screening_profiles" USING btree ("investigationRef");
CREATE INDEX "csp_tenant_idx" ON "corporate_screening_profiles" USING btree ("tenantId");
CREATE INDEX "csp_rc_idx" ON "corporate_screening_profiles" USING btree ("rcNumber");
CREATE INDEX "cra_rec_idx" ON "criminal_record_attachments" USING btree ("recordRef");
CREATE INDEX "cra_req_idx" ON "criminal_record_attachments" USING btree ("requestRef");
CREATE INDEX "cra2_req_idx" ON "criminal_record_audit" USING btree ("requestRef");
CREATE INDEX "cra2_rec_idx" ON "criminal_record_audit" USING btree ("recordRef");
CREATE INDEX "crr_ref_idx" ON "criminal_record_requests" USING btree ("requestRef");
CREATE INDEX "crr_inv_idx" ON "criminal_record_requests" USING btree ("investigationRef");
CREATE INDEX "crr_nin_idx" ON "criminal_record_requests" USING btree ("nin");
CREATE INDEX "crr_stat_idx" ON "criminal_record_requests" USING btree ("status");
CREATE INDEX "crr_agcy_idx" ON "criminal_record_requests" USING btree ("agency");
CREATE INDEX "cr_ref_idx" ON "criminal_records" USING btree ("recordRef");
CREATE INDEX "cr_req_idx" ON "criminal_records" USING btree ("requestRef");
CREATE INDEX "cr_inv_idx" ON "criminal_records" USING btree ("investigationRef");
CREATE INDEX "cr_nin_idx" ON "criminal_records" USING btree ("nin");
CREATE INDEX "cr_agcy_idx" ON "criminal_records" USING btree ("agency");
CREATE INDEX "cr_cat_idx" ON "criminal_records" USING btree ("offenceCategory");
CREATE INDEX "cr_warr_idx" ON "criminal_records" USING btree ("outstandingWarrant");
CREATE INDEX "del_topic_idx" ON "dapr_event_log" USING btree ("topic");
CREATE INDEX "del_entity_idx" ON "dapr_event_log" USING btree ("entityRef");
CREATE INDEX "del_tenant_idx" ON "dapr_event_log" USING btree ("tenantId");
CREATE INDEX "del_ts_idx" ON "dapr_event_log" USING btree ("publishedAt");
CREATE INDEX "health_logs_ds_idx" ON "data_source_health_logs" USING btree ("dataSourceId");
CREATE INDEX "health_logs_checked_at_idx" ON "data_source_health_logs" USING btree ("checkedAt");
CREATE INDEX "dv_owner_idx" ON "document_vault" USING btree ("ownerId");
CREATE INDEX "dv_ref_idx" ON "document_vault" USING btree ("ownerRef");
CREATE INDEX "dv_tenant_idx" ON "document_vault" USING btree ("tenantId");
CREATE INDEX "dv_type_idx" ON "document_vault" USING btree ("documentType");
CREATE INDEX "dv_deleted_idx" ON "document_vault" USING btree ("deletedAt");
CREATE INDEX "duplicate_checks_status_idx" ON "duplicate_identity_checks" USING btree ("status");
CREATE INDEX "duplicate_checks_created_at_idx" ON "duplicate_identity_checks" USING btree ("createdAt");
CREATE INDEX "el_type_idx" ON "event_log" USING btree ("eventType");
CREATE INDEX "el_aggregate_idx" ON "event_log" USING btree ("aggregateId");
CREATE INDEX "el_tenant_idx" ON "event_log" USING btree ("tenantId");
CREATE INDEX "el_created_idx" ON "event_log" USING btree ("createdAt");
CREATE INDEX "field_agents_status_idx" ON "field_agents" USING btree ("status");
CREATE INDEX "field_agents_state_idx" ON "field_agents" USING btree ("state");
CREATE INDEX "field_agents_created_at_idx" ON "field_agents" USING btree ("createdAt");
CREATE INDEX "field_tasks_status_idx" ON "field_tasks" USING btree ("status");
CREATE INDEX "field_tasks_created_at_idx" ON "field_tasks" USING btree ("createdAt");
CREATE INDEX "field_tasks_investigation_id_idx" ON "field_tasks" USING btree ("investigationId");
CREATE INDEX "field_tasks_agent_id_idx" ON "field_tasks" USING btree ("agentId");
CREATE INDEX "field_tasks_priority_idx" ON "field_tasks" USING btree ("priority");
CREATE INDEX "fvr_task_idx" ON "field_visit_reports" USING btree ("taskRef");
CREATE INDEX "fvr_inv_idx" ON "field_visit_reports" USING btree ("investigationId");
CREATE INDEX "fvr_agent_idx" ON "field_visit_reports" USING btree ("agentId");
CREATE INDEX "fvs_agent_idx" ON "field_visit_schedules" USING btree ("agentId");
CREATE INDEX "fvs_inv_idx" ON "field_visit_schedules" USING btree ("investigationId");
CREATE INDEX "fvs_sched_idx" ON "field_visit_schedules" USING btree ("scheduledAt");
CREATE INDEX "fvs_status_idx" ON "field_visit_schedules" USING btree ("status");
CREATE INDEX "ftr_topic_idx" ON "fluvio_topic_registry" USING btree ("topicName");
CREATE INDEX "fca_reference_idx" ON "force_credit_approvals" USING btree ("reference");
CREATE INDEX "fca_status_idx" ON "force_credit_approvals" USING btree ("status");
CREATE INDEX "fca_requester_idx" ON "force_credit_approvals" USING btree ("requesterId");
CREATE INDEX "fca_expires_idx" ON "force_credit_approvals" USING btree ("status","expiresAt");
CREATE UNIQUE INDEX "force_credit_approvers_user_unique" ON "force_credit_approvers" USING btree ("userId");
CREATE INDEX "force_credit_approvers_active_idx" ON "force_credit_approvers" USING btree ("active");
CREATE INDEX "frozen_accounts_account_idx" ON "frozen_accounts" USING btree ("accountId");
CREATE INDEX "frozen_accounts_frozen_at_idx" ON "frozen_accounts" USING btree ("frozenAt");
CREATE INDEX "goaml_filings_status_idx" ON "goaml_filings" USING btree ("status");
CREATE INDEX "goaml_filings_created_at_idx" ON "goaml_filings" USING btree ("createdAt");
CREATE INDEX "hosted_links_status_idx" ON "hosted_verification_links" USING btree ("status");
CREATE INDEX "hosted_links_expires_at_idx" ON "hosted_verification_links" USING btree ("expiresAt");
CREATE INDEX "ie_subject_idx" ON "insider_events" USING btree ("subjectId");
CREATE INDEX "ie_tenant_idx" ON "insider_events" USING btree ("tenantId");
CREATE INDEX "ie_status_idx" ON "insider_events" USING btree ("status");
CREATE INDEX "ie_severity_idx" ON "insider_events" USING btree ("severity");
CREATE INDEX "ie_created_idx" ON "insider_events" USING btree ("createdAt");
CREATE INDEX "investigations_status_idx" ON "investigations" USING btree ("status");
CREATE INDEX "investigations_created_at_idx" ON "investigations" USING btree ("createdAt");
CREATE INDEX "investigations_updated_at_idx" ON "investigations" USING btree ("updatedAt");
CREATE INDEX "investigations_assigned_to_idx" ON "investigations" USING btree ("assignedTo");
CREATE INDEX "investigations_created_by_idx" ON "investigations" USING btree ("createdBy");
CREATE INDEX "investigations_risk_score_idx" ON "investigations" USING btree ("riskScore");
CREATE INDEX "investigations_subject_name_idx" ON "investigations" USING btree ("subjectName");
CREATE INDEX "investigations_nin_idx" ON "investigations" USING btree ("nin");
CREATE INDEX "investigations_bvn_idx" ON "investigations" USING btree ("bvn");
CREATE UNIQUE INDEX "investigations_tenant_status_idx" ON "investigations" USING btree ("tenantId","ref");
CREATE INDEX "investigations_deleted_at_idx" ON "investigations" USING btree ("deletedAt");
CREATE INDEX "investigations_search_idx" ON "investigations" USING gin (to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("ref", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", '')));
CREATE INDEX "keycloak_auth_transactions_expires_idx" ON "keycloak_auth_transactions" USING btree ("expiresAt");
CREATE INDEX "keycloak_onboarding_drafts_expires_idx" ON "keycloak_onboarding_drafts" USING btree ("expiresAt");
CREATE INDEX "keycloak_refresh_sessions_user_idx" ON "keycloak_refresh_sessions" USING btree ("userId");
CREATE INDEX "keycloak_refresh_sessions_lease_idx" ON "keycloak_refresh_sessions" USING btree ("leaseExpiresAt");
CREATE INDEX "ksl_keycloak_idx" ON "keycloak_sync_log" USING btree ("keycloakId");
CREATE INDEX "ksl_user_idx" ON "keycloak_sync_log" USING btree ("bisUserId");
CREATE INDEX "ksl_op_idx" ON "keycloak_sync_log" USING btree ("operation");
CREATE INDEX "kyc_docs_record_idx" ON "kyc_documents" USING btree ("kycRecordId");
CREATE INDEX "kyc_docs_status_idx" ON "kyc_documents" USING btree ("reviewStatus");
CREATE INDEX "kyc_docs_tenant_idx" ON "kyc_documents" USING btree ("tenantId");
CREATE INDEX "kyc_docs_created_at_idx" ON "kyc_documents" USING btree ("createdAt");
CREATE INDEX "kyc_ocr_hist_doc_idx" ON "kyc_ocr_history" USING btree ("documentId");
CREATE INDEX "kyc_ocr_hist_field_idx" ON "kyc_ocr_history" USING btree ("fieldName");
CREATE INDEX "kyc_ocr_hist_by_idx" ON "kyc_ocr_history" USING btree ("triggeredBy");
CREATE INDEX "kyc_records_status_idx" ON "kyc_records" USING btree ("status");
CREATE INDEX "kyc_records_created_at_idx" ON "kyc_records" USING btree ("createdAt");
CREATE INDEX "kyc_records_created_by_idx" ON "kyc_records" USING btree ("createdBy");
CREATE INDEX "kyc_records_investigation_id_idx" ON "kyc_records" USING btree ("investigationId");
CREATE INDEX "kyc_records_nin_idx" ON "kyc_records" USING btree ("nin");
CREATE INDEX "kyc_records_bvn_idx" ON "kyc_records" USING btree ("bvn");
CREATE INDEX "kyc_records_onboarding_app_idx" ON "kyc_records" USING btree ("onboardingApplicationId");
CREATE INDEX "kyc_records_search_idx" ON "kyc_records" USING gin (to_tsvector('english', coalesce("subjectName", '') || ' ' || coalesce("nin", '') || ' ' || coalesce("bvn", '')));
CREATE INDEX "kyc_reruns_status_idx" ON "kyc_scheduled_reruns" USING btree ("status");
CREATE INDEX "kyc_reruns_scheduled_at_idx" ON "kyc_scheduled_reruns" USING btree ("scheduledAt");
CREATE INDEX "kyc_reruns_kyc_record_idx" ON "kyc_scheduled_reruns" USING btree ("kycRecordId");
CREATE INDEX "lex_submissions_status_idx" ON "lex_submissions" USING btree ("status");
CREATE INDEX "lex_submissions_created_at_idx" ON "lex_submissions" USING btree ("createdAt");
CREATE INDEX "lex_submissions_agency_id_idx" ON "lex_submissions" USING btree ("agencyId");
CREATE INDEX "mlm_name_idx" ON "ml_model_versions" USING btree ("modelName");
CREATE INDEX "mlm_status_idx" ON "ml_model_versions" USING btree ("status");
CREATE UNIQUE INDEX "mlm_version_uniq" ON "ml_model_versions" USING btree ("modelName","version");
CREATE INDEX "mjl_txref_idx" ON "mojaloop_transfers" USING btree ("txRef");
CREATE INDEX "mjl_tenant_idx" ON "mojaloop_transfers" USING btree ("tenantId");
CREATE INDEX "mjl_status_idx" ON "mojaloop_transfers" USING btree ("status");
CREATE INDEX "monitors_status_idx" ON "monitors" USING btree ("status");
CREATE INDEX "monitors_created_at_idx" ON "monitors" USING btree ("createdAt");
CREATE INDEX "monitors_created_by_idx" ON "monitors" USING btree ("createdBy");
CREATE INDEX "ncr_result_idx" ON "ng_court_records" USING btree ("resultId");
CREATE INDEX "ncr_candidate_idx" ON "ng_court_records" USING btree ("candidateId");
CREATE INDEX "ncr_state_idx" ON "ng_court_records" USING btree ("state");
CREATE INDEX "npl_result_idx" ON "ng_professional_licences" USING btree ("resultId");
CREATE INDEX "npl_candidate_idx" ON "ng_professional_licences" USING btree ("candidateId");
CREATE INDEX "npl_body_idx" ON "ng_professional_licences" USING btree ("professionalBody");
CREATE INDEX "bundle_runs_created_at_idx" ON "nigerian_data_bundle_runs" USING btree ("createdAt");
CREATE INDEX "bundle_runs_nin_idx" ON "nigerian_data_bundle_runs" USING btree ("nin");
CREATE INDEX "bundle_runs_bvn_idx" ON "nigerian_data_bundle_runs" USING btree ("bvn");
CREATE INDEX "notifications_user_id_idx" ON "notifications" USING btree ("userId");
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read");
CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("createdAt");
CREATE INDEX "onboarding_apps_status_idx" ON "onboarding_applications" USING btree ("status");
CREATE INDEX "onboarding_apps_created_at_idx" ON "onboarding_applications" USING btree ("createdAt");
CREATE INDEX "onboarding_apps_created_by_idx" ON "onboarding_applications" USING btree ("createdBy");
CREATE INDEX "prl_txref_idx" ON "payment_rails_log" USING btree ("txRef");
CREATE INDEX "prl_log_tenant_idx" ON "payment_rails_log" USING btree ("tenantId");
CREATE INDEX "prl_rail_idx" ON "payment_rails_log" USING btree ("rail");
CREATE INDEX "prl_time_idx" ON "payment_rails_log" USING btree ("createdAt");
CREATE INDEX "prl_entity_idx" ON "permify_relationship_log" USING btree ("entity","entityId");
CREATE INDEX "prl_subject_idx" ON "permify_relationship_log" USING btree ("subject","subjectId");
CREATE INDEX "prl_tenant_idx" ON "permify_relationship_log" USING btree ("tenantId");
CREATE UNIQUE INDEX "platform_settings_namespace_key_unique" ON "platform_settings" USING btree ("namespace","key");
CREATE INDEX "push_bc_sent_at_idx" ON "push_broadcasts" USING btree ("sentAt");
CREATE INDEX "push_bc_created_by_idx" ON "push_broadcasts" USING btree ("createdBy");
CREATE INDEX "push_sub_user_idx" ON "push_subscriptions" USING btree ("userId");
CREATE INDEX "push_sub_token_idx" ON "push_subscriptions" USING btree ("token");
CREATE INDEX "push_sub_active_idx" ON "push_subscriptions" USING btree ("active");
CREATE INDEX "regulatory_reports_status_idx" ON "regulatory_reports" USING btree ("status");
CREATE INDEX "regulatory_reports_tenant_idx" ON "regulatory_reports" USING btree ("tenantId");
CREATE INDEX "regulatory_reports_created_at_idx" ON "regulatory_reports" USING btree ("createdAt");
CREATE INDEX "regulatory_reports_type_idx" ON "regulatory_reports" USING btree ("type");
CREATE INDEX "rt_tenant_idx" ON "report_tags" USING btree ("tenantId");
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");
CREATE INDEX "reports_created_at_idx" ON "reports" USING btree ("createdAt");
CREATE INDEX "reports_generated_by_idx" ON "reports" USING btree ("generatedBy");
CREATE INDEX "reports_investigation_id_idx" ON "reports" USING btree ("investigationId");
CREATE INDEX "rp_subject_idx" ON "risk_profiles" USING btree ("subjectRef");
CREATE INDEX "rp_tenant_idx" ON "risk_profiles" USING btree ("tenantId");
CREATE INDEX "rp_band_idx" ON "risk_profiles" USING btree ("riskBand");
CREATE INDEX "rp_score_idx" ON "risk_profiles" USING btree ("overallScore");
CREATE UNIQUE INDEX "rp_subject_uniq" ON "risk_profiles" USING btree ("tenantId","subjectRef");
CREATE INDEX "rule_evaluations_created_at_idx" ON "rule_evaluations" USING btree ("createdAt");
CREATE INDEX "rule_evaluations_rule_id_idx" ON "rule_evaluations" USING btree ("ruleId");
CREATE INDEX "rule_evaluations_triggered_idx" ON "rule_evaluations" USING btree ("triggered");
CREATE INDEX "sl_type_idx" ON "sanctions_lists" USING btree ("listType");
CREATE INDEX "sl_active_idx" ON "sanctions_lists" USING btree ("isActive");
CREATE INDEX "sm_subject_idx" ON "sanctions_matches" USING btree ("subjectRef");
CREATE INDEX "sm_tenant_idx" ON "sanctions_matches" USING btree ("tenantId");
CREATE INDEX "sm_status_idx" ON "sanctions_matches" USING btree ("status");
CREATE INDEX "sm_score_idx" ON "sanctions_matches" USING btree ("matchScore");
CREATE INDEX "sar_filings_status_idx" ON "sar_filings" USING btree ("status");
CREATE INDEX "sar_filings_created_at_idx" ON "sar_filings" USING btree ("createdAt");
CREATE INDEX "sar_filings_created_by_idx" ON "sar_filings" USING btree ("createdBy");
CREATE INDEX "sched_bc_status_idx" ON "scheduled_broadcasts" USING btree ("status");
CREATE INDEX "sched_bc_scheduled_idx" ON "scheduled_broadcasts" USING btree ("scheduledAt");
CREATE INDEX "sched_bc_created_by_idx" ON "scheduled_broadcasts" USING btree ("createdBy");
CREATE INDEX "sas_inv_idx" ON "screening_ai_summaries" USING btree ("investigationRef");
CREATE INDEX "sa_tenant_type_idx" ON "screening_assessments" USING btree ("tenantId","screeningType");
CREATE INDEX "sg_state_type_idx" ON "screening_geos" USING btree ("state","screeningType");
CREATE INDEX "so_tenant_idx" ON "screening_orders" USING btree ("tenantId");
CREATE INDEX "so_candidate_idx" ON "screening_orders" USING btree ("candidateId");
CREATE INDEX "so_status_idx" ON "screening_orders" USING btree ("status");
CREATE INDEX "so_created_idx" ON "screening_orders" USING btree ("createdAt");
CREATE INDEX "sp_tenant_idx" ON "screening_packages" USING btree ("tenantId");
CREATE INDEX "sp_tier_idx" ON "screening_packages" USING btree ("tier");
CREATE INDEX "sprog_tenant_idx" ON "screening_programs" USING btree ("tenantId");
CREATE INDEX "screening_requests_status_idx" ON "screening_requests" USING btree ("status");
CREATE INDEX "screening_requests_created_at_idx" ON "screening_requests" USING btree ("createdAt");
CREATE INDEX "screening_requests_created_by_idx" ON "screening_requests" USING btree ("createdBy");
CREATE INDEX "sr_order_idx" ON "screening_results" USING btree ("orderId");
CREATE INDEX "sr_type_idx" ON "screening_results" USING btree ("screeningType");
CREATE INDEX "sr_status_idx" ON "screening_results" USING btree ("status");
CREATE INDEX "sepa_payments_tenant_created_idx" ON "sepa_payments" USING btree ("tenantId","createdAt");
CREATE INDEX "shh_service_idx" ON "service_health_history" USING btree ("service");
CREATE INDEX "shh_ts_idx" ON "service_health_history" USING btree ("checkedAt");
CREATE INDEX "shh_status_idx" ON "service_health_history" USING btree ("status");
CREATE INDEX "social_mentions_created_at_idx" ON "social_mentions" USING btree ("createdAt");
CREATE INDEX "social_mentions_monitor_id_idx" ON "social_mentions" USING btree ("monitorId");
CREATE INDEX "social_mentions_sentiment_idx" ON "social_mentions" USING btree ("sentiment");
CREATE INDEX "sc_txref_idx" ON "stablecoin_transactions" USING btree ("txRef");
CREATE INDEX "sc_txhash_idx" ON "stablecoin_transactions" USING btree ("txHash");
CREATE INDEX "sc_tenant_idx" ON "stablecoin_transactions" USING btree ("tenantId");
CREATE INDEX "sc_status_idx" ON "stablecoin_transactions" USING btree ("status");
CREATE INDEX "swift_messages_tenant_created_idx" ON "swift_messages" USING btree ("tenantId","createdAt");
CREATE INDEX "tws_entity_idx" ON "temporal_workflow_state" USING btree ("entityRef","entityType");
CREATE INDEX "tws_status_idx" ON "temporal_workflow_state" USING btree ("status");
CREATE INDEX "tws_tenant_idx" ON "temporal_workflow_state" USING btree ("tenantId");
CREATE INDEX "tws_type_idx" ON "temporal_workflow_state" USING btree ("workflowType");
CREATE INDEX "tba_tenant_idx" ON "tenant_billing_accounts" USING btree ("tenantId");
CREATE INDEX "tb_tenant_idx" ON "tigerbeetle_accounts" USING btree ("tenantId");
CREATE INDEX "tb_account_idx" ON "tigerbeetle_accounts" USING btree ("accountId");
CREATE INDEX "tbt_debit_idx" ON "tigerbeetle_transfers" USING btree ("debitAccountId");
CREATE INDEX "tbt_credit_idx" ON "tigerbeetle_transfers" USING btree ("creditAccountId");
CREATE INDEX "tbt_tenant_idx" ON "tigerbeetle_transfers" USING btree ("tenantId");
CREATE INDEX "tbt_txref_idx" ON "tigerbeetle_transfers" USING btree ("txRef");
CREATE INDEX "transactions_created_at_idx" ON "transactions" USING btree ("createdAt");
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");
CREATE INDEX "transactions_originator_account_idx" ON "transactions" USING btree ("originatorAccount");
CREATE INDEX "transactions_amount_idx" ON "transactions" USING btree ("amount");
CREATE INDEX "transactions_idempotency_idx" ON "transactions" USING btree ("idempotencyKey");
CREATE INDEX "transactions_tb_id_idx" ON "transactions" USING btree ("tigerBeetleId");
CREATE INDEX "travel_rule_records_tenant_created_idx" ON "travel_rule_records" USING btree ("tenantId","createdAt");
CREATE INDEX "up_subject_idx" ON "ueba_profiles" USING btree ("subjectId");
CREATE INDEX "up_tenant_idx" ON "ueba_profiles" USING btree ("tenantId");
CREATE INDEX "up_risk_idx" ON "ueba_profiles" USING btree ("riskLevel");
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("userId");
CREATE INDEX "user_sessions_expires_at_idx" ON "user_sessions" USING btree ("expiresAt");
CREATE INDEX "velocity_blocks_account_idx" ON "velocity_blocks" USING btree ("accountId");
CREATE INDEX "velocity_blocks_tenant_idx" ON "velocity_blocks" USING btree ("tenantId");
CREATE INDEX "velocity_blocks_created_idx" ON "velocity_blocks" USING btree ("createdAt");
CREATE INDEX "waf_ip_idx" ON "waf_incidents" USING btree ("sourceIp");
CREATE INDEX "waf_sev_idx" ON "waf_incidents" USING btree ("severity");
CREATE INDEX "waf_time_idx" ON "waf_incidents" USING btree ("occurredAt");
CREATE INDEX "waf_tenant_idx" ON "waf_incidents" USING btree ("tenantId");
CREATE INDEX "webhook_retry_due_idx" ON "webhook_retry_queue" USING btree ("status","nextRetryAt");
CREATE INDEX "webhook_retry_lease_idx" ON "webhook_retry_queue" USING btree ("status","leasedAt");
CREATE INDEX "wp_candidate_idx" ON "work_permits" USING btree ("candidateId");
CREATE INDEX "ws_tenant_idx" ON "worksites" USING btree ("tenantId");
