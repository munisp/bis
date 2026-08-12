ALTER TABLE "investigations" ADD COLUMN "candidateProfileId" integer;--> statement-breakpoint
ALTER TABLE "screening_orders" ADD COLUMN "investigationRef" varchar(32);