CREATE TABLE "push_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"token" text NOT NULL,
	"platform" varchar(16) DEFAULT 'fcm' NOT NULL,
	"device_label" varchar(128),
	"p256dh" text,
	"auth" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_userId_users_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_sub_user_idx" ON "push_subscriptions" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "push_sub_token_idx" ON "push_subscriptions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "push_sub_active_idx" ON "push_subscriptions" USING btree ("active");