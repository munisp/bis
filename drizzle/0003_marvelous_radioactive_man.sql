CREATE TABLE "platform_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"namespace" varchar(64) DEFAULT 'default' NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" json,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"updatedBy" varchar(255)
);
