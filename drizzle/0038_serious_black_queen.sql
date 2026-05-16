CREATE TABLE "biometric_liveness_nonces" (
	"id" serial PRIMARY KEY NOT NULL,
	"frames_hash" varchar(64) NOT NULL,
	"subject_ref" varchar(128),
	"challenge" varchar(32),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "biometric_liveness_nonces_frames_hash_unique" UNIQUE("frames_hash")
);
--> statement-breakpoint
CREATE INDEX "bio_nonce_hash_idx" ON "biometric_liveness_nonces" USING btree ("frames_hash");--> statement-breakpoint
CREATE INDEX "bio_nonce_expires_idx" ON "biometric_liveness_nonces" USING btree ("expires_at");