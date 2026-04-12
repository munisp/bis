ALTER TABLE "lex_agencies" ADD COLUMN "flagged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lex_agencies" ADD COLUMN "flagReason" text;--> statement-breakpoint
ALTER TABLE "lex_agencies" ADD COLUMN "updatedAt" timestamp DEFAULT now() NOT NULL;