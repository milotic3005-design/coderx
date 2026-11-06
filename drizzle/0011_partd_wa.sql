CREATE TABLE "partd_wa_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"proxy_ndc" text NOT NULL,
	"rxcui" text,
	"plan_count" integer NOT NULL,
	"unit_cost_min" numeric NOT NULL,
	"unit_cost_median" numeric NOT NULL,
	"unit_cost_max" numeric NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partd_wa_formularies" (
	"formulary_id" text PRIMARY KEY NOT NULL,
	"pdp_plans" integer NOT NULL,
	"mapd_plans" integer NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partd_wa_formulary_drugs" (
	"id" serial PRIMARY KEY NOT NULL,
	"formulary_id" text NOT NULL,
	"rxcui" text NOT NULL,
	"proxy_ndc" text NOT NULL,
	"tier" integer,
	"prior_auth" boolean NOT NULL,
	"step_therapy" boolean NOT NULL,
	"quantity_limit" boolean NOT NULL,
	"selected_drug" boolean NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partd_wa_costs" ADD CONSTRAINT "partd_wa_costs_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partd_wa_formularies" ADD CONSTRAINT "partd_wa_formularies_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partd_wa_formulary_drugs" ADD CONSTRAINT "partd_wa_formulary_drugs_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partd_wa_costs_ndc_idx" ON "partd_wa_costs" USING btree ("proxy_ndc");--> statement-breakpoint
CREATE INDEX "partd_wa_costs_rxcui_idx" ON "partd_wa_costs" USING btree ("rxcui");--> statement-breakpoint
CREATE INDEX "partd_wa_costs_release_idx" ON "partd_wa_costs" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "partd_wa_drugs_rxcui_idx" ON "partd_wa_formulary_drugs" USING btree ("rxcui");--> statement-breakpoint
CREATE INDEX "partd_wa_drugs_ndc_idx" ON "partd_wa_formulary_drugs" USING btree ("proxy_ndc");--> statement-breakpoint
CREATE INDEX "partd_wa_drugs_ndc_prefix_idx" ON "partd_wa_formulary_drugs" USING btree ("proxy_ndc" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "partd_wa_drugs_release_idx" ON "partd_wa_formulary_drugs" USING btree ("source_release_id");