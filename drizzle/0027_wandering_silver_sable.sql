CREATE TYPE "public"."aml_alert_status" AS ENUM('open', 'under_review', 'escalated', 'cleared', 'filed', 'false_positive');--> statement-breakpoint
CREATE TYPE "public"."aml_risk_level" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."aml_rule_type" AS ENUM('threshold', 'velocity', 'structuring', 'round_trip', 'layering', 'high_risk_country', 'pep_transaction', 'sanctions_match', 'unusual_pattern');--> statement-breakpoint
CREATE TYPE "public"."correspondent_bank_status" AS ENUM('active', 'suspended', 'terminated', 'under_review');--> statement-breakpoint
CREATE TYPE "public"."evidence_status" AS ENUM('collected', 'in_transit', 'secured', 'analyzed', 'submitted', 'returned', 'destroyed');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('document', 'photo', 'video', 'audio', 'digital_artifact', 'physical', 'witness_statement', 'financial_record', 'communication_log', 'other');--> statement-breakpoint
CREATE TYPE "public"."lc_status" AS ENUM('draft', 'issued', 'advised', 'confirmed', 'amended', 'presented', 'accepted', 'paid', 'discrepant', 'rejected', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lc_type" AS ENUM('sight', 'usance', 'deferred', 'revolving', 'standby');--> statement-breakpoint
CREATE TYPE "public"."regulatory_report_status" AS ENUM('draft', 'generated', 'reviewed', 'submitted', 'acknowledged', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."regulatory_report_type" AS ENUM('CTR', 'STR', 'goAML_XML', 'NFIU_monthly', 'CBN_quarterly', 'FATF_travel_rule', 'PEP_disclosure', 'sanctions_screening', 'annual_AML_report');--> statement-breakpoint
CREATE TYPE "public"."sar_category" AS ENUM('money_laundering', 'terrorist_financing', 'fraud', 'corruption', 'tax_evasion', 'sanctions_evasion', 'human_trafficking', 'drug_trafficking', 'cybercrime', 'other');--> statement-breakpoint
CREATE TYPE "public"."sar_status" AS ENUM('draft', 'under_review', 'approved', 'rejected', 'filed', 'acknowledged', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."sepa_payment_status" AS ENUM('pending', 'accepted', 'rejected', 'returned', 'settled');--> statement-breakpoint
CREATE TYPE "public"."sepa_payment_type" AS ENUM('credit_transfer', 'direct_debit', 'instant_credit');--> statement-breakpoint
CREATE TYPE "public"."swift_message_status" AS ENUM('received', 'processing', 'completed', 'failed', 'rejected', 'pending_compliance');--> statement-breakpoint
CREATE TYPE "public"."swift_message_type" AS ENUM('MT103', 'MT202', 'MT202COV', 'MT199', 'MT299', 'MT900', 'MT910', 'MT940', 'MT950');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('pending', 'completed', 'failed', 'reversed', 'flagged', 'blocked', 'under_review');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('wire_transfer', 'cash_deposit', 'cash_withdrawal', 'cheque', 'rtgs', 'nip', 'swift_mt103', 'swift_mt202', 'sepa_credit', 'sepa_debit', 'internal_transfer', 'trade_settlement', 'fx_conversion', 'card_payment', 'mobile_money');--> statement-breakpoint
CREATE TYPE "public"."travel_rule_status" AS ENUM('pending', 'sent', 'acknowledged', 'rejected', 'exempted');--> statement-breakpoint
CREATE TABLE "aml_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "aml_alerts_alertRef_unique" UNIQUE("alertRef")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
	"services" json,
	"currencies" json,
	"nostroAccountCount" integer DEFAULT 0,
	"annualVolume" real,
	"amlPolicyUrl" text,
	"notes" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "correspondent_banks_bic_unique" UNIQUE("bic")
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"evidenceRef" varchar(32) NOT NULL,
	"caseId" integer,
	"investigationId" integer,
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
	"chainOfCustody" json,
	"integrityVerified" boolean DEFAULT false,
	"integrityVerifiedAt" timestamp,
	"integrityVerifiedBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_items_evidenceRef_unique" UNIQUE("evidenceRef")
);
--> statement-breakpoint
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
	"documents" json,
	"amendments" json,
	"discrepancies" json,
	"investigationId" integer,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "letters_of_credit_lcRef_unique" UNIQUE("lcRef")
);
--> statement-breakpoint
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
--> statement-breakpoint
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
	"metadata" json,
	"createdBy" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regulatory_reports_reportRef_unique" UNIQUE("reportRef")
);
--> statement-breakpoint
CREATE TABLE "sar_filings" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"relatedTransactions" json,
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
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sar_filings_sarRef_unique" UNIQUE("sarRef")
);
--> statement-breakpoint
CREATE TABLE "sepa_payments" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
CREATE TABLE "swift_messages" (
	"id" serial PRIMARY KEY NOT NULL,
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
	"parsedFields" json,
	"complianceStatus" varchar(32) DEFAULT 'pending',
	"complianceNotes" text,
	"transactionId" integer,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "swift_messages_uetr_unique" UNIQUE("uetr")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"txRef" varchar(64) NOT NULL,
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
	"amlFlags" json,
	"flaggedAt" timestamp,
	"flaggedBy" integer,
	"investigationId" integer,
	"goamlFilingId" integer,
	"valueDate" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_txRef_unique" UNIQUE("txRef")
);
--> statement-breakpoint
CREATE TABLE "travel_rule_records" (
	"id" serial PRIMARY KEY NOT NULL,
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
--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_ruleId_aml_rules_id_fk" FOREIGN KEY ("ruleId") REFERENCES "public"."aml_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_assignedTo_users_id_fk" FOREIGN KEY ("assignedTo") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD CONSTRAINT "aml_alerts_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aml_rules" ADD CONSTRAINT "aml_rules_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_caseId_cases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_collectedBy_users_id_fk" FOREIGN KEY ("collectedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_integrityVerifiedBy_users_id_fk" FOREIGN KEY ("integrityVerifiedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "letters_of_credit" ADD CONSTRAINT "letters_of_credit_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nostro_accounts" ADD CONSTRAINT "nostro_accounts_correspondentBankId_correspondent_banks_id_fk" FOREIGN KEY ("correspondentBankId") REFERENCES "public"."correspondent_banks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_submittedBy_users_id_fk" FOREIGN KEY ("submittedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regulatory_reports" ADD CONSTRAINT "regulatory_reports_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_relatedInvestigationId_investigations_id_fk" FOREIGN KEY ("relatedInvestigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_relatedGoamlFilingId_goaml_filings_id_fk" FOREIGN KEY ("relatedGoamlFilingId") REFERENCES "public"."goaml_filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_createdBy_users_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_reviewedBy_users_id_fk" FOREIGN KEY ("reviewedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD CONSTRAINT "sar_filings_approvedBy_users_id_fk" FOREIGN KEY ("approvedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepa_payments" ADD CONSTRAINT "sepa_payments_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swift_messages" ADD CONSTRAINT "swift_messages_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_flaggedBy_users_id_fk" FOREIGN KEY ("flaggedBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_investigationId_investigations_id_fk" FOREIGN KEY ("investigationId") REFERENCES "public"."investigations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_goamlFilingId_goaml_filings_id_fk" FOREIGN KEY ("goamlFilingId") REFERENCES "public"."goaml_filings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "travel_rule_records" ADD CONSTRAINT "travel_rule_records_transactionId_transactions_id_fk" FOREIGN KEY ("transactionId") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;