ALTER TABLE "alerts" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "aml_alerts" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "goaml_filings" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "investigations" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "kyc_records" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "sar_filings" ADD COLUMN "tenantId" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tenantId" integer;