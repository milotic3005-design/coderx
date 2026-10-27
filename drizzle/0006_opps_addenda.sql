CREATE TABLE "opps_apc_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"apc" text NOT NULL,
	"period" text NOT NULL,
	"title" text,
	"status_indicator" text,
	"relative_weight" numeric(12, 4),
	"payment_rate" numeric(14, 3),
	"national_copay" numeric(14, 3),
	"minimum_copay" numeric(14, 3),
	"ira_coinsurance_pct" numeric(7, 3),
	"adjusted_copay" numeric(14, 3),
	"pass_through_expiration" text,
	"note" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opps_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"hcpcs_code" text NOT NULL,
	"period" text NOT NULL,
	"status_indicator" text,
	"apc" text,
	"relative_weight" numeric(12, 4),
	"payment_rate" numeric(14, 3),
	"national_copay" numeric(14, 3),
	"minimum_copay" numeric(14, 3),
	"ira_coinsurance_pct" numeric(7, 3),
	"adjusted_copay" numeric(14, 3),
	"pass_through_expiration" text,
	"note" text,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opps_apc_rates" ADD CONSTRAINT "opps_apc_rates_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opps_rates" ADD CONSTRAINT "opps_rates_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opps_apc_rates_apc_idx" ON "opps_apc_rates" USING btree ("apc");--> statement-breakpoint
CREATE INDEX "opps_apc_rates_release_idx" ON "opps_apc_rates" USING btree ("source_release_id");--> statement-breakpoint
CREATE INDEX "opps_rates_code_idx" ON "opps_rates" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "opps_rates_release_idx" ON "opps_rates" USING btree ("source_release_id");