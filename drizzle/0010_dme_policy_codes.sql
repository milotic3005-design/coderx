CREATE TABLE "dme_policy_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"policy" text NOT NULL,
	"lcd_id" integer NOT NULL,
	"version" integer NOT NULL,
	"display_id" text NOT NULL,
	"title" text NOT NULL,
	"hcpcs_code" text NOT NULL,
	"code_group" integer,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dme_policy_codes" ADD CONSTRAINT "dme_policy_codes_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dme_policy_codes_code_idx" ON "dme_policy_codes" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "dme_policy_codes_release_idx" ON "dme_policy_codes" USING btree ("source_release_id");