ALTER TABLE "kyc_records" ADD COLUMN "onboardingApplicationId" integer;--> statement-breakpoint
CREATE INDEX "kyc_records_onboarding_app_idx" ON "kyc_records" USING btree ("onboardingApplicationId");