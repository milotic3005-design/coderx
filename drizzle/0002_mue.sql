CREATE TABLE "mue_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"hcpcs_code" text NOT NULL,
	"service_type" text NOT NULL,
	"period" text NOT NULL,
	"source_release_id" integer NOT NULL,
	"mue_value" integer NOT NULL,
	"adjudication_indicator" integer,
	"adjudication_text" text,
	"rationale" text
);
--> statement-breakpoint
ALTER TABLE "mue_values" ADD CONSTRAINT "mue_values_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mue_values_uq" ON "mue_values" USING btree ("hcpcs_code","service_type","source_release_id");--> statement-breakpoint
CREATE INDEX "mue_values_code_idx" ON "mue_values" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "mue_values_release_idx" ON "mue_values" USING btree ("source_release_id");