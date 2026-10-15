CREATE TABLE "biologic_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"bla_number" text NOT NULL,
	"applicant" text,
	"proprietary_name" text,
	"proper_name" text,
	"license_type" text,
	"strength" text,
	"dosage_form" text,
	"route" text,
	"presentation" text,
	"marketing_status" text,
	"licensure" text,
	"approval_date" date,
	"interchangeable_approval_date" date,
	"ref_proper_name" text,
	"ref_proprietary_name" text,
	"product_number" text,
	"center" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_relationships" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"ndc11" text,
	"drug_id" integer,
	"hcpcs_code" text,
	"related_drug_id" integer,
	"related_hcpcs_code" text,
	"source_key" text NOT NULL,
	"source_release_id" integer,
	"first_period" text,
	"last_period" text,
	"effective_start" date,
	"effective_end" date,
	"authority" text NOT NULL,
	"review_status" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"evidence" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "drug_aliases" (
	"id" serial PRIMARY KEY NOT NULL,
	"drug_id" integer NOT NULL,
	"alias" text NOT NULL,
	"alias_key" text NOT NULL,
	"alias_type" text NOT NULL,
	"source_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drugs" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"brand_name" text,
	"generic_name" text,
	"product_class" text NOT NULL,
	"is_brand" boolean DEFAULT false NOT NULL,
	"biosimilar_status" text,
	"reference_drug_id" integer,
	"active_ingredients" text[] DEFAULT '{}'::text[] NOT NULL,
	"dosage_forms" text[] DEFAULT '{}'::text[] NOT NULL,
	"routes" text[] DEFAULT '{}'::text[] NOT NULL,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"marketing_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"application_numbers" text[] DEFAULT '{}'::text[] NOT NULL,
	"pharm_classes" text[] DEFAULT '{}'::text[] NOT NULL,
	"manufacturer_ids" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"hcpcs_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"has_payment" boolean DEFAULT false NOT NULL,
	"is_listed" boolean DEFAULT true NOT NULL,
	"active_until" date,
	"product_count" integer DEFAULT 0 NOT NULL,
	"package_count" integer DEFAULT 0 NOT NULL,
	"earliest_marketing_start" date,
	CONSTRAINT "drugs_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "hcpcs_code_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"period" text NOT NULL,
	"source_release_id" integer NOT NULL,
	"change_type" text NOT NULL,
	"action_code" text,
	"short_description" text,
	"long_description" text,
	"added_date" date,
	"action_effective_date" date,
	"termination_date" date,
	"previous" jsonb
);
--> statement-breakpoint
CREATE TABLE "hcpcs_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"family" text NOT NULL,
	"short_description" text,
	"long_description" text NOT NULL,
	"pricing_indicators" text[] DEFAULT '{}'::text[] NOT NULL,
	"multiple_pricing_indicator" text,
	"coverage_code" text,
	"betos" text,
	"type_of_service" text[] DEFAULT '{}'::text[] NOT NULL,
	"cross_references" text[] DEFAULT '{}'::text[] NOT NULL,
	"processing_note" text,
	"added_date" date,
	"action_effective_date" date,
	"termination_date" date,
	"action_code" text,
	"is_noc" boolean DEFAULT false NOT NULL,
	"is_drug" boolean DEFAULT false NOT NULL,
	"first_seen_period" text,
	"last_seen_period" text,
	"dropped_from_file" boolean DEFAULT false NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hcpcs_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"period" text NOT NULL,
	"source_release_id" integer NOT NULL,
	"code" text NOT NULL,
	"short_description" text,
	"long_description" text NOT NULL,
	"pricing_indicators" text[] DEFAULT '{}'::text[] NOT NULL,
	"multiple_pricing_indicator" text,
	"coverage_code" text,
	"betos" text,
	"type_of_service" text[] DEFAULT '{}'::text[] NOT NULL,
	"cross_references" text[] DEFAULT '{}'::text[] NOT NULL,
	"processing_note" text,
	"added_date" date,
	"action_effective_date" date,
	"termination_date" date,
	"action_code" text,
	"is_noc" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"labeler_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"alt_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"product_count" integer DEFAULT 0 NOT NULL,
	"active_product_count" integer DEFAULT 0 NOT NULL,
	"hcpcs_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "manufacturers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "manufacturers_name_key_unique" UNIQUE("name_key")
);
--> statement-breakpoint
CREATE TABLE "ndc_hcpcs_crosswalk" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_release_id" integer NOT NULL,
	"period" text NOT NULL,
	"effective_start" date,
	"effective_end" date,
	"crosswalk_type" text NOT NULL,
	"hcpcs_code" text,
	"short_description" text,
	"noc_generic_name" text,
	"labeler_name" text,
	"ndc_raw" text NOT NULL,
	"ndc11" text,
	"drug_name" text,
	"hcpcs_dosage" text,
	"package_size" numeric,
	"package_quantity" numeric,
	"bill_units_per_item" numeric,
	"bill_units_per_package" numeric
);
--> statement-breakpoint
CREATE TABLE "ndc_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ndc11" text NOT NULL,
	"package_ndc" text NOT NULL,
	"product_id" text NOT NULL,
	"description" text,
	"marketing_start" date,
	"marketing_end" date,
	"sample" boolean DEFAULT false NOT NULL,
	"listing_status" text NOT NULL,
	"exclude_flag" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ndc_products" (
	"product_id" text PRIMARY KEY NOT NULL,
	"product_ndc" text NOT NULL,
	"product_ndc9" text,
	"product_type" text,
	"proprietary_name" text,
	"proprietary_name_suffix" text,
	"nonproprietary_name" text,
	"dosage_form" text,
	"routes" text[] DEFAULT '{}'::text[] NOT NULL,
	"marketing_start" date,
	"marketing_end" date,
	"marketing_category" text,
	"application_number" text,
	"labeler_name" text,
	"substances" text[] DEFAULT '{}'::text[] NOT NULL,
	"strengths" text[] DEFAULT '{}'::text[] NOT NULL,
	"strength_units" text[] DEFAULT '{}'::text[] NOT NULL,
	"pharm_classes" text[] DEFAULT '{}'::text[] NOT NULL,
	"dea_schedule" text,
	"listing_certified_through" date,
	"listing_status" text NOT NULL,
	"exclude_flag" text,
	"source_release_id" integer NOT NULL,
	"drug_id" integer,
	"manufacturer_id" integer
);
--> statement-breakpoint
CREATE TABLE "part_b_not_payable" (
	"id" serial PRIMARY KEY NOT NULL,
	"hcpcs_code" text NOT NULL,
	"period" text NOT NULL,
	"source_release_id" integer NOT NULL,
	"description" text,
	"manufacturer" text
);
--> statement-breakpoint
CREATE TABLE "payment_limits" (
	"id" serial PRIMARY KEY NOT NULL,
	"hcpcs_code" text NOT NULL,
	"period" text NOT NULL,
	"effective_start" date NOT NULL,
	"effective_end" date NOT NULL,
	"source_release_id" integer NOT NULL,
	"short_description" text,
	"dosage_descriptor" text,
	"payment_limit" numeric(14, 3),
	"payment_limit_text" text,
	"coinsurance_pct" numeric(7, 3),
	"vaccine_awp_pct" numeric(7, 3),
	"vaccine_limit" numeric(14, 3),
	"blood_awp_pct" numeric(7, 3),
	"blood_limit" numeric(14, 3),
	"clotting_factor" text,
	"notes" text,
	"asp_data_period" text,
	"methodology" text
);
--> statement-breakpoint
CREATE TABLE "search_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"family" text,
	"codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"manufacturer_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"manufacturer_slugs" text[] DEFAULT '{}'::text[] NOT NULL,
	"dosage_forms" text[] DEFAULT '{}'::text[] NOT NULL,
	"routes" text[] DEFAULT '{}'::text[] NOT NULL,
	"product_class" text,
	"is_brand" boolean,
	"biosimilar_status" text,
	"has_payment" boolean DEFAULT false NOT NULL,
	"is_noc" boolean DEFAULT false NOT NULL,
	"is_drug" boolean DEFAULT false NOT NULL,
	"is_listed" boolean DEFAULT true NOT NULL,
	"status_end_date" date,
	"effective_date" date,
	"weight" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_terms" (
	"id" serial PRIMARY KEY NOT NULL,
	"doc_id" integer NOT NULL,
	"term" text NOT NULL,
	"term_type" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_releases" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_key" text NOT NULL,
	"organization" text NOT NULL,
	"dataset" text NOT NULL,
	"period_label" text,
	"file_name" text,
	"download_url" text NOT NULL,
	"landing_page_url" text,
	"publication_date" date,
	"publication_label" text,
	"effective_start" date,
	"effective_end" date,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checksum_sha256" text,
	"byte_size" integer,
	"record_count" integer,
	"status" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"report" jsonb,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "biologic_products" ADD CONSTRAINT "biologic_products_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcpcs_code_history" ADD CONSTRAINT "hcpcs_code_history_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcpcs_codes" ADD CONSTRAINT "hcpcs_codes_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hcpcs_snapshots" ADD CONSTRAINT "hcpcs_snapshots_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ndc_hcpcs_crosswalk" ADD CONSTRAINT "ndc_hcpcs_crosswalk_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ndc_packages" ADD CONSTRAINT "ndc_packages_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ndc_products" ADD CONSTRAINT "ndc_products_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_b_not_payable" ADD CONSTRAINT "part_b_not_payable_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_limits" ADD CONSTRAINT "payment_limits_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "biologic_products_bla_idx" ON "biologic_products" USING btree ("bla_number");--> statement-breakpoint
