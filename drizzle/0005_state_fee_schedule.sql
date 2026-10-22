CREATE TABLE "state_fee_schedule" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"program" text NOT NULL,
	"hcpcs_code" text NOT NULL,
	"modifier" text,
	"status_indicator" text,
	"fees" jsonb NOT NULL,
	"prior_auth" text,
	"comments" text,
	"effective_date" date NOT NULL,
	"source_release_id" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "state_fee_schedule" ADD CONSTRAINT "state_fee_schedule_source_release_id_source_releases_id_fk" FOREIGN KEY ("source_release_id") REFERENCES "public"."source_releases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "state_fee_schedule_code_idx" ON "state_fee_schedule" USING btree ("hcpcs_code");--> statement-breakpoint
CREATE INDEX "state_fee_schedule_release_idx" ON "state_fee_schedule" USING btree ("source_release_id");