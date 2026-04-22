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
--> statement-breakpoint
ALTER TABLE "frozen_accounts" ADD CONSTRAINT "frozen_accounts_frozenBy_users_id_fk" FOREIGN KEY ("frozenBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_accounts" ADD CONSTRAINT "frozen_accounts_unfrozenBy_users_id_fk" FOREIGN KEY ("unfrozenBy") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "frozen_accounts_account_idx" ON "frozen_accounts" USING btree ("accountId");--> statement-breakpoint
CREATE INDEX "frozen_accounts_frozen_at_idx" ON "frozen_accounts" USING btree ("frozenAt");