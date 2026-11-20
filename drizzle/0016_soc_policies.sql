CREATE TABLE "soc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"payer_key" text NOT NULL,
	"role" text NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"policy_number" text,
	"effective_date" date,
	"sha256" text NOT NULL,
	"criteria_text" text,
	"criteria_hash" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "soc_list_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_id" integer NOT NULL,
	"payer_key" text NOT NULL,
	"code" text,
	"label" text NOT NULL,
	"added_date" date,
	"oncology_star" boolean DEFAULT false NOT NULL,
	"home_infusion_eligible" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "soc_documents" ADD CONSTRAINT "soc_documents_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_list_entries" ADD CONSTRAINT "soc_list_entries_document_id_soc_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."soc_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "soc_list_entries" ADD CONSTRAINT "soc_list_entries_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "soc_documents_payer_idx" ON "soc_documents" USING btree ("payer_key");--> statement-breakpoint
CREATE INDEX "soc_documents_release_idx" ON "soc_documents" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "soc_list_entries_payer_idx" ON "soc_list_entries" USING btree ("payer_key");--> statement-breakpoint
CREATE INDEX "soc_list_entries_code_idx" ON "soc_list_entries" USING btree ("code");--> statement-breakpoint
CREATE INDEX "soc_list_entries_release_idx" ON "soc_list_entries" USING btree ("source_release_id");