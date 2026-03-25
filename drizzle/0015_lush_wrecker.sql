CREATE TABLE "push_device_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"userId" integer NOT NULL,
	"token" varchar(500) NOT NULL,
	"platform" varchar(10) DEFAULT 'ios' NOT NULL,
	"deviceName" varchar(200),
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "push_device_tokens_token_unique" UNIQUE("token")
);
