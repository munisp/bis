ALTER TABLE "kyc_records" ADD COLUMN "subjectRef" varchar(64);--> statement-breakpoint
ALTER TABLE "kyc_records" ADD COLUMN "biometricStatus" varchar(32) DEFAULT 'not_enrolled';--> statement-breakpoint
ALTER TABLE "kyc_records" ADD COLUMN "biometricFaceId" varchar(128);--> statement-breakpoint
ALTER TABLE "kyc_records" ADD COLUMN "documentOcrData" json;