CREATE TABLE "nadac_prices" (
	"id" serial PRIMARY KEY NOT NULL,
	"ndc11" text NOT NULL,
	"description" text NOT NULL,
	"per_unit" numeric NOT NULL,
	"unit" text NOT NULL,
	"effective_date" date NOT NULL,
	"classification" text NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_exchange_drugs" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer_key" text NOT NULL,
	"rxcui" text NOT NULL,
	"listings" jsonb NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_exchange_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"insurer_key" text NOT NULL,
	"plan_id" text NOT NULL,
	"name" text NOT NULL,
	"costs" jsonb NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_pdl_ndcs" (
	"id" serial PRIMARY KEY NOT NULL,
	"ndc11" text NOT NULL,
	"label" text NOT NULL,
	"coverage" text NOT NULL,
	"non_covered_reason" text NOT NULL,
	"pharmacy_preferred" text NOT NULL,
	"pharmacy_pa" text NOT NULL,
	"medical_preferred" text NOT NULL,
	"medical_pa" text NOT NULL,
	"pa_policy" text NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nadac_prices" ADD CONSTRAINT "nadac_prices_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_exchange_drugs" ADD CONSTRAINT "wa_exchange_drugs_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_exchange_plans" ADD CONSTRAINT "wa_exchange_plans_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wa_pdl_ndcs" ADD CONSTRAINT "wa_pdl_ndcs_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nadac_prices_ndc_idx" ON "nadac_prices" USING btree ("ndc11");--> statement-breakpoint
CREATE INDEX "nadac_prices_release_idx" ON "nadac_prices" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "wa_exchange_drugs_rxcui_idx" ON "wa_exchange_drugs" USING btree ("rxcui");--> statement-breakpoint
CREATE INDEX "wa_exchange_drugs_release_idx" ON "wa_exchange_drugs" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "wa_exchange_plans_insurer_idx" ON "wa_exchange_plans" USING btree ("insurer_key");--> statement-breakpoint
CREATE INDEX "wa_exchange_plans_release_idx" ON "wa_exchange_plans" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "wa_pdl_ndcs_ndc_idx" ON "wa_pdl_ndcs" USING btree ("ndc11");--> statement-breakpoint
CREATE INDEX "wa_pdl_ndcs_release_idx" ON "wa_pdl_ndcs" USING btree ("source_release_id");