CREATE TABLE "category_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"pattern" varchar(100) NOT NULL,
	"type" varchar(12) DEFAULT 'expense' NOT NULL,
	"category" varchar(60) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "category_rules_user_pattern_type_idx" ON "category_rules" USING btree ("user_id", lower("pattern"), "type");
