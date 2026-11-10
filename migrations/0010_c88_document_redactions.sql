-- 0010: c88 privilege tagging and redaction (PR #87, merged without its migration).
-- Creates document_redactions and widens document_access_log.action to add
-- 'privilege_change' and 'redaction'. Generated with drizzle-kit, then:
--   - removed intake_consents.language and its CHECK (already created by 0009;
--     the 0009 snapshot was not committed, so drizzle-kit re-emitted them)
--   - added the hand-written RLS/GRANT section at the end, per the MIGRATION
--     NOTE beside documentRedactions in src/db/tables/document.ts.
CREATE TABLE "document_redactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"matter_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"redacted_document_id" uuid,
	"status" text DEFAULT 'suggested' NOT NULL,
	"method" text DEFAULT 'heuristic' NOT NULL,
	"suggested_spans" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"text_sha256" text NOT NULL,
	"suggested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_spans" jsonb,
	"confirmed_by_user_id" uuid,
	"confirmed_at" timestamp with time zone,
	"reason" text,
	"applied_at" timestamp with time zone,
	"rejected_at" timestamp with time zone,
	CONSTRAINT "document_redactions_status_check" CHECK ("document_redactions"."status" in ('suggested','confirmed','applied','rejected')),
	CONSTRAINT "document_redactions_method_check" CHECK ("document_redactions"."method" = 'heuristic'),
	CONSTRAINT "document_redactions_applied_check" CHECK ("document_redactions"."status" <> 'applied' or ("document_redactions"."redacted_document_id" is not null and "document_redactions"."applied_at" is not null and "document_redactions"."confirmed_by_user_id" is not null and "document_redactions"."confirmed_at" is not null and "document_redactions"."reason" is not null)),
	CONSTRAINT "document_redactions_rejected_check" CHECK ("document_redactions"."status" <> 'rejected' or ("document_redactions"."rejected_at" is not null and "document_redactions"."reason" is not null))
);
--> statement-breakpoint
ALTER TABLE "document_access_log" DROP CONSTRAINT "document_access_log_action_check";--> statement-breakpoint
ALTER TABLE "document_redactions" ADD CONSTRAINT "document_redactions_tenant_id_firms_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."firms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_redactions" ADD CONSTRAINT "document_redactions_matter_id_matters_id_fk" FOREIGN KEY ("matter_id") REFERENCES "public"."matters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_redactions" ADD CONSTRAINT "document_redactions_group_id_document_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."document_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_redactions" ADD CONSTRAINT "document_redactions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_redactions" ADD CONSTRAINT "document_redactions_redacted_document_id_documents_id_fk" FOREIGN KEY ("redacted_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_redactions" ADD CONSTRAINT "document_redactions_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_redactions_tenant_matter_idx" ON "document_redactions" USING btree ("tenant_id","matter_id","status");--> statement-breakpoint
CREATE INDEX "document_redactions_tenant_group_idx" ON "document_redactions" USING btree ("tenant_id","group_id");--> statement-breakpoint
CREATE INDEX "document_redactions_tenant_source_idx" ON "document_redactions" USING btree ("tenant_id","source_document_id");--> statement-breakpoint
ALTER TABLE "document_access_log" ADD CONSTRAINT "document_access_log_action_check" CHECK ("document_access_log"."action" in ('view','download','list','search','version_history','privilege_change','redaction'));
--> statement-breakpoint
-- Hand-written: RLS, tenant isolation, grants (see the c88 MIGRATION NOTE).
ALTER TABLE "document_redactions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "document_redactions" USING (tenant_id = current_setting('app.tenant_id', true)::uuid) WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "document_redactions" TO app_runtime;
--> statement-breakpoint
REVOKE DELETE ON "document_redactions" FROM app_runtime;
--> statement-breakpoint
REVOKE ALL ON "document_redactions" FROM anon, authenticated;