CREATE INDEX "code_relationships_kind_idx" ON "code_relationships" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "code_relationships_ndc_idx" ON "code_relationships" USING btree ("ndc11");--> statement-breakpoint
CREATE INDEX "code_relationships_drug_idx" ON "code_relationships" USING btree ("drug_id");--> statement-breakpoint
CREATE INDEX "code_relationships_code_idx" ON "code_relationships" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "code_relationships_related_drug_idx" ON "code_relationships" USING btree ("related_drug_id");--> statement-breakpoint
CREATE INDEX "drug_aliases_drug_idx" ON "drug_aliases" USING btree ("drug_id");--> statement-breakpoint
CREATE INDEX "drug_aliases_key_idx" ON "drug_aliases" USING btree ("alias_key");--> statement-breakpoint
CREATE INDEX "drugs_reference_idx" ON "drugs" USING btree ("reference_drug_id");--> statement-breakpoint
CREATE INDEX "hcpcs_code_history_code_idx" ON "hcpcs_code_history" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "hcpcs_code_history_uq" ON "hcpcs_code_history" USING btree ("code","period","change_type");--> statement-breakpoint
CREATE INDEX "hcpcs_codes_family_idx" ON "hcpcs_codes" USING btree ("family");--> statement-breakpoint
CREATE UNIQUE INDEX "hcpcs_snapshots_uq" ON "hcpcs_snapshots" USING btree ("period","code","source_release_id");--> statement-breakpoint
CREATE INDEX "hcpcs_snapshots_code_idx" ON "hcpcs_snapshots" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ndc_hcpcs_crosswalk_ndc_idx" ON "ndc_hcpcs_crosswalk" USING btree ("ndc11");--> statement-breakpoint
CREATE INDEX "ndc_hcpcs_crosswalk_code_idx" ON "ndc_hcpcs_crosswalk" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "ndc_hcpcs_crosswalk_release_idx" ON "ndc_hcpcs_crosswalk" USING btree ("source_release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ndc_packages_ndc_product_uq" ON "ndc_packages" USING btree ("ndc11","product_id");--> statement-breakpoint
CREATE INDEX "ndc_packages_product_idx" ON "ndc_packages" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ndc_packages_ndc11_prefix_idx" ON "ndc_packages" USING btree ("ndc11" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "ndc_products_ndc9_idx" ON "ndc_products" USING btree ("product_ndc9");--> statement-breakpoint
CREATE INDEX "ndc_products_drug_idx" ON "ndc_products" USING btree ("drug_id");--> statement-breakpoint
CREATE INDEX "ndc_products_manufacturer_idx" ON "ndc_products" USING btree ("manufacturer_id");--> statement-breakpoint
CREATE INDEX "ndc_products_application_idx" ON "ndc_products" USING btree ("application_number");--> statement-breakpoint
CREATE INDEX "part_b_not_payable_code_idx" ON "part_b_not_payable" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_limits_uq" ON "payment_limits" USING btree ("hcpcs_code","period","source_release_id");--> statement-breakpoint
CREATE INDEX "payment_limits_code_idx" ON "payment_limits" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "payment_limits_release_idx" ON "payment_limits" USING btree ("source_release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "search_documents_kind_key_uq" ON "search_documents" USING btree ("kind","key");--> statement-breakpoint
CREATE INDEX "search_terms_doc_idx" ON "search_terms" USING btree ("doc_id");--> statement-breakpoint
CREATE INDEX "search_terms_term_pattern_idx" ON "search_terms" USING btree ("term" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "search_terms_term_trgm_idx" ON "search_terms" USING gin ("term" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "source_releases_key_period_idx" ON "source_releases" USING btree ("source_key","period_label");--> statement-breakpoint
CREATE UNIQUE INDEX "source_releases_succeeded_checksum_uq" ON "source_releases" USING btree ("source_key","period_label","checksum_sha256") WHERE "source_releases"."status" = 'succeeded';