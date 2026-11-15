CREATE TABLE "partd_wa_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_key" text NOT NULL,
	"plan_name" text NOT NULL,
	"plan_type" text NOT NULL,
	"formulary_id" text NOT NULL,
	"deductible" numeric,
	"tier_costs" jsonb NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wa_exchange_plans" ADD COLUMN "cost_details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "partd_wa_plans" ADD CONSTRAINT "partd_wa_plans_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partd_wa_plans_formulary_idx" ON "partd_wa_plans" USING btree ("formulary_id");--> statement-breakpoint
CREATE INDEX "partd_wa_plans_release_idx" ON "partd_wa_plans" USING btree ("source_release_id");