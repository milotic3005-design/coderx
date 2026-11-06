CREATE TABLE "mcd_sad_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"version" integer NOT NULL,
	"row_number" integer,
	"hcpcs_code" text NOT NULL,
	"product_text" text NOT NULL,
	"effective_date" date,
	"end_date" date,
	"reasons" jsonb NOT NULL,
	"route_flag" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mcd_sad_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"article_id" integer NOT NULL,
	"version" integer NOT NULL,
	"display_id" text NOT NULL,
	"effective_date" date,
	"contractors" jsonb NOT NULL,
	"states" jsonb NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mcd_sad_entries" ADD CONSTRAINT "mcd_sad_entries_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcd_sad_lists" ADD CONSTRAINT "mcd_sad_lists_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcd_sad_entries_code_idx" ON "mcd_sad_entries" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "mcd_sad_entries_article_idx" ON "mcd_sad_entries" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "mcd_sad_entries_release_idx" ON "mcd_sad_entries" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "mcd_sad_lists_article_idx" ON "mcd_sad_lists" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "mcd_sad_lists_release_idx" ON "mcd_sad_lists" USING btree ("source_release_id");