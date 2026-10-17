CREATE TABLE "mdrp_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"ndc11" text NOT NULL,
	"period" text NOT NULL,
	"source_release_id" integer NOT NULL,
	"labeler_name" text,
	"fda_product_name" text,
	"unit_type" text,
	"units_per_package" numeric,
	"drug_category" text,
	"drug_type" text,
	"cod_status" text,
	"termination_date" date,
	"reactivation_date" date,
	"market_date" date,
	"clotting_factor" boolean,
	"line_extension" text,
	"application_number" text
);
--> statement-breakpoint
ALTER TABLE "mdrp_products" ADD CONSTRAINT "mdrp_products_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mdrp_products_uq" ON "mdrp_products" USING btree ("ndc11","source_release_id");--> statement-breakpoint
CREATE INDEX "mdrp_products_ndc_idx" ON "mdrp_products" USING btree ("ndc11");