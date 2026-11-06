CREATE TABLE "ndc_rxcui" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_ndc9" text NOT NULL,
	"rxcui" text NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ndc_rxcui" ADD CONSTRAINT "ndc_rxcui_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ndc_rxcui_pair_uq" ON "ndc_rxcui" USING btree ("product_ndc9","rxcui");--> statement-breakpoint
CREATE INDEX "ndc_rxcui_rxcui_idx" ON "ndc_rxcui" USING btree ("rxcui");--> statement-breakpoint
CREATE INDEX "ndc_rxcui_release_idx" ON "ndc_rxcui" USING btree ("source_release_id");