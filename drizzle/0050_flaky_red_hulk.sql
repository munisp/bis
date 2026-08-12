ALTER TABLE "ng_professional_licences" ALTER COLUMN "professionalBody" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."professional_body";--> statement-breakpoint
CREATE TYPE "public"."professional_body" AS ENUM('COREN', 'NBA', 'MDCN', 'ICAN', 'CIBN', 'NIM', 'NSE', 'NIPR', 'TOPREC', 'ARCON', 'ICSAN', 'ACCA', 'CIS', 'CIPD', 'HRCI');--> statement-breakpoint
ALTER TABLE "ng_professional_licences" ALTER COLUMN "professionalBody" SET DATA TYPE "public"."professional_body" USING "professionalBody"::"public"."professional_body";