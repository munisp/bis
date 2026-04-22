ALTER TABLE "transactions" ADD COLUMN "idempotencyKey" varchar(256);--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "tigerBeetleId" varchar(32);--> statement-breakpoint
CREATE INDEX "transactions_idempotency_idx" ON "transactions" USING btree ("idempotencyKey");--> statement-breakpoint
CREATE INDEX "transactions_tb_id_idx" ON "transactions" USING btree ("tigerBeetleId");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_idempotencyKey_unique" UNIQUE("idempotencyKey");