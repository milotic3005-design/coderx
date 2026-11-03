CREATE TABLE "mcd_article_hcpcs" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"version" integer NOT NULL,
	"hcpcs_code" text NOT NULL,
	"code_group" integer,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcd_article_icd10" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"version" integer NOT NULL,
	"code" text NOT NULL,
	"code_group" integer,
	"description" text,
	"asterisk" boolean DEFAULT false NOT NULL,
	"sort_order" integer,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcd_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"version" integer NOT NULL,
	"display_id" text NOT NULL,
	"title" text NOT NULL,
	"article_type" text,
	"effective_date" date,
	"end_date" date,
	"contractors" jsonb NOT NULL,
	"states" jsonb NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcd_article_hcpcs" ADD CONSTRAINT "mcd_article_hcpcs_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcd_article_icd10" ADD CONSTRAINT "mcd_article_icd10_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcd_articles" ADD CONSTRAINT "mcd_articles_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcd_article_hcpcs_code_idx" ON "mcd_article_hcpcs" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "mcd_article_hcpcs_release_idx" ON "mcd_article_hcpcs" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "mcd_article_icd10_article_idx" ON "mcd_article_icd10" USING btree ("article_id","version");--> statement-breakpoint
CREATE INDEX "mcd_article_icd10_release_idx" ON "mcd_article_icd10" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "mcd_articles_article_idx" ON "mcd_articles" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "mcd_articles_release_idx" ON "mcd_articles" USING btree ("source_release_id");