CREATE TABLE "hospital_drug_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"hospital_key" text NOT NULL,
	"hcpcs_code" text NOT NULL,
	"plan_type" text NOT NULL,
	"setting" text,
	"billing_class" text,
	"methodology" text,
	"drug_quantity" numeric,
	"drug_unit" text,
	"amounts" jsonb NOT NULL,
	"percent_contracts" integer DEFAULT 0 NOT NULL,
	"algorithm_contracts" integer DEFAULT 0 NOT NULL,
	"gross_min" numeric,
	"gross_max" numeric,
	"cash_min" numeric,
	"cash_max" numeric,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hospital_drug_rates" ADD CONSTRAINT "hospital_drug_rates_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_drug_rates_code_idx" ON "hospital_drug_rates" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "hospital_drug_rates_release_idx" ON "hospital_drug_rates" USING btree ("source_release_id");