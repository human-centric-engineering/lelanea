-- t-112 (Daybreak 0.6.0 / Sunrise 0.13.0 §107): every Lelañea row knows its org.
--
-- Sunrise's always-run guards classify every model as tenant-owned (carries
-- `orgId`), global config or system. Daybreak made its 19 framework tables
-- tenant-owned and asks leaves to do the same; ours are all 37 app_* tables.
-- Shape follows Daybreak's 20260925100000_framework_tenant_owned_org_id:
-- nullable `orgId`, backfilled to the install org, indexed, FK to "org"
-- ON DELETE CASCADE, named exactly as Prisma names the `org` relation so it
-- treats the constraint as its own. The back-relations sit in a LELAÑEA
-- block on Sunrise's `Org` model, below Daybreak's.
--
-- Three tables were keyed by a `slug` alone, which the org-scoped-slugs guard
-- names: app_agent_settings and app_crisis_copy (singletons, slug 'global')
-- and app_slot_definition. Each gets a generated `id` as its primary key and
-- `@@unique([orgId, slug])`. Slot-definition revisions pointed at their
-- definition by slug; they now point by `definitionId`, backfilled from the
-- slug, and keep `slotSlug` as a plain column.
--
-- Owner ruling (29 Sept 2026): the 14 tables keyed by an authored name
-- (module and collection ids, situations, region codes, words keys) and
-- app_user_budget (keyed by user id) keep install-wide keys for now. Harmless
-- at TENANCY_MODE=single; they must become per-org before anyone enables
-- `multi` (.context/app/database-changes.md, and a Hub task).
--
-- Generated ids use the cuid-shaped expression, never a bare UUID: see the
-- t-93 note in .context/app/database-changes.md.
--
-- Hand-written, not `migrate diff` output (B13): the diff also emitted drops
-- for every hand-written FK and unmodellable index in the schema. Scoped to
-- app_* tables only.

-- 1. Columns
ALTER TABLE "app_acknowledgement" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_agent_settings" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_crisis_copy" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_crisis_region" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_discovery_question" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_discovery_question_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_document_collection" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_foundational_document" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_foundational_document_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_journey" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_journey_module" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_journey_module_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_journey_tier" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_journey_tier_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_knowledge_designation" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_question_set" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_question_set_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_resource" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_resource_collection" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_resource_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_resource_words" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_resource_words_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_safety_event" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_slot_definition" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_slot_definition_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_turn" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_turn_slot_write" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_user_budget" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_comparison" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_comparison_arm" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_golden_set" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_golden_set_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_overlay" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_overlay_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_overlay_set" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_voice_overlay_set_revision" ADD COLUMN "orgId" TEXT;
ALTER TABLE "app_waitlist_entry" ADD COLUMN "orgId" TEXT;

-- 2. Backfill every existing row to the install org (lib/tenancy/constants.ts INSTALL_ORG_ID)
UPDATE "app_acknowledgement" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_agent_settings" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_crisis_copy" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_crisis_region" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_discovery_question" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_discovery_question_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_document_collection" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_foundational_document" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_foundational_document_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_journey" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_journey_module" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_journey_module_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_journey_tier" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_journey_tier_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_knowledge_designation" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_question_set" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_question_set_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_resource" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_resource_collection" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_resource_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_resource_words" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_resource_words_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_safety_event" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_slot_definition" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_slot_definition_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_turn" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_turn_slot_write" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_user_budget" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_comparison" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_comparison_arm" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_golden_set" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_golden_set_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_overlay" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_overlay_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_overlay_set" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_voice_overlay_set_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "app_waitlist_entry" SET "orgId" = 'install' WHERE "orgId" IS NULL;

-- 3. Three slug-keyed tables get a generated primary key
-- Revisions stop pointing at a definition by slug before its key changes.
ALTER TABLE "app_slot_definition_revision" DROP CONSTRAINT "app_slot_definition_revision_slotSlug_fkey";
DROP INDEX "app_slot_definition_revision_slotSlug_version_key";
ALTER TABLE "app_agent_settings" ADD COLUMN "id" TEXT;
UPDATE "app_agent_settings" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '') WHERE "id" IS NULL;
ALTER TABLE "app_agent_settings" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app_agent_settings" DROP CONSTRAINT "app_agent_settings_pkey";
ALTER TABLE "app_agent_settings" ADD CONSTRAINT "app_agent_settings_pkey" PRIMARY KEY ("id");
ALTER TABLE "app_crisis_copy" ADD COLUMN "id" TEXT;
UPDATE "app_crisis_copy" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '') WHERE "id" IS NULL;
ALTER TABLE "app_crisis_copy" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app_crisis_copy" DROP CONSTRAINT "app_crisis_copy_pkey";
ALTER TABLE "app_crisis_copy" ADD CONSTRAINT "app_crisis_copy_pkey" PRIMARY KEY ("id");
ALTER TABLE "app_slot_definition" ADD COLUMN "id" TEXT;
UPDATE "app_slot_definition" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '') WHERE "id" IS NULL;
ALTER TABLE "app_slot_definition" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "app_slot_definition" DROP CONSTRAINT "app_slot_definition_pkey";
ALTER TABLE "app_slot_definition" ADD CONSTRAINT "app_slot_definition_pkey" PRIMARY KEY ("id");
ALTER TABLE "app_slot_definition_revision" ADD COLUMN "definitionId" TEXT;
UPDATE "app_slot_definition_revision" AS r SET "definitionId" = d."id"
  FROM "app_slot_definition" AS d WHERE d."slug" = r."slotSlug";
ALTER TABLE "app_slot_definition_revision" ALTER COLUMN "definitionId" SET NOT NULL;
CREATE UNIQUE INDEX "app_slot_definition_revision_definitionId_version_key" ON "app_slot_definition_revision"("definitionId", "version");
ALTER TABLE "app_slot_definition_revision" ADD CONSTRAINT "app_slot_definition_revision_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "app_slot_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. The per-org slug keys, built after the backfill so they admit exactly the rows the old keys did
CREATE UNIQUE INDEX "app_agent_settings_orgId_slug_key" ON "app_agent_settings"("orgId", "slug");
CREATE UNIQUE INDEX "app_crisis_copy_orgId_slug_key" ON "app_crisis_copy"("orgId", "slug");
CREATE UNIQUE INDEX "app_slot_definition_orgId_slug_key" ON "app_slot_definition"("orgId", "slug");

-- 5. orgId indexes
CREATE INDEX "app_acknowledgement_orgId_idx" ON "app_acknowledgement"("orgId");
CREATE INDEX "app_agent_settings_orgId_idx" ON "app_agent_settings"("orgId");
CREATE INDEX "app_crisis_copy_orgId_idx" ON "app_crisis_copy"("orgId");
CREATE INDEX "app_crisis_region_orgId_idx" ON "app_crisis_region"("orgId");
CREATE INDEX "app_discovery_question_orgId_idx" ON "app_discovery_question"("orgId");
CREATE INDEX "app_discovery_question_revision_orgId_idx" ON "app_discovery_question_revision"("orgId");
CREATE INDEX "app_document_collection_orgId_idx" ON "app_document_collection"("orgId");
CREATE INDEX "app_foundational_document_orgId_idx" ON "app_foundational_document"("orgId");
CREATE INDEX "app_foundational_document_revision_orgId_idx" ON "app_foundational_document_revision"("orgId");
CREATE INDEX "app_journey_orgId_idx" ON "app_journey"("orgId");
CREATE INDEX "app_journey_module_orgId_idx" ON "app_journey_module"("orgId");
CREATE INDEX "app_journey_module_revision_orgId_idx" ON "app_journey_module_revision"("orgId");
CREATE INDEX "app_journey_tier_orgId_idx" ON "app_journey_tier"("orgId");
CREATE INDEX "app_journey_tier_revision_orgId_idx" ON "app_journey_tier_revision"("orgId");
CREATE INDEX "app_knowledge_designation_orgId_idx" ON "app_knowledge_designation"("orgId");
CREATE INDEX "app_question_set_orgId_idx" ON "app_question_set"("orgId");
CREATE INDEX "app_question_set_revision_orgId_idx" ON "app_question_set_revision"("orgId");
CREATE INDEX "app_resource_orgId_idx" ON "app_resource"("orgId");
CREATE INDEX "app_resource_collection_orgId_idx" ON "app_resource_collection"("orgId");
CREATE INDEX "app_resource_revision_orgId_idx" ON "app_resource_revision"("orgId");
CREATE INDEX "app_resource_words_orgId_idx" ON "app_resource_words"("orgId");
CREATE INDEX "app_resource_words_revision_orgId_idx" ON "app_resource_words_revision"("orgId");
CREATE INDEX "app_safety_event_orgId_idx" ON "app_safety_event"("orgId");
CREATE INDEX "app_slot_definition_orgId_idx" ON "app_slot_definition"("orgId");
CREATE INDEX "app_slot_definition_revision_orgId_idx" ON "app_slot_definition_revision"("orgId");
CREATE INDEX "app_turn_orgId_idx" ON "app_turn"("orgId");
CREATE INDEX "app_turn_slot_write_orgId_idx" ON "app_turn_slot_write"("orgId");
CREATE INDEX "app_user_budget_orgId_idx" ON "app_user_budget"("orgId");
CREATE INDEX "app_voice_comparison_orgId_idx" ON "app_voice_comparison"("orgId");
CREATE INDEX "app_voice_comparison_arm_orgId_idx" ON "app_voice_comparison_arm"("orgId");
CREATE INDEX "app_voice_golden_set_orgId_idx" ON "app_voice_golden_set"("orgId");
CREATE INDEX "app_voice_golden_set_revision_orgId_idx" ON "app_voice_golden_set_revision"("orgId");
CREATE INDEX "app_voice_overlay_orgId_idx" ON "app_voice_overlay"("orgId");
CREATE INDEX "app_voice_overlay_revision_orgId_idx" ON "app_voice_overlay_revision"("orgId");
CREATE INDEX "app_voice_overlay_set_orgId_idx" ON "app_voice_overlay_set"("orgId");
CREATE INDEX "app_voice_overlay_set_revision_orgId_idx" ON "app_voice_overlay_set_revision"("orgId");
CREATE INDEX "app_waitlist_entry_orgId_idx" ON "app_waitlist_entry"("orgId");

-- 6. FK to "org" (mapped table name, B11), matching the Prisma `org` relation
ALTER TABLE "app_acknowledgement" ADD CONSTRAINT "app_acknowledgement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_agent_settings" ADD CONSTRAINT "app_agent_settings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_crisis_copy" ADD CONSTRAINT "app_crisis_copy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_crisis_region" ADD CONSTRAINT "app_crisis_region_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_discovery_question" ADD CONSTRAINT "app_discovery_question_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_discovery_question_revision" ADD CONSTRAINT "app_discovery_question_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_document_collection" ADD CONSTRAINT "app_document_collection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_foundational_document" ADD CONSTRAINT "app_foundational_document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_foundational_document_revision" ADD CONSTRAINT "app_foundational_document_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_journey" ADD CONSTRAINT "app_journey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_journey_module" ADD CONSTRAINT "app_journey_module_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_journey_module_revision" ADD CONSTRAINT "app_journey_module_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_journey_tier" ADD CONSTRAINT "app_journey_tier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_journey_tier_revision" ADD CONSTRAINT "app_journey_tier_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_knowledge_designation" ADD CONSTRAINT "app_knowledge_designation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_question_set" ADD CONSTRAINT "app_question_set_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_question_set_revision" ADD CONSTRAINT "app_question_set_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_resource" ADD CONSTRAINT "app_resource_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_resource_collection" ADD CONSTRAINT "app_resource_collection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_resource_revision" ADD CONSTRAINT "app_resource_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_resource_words" ADD CONSTRAINT "app_resource_words_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_resource_words_revision" ADD CONSTRAINT "app_resource_words_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_safety_event" ADD CONSTRAINT "app_safety_event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_slot_definition" ADD CONSTRAINT "app_slot_definition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_slot_definition_revision" ADD CONSTRAINT "app_slot_definition_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_turn" ADD CONSTRAINT "app_turn_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_turn_slot_write" ADD CONSTRAINT "app_turn_slot_write_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_user_budget" ADD CONSTRAINT "app_user_budget_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_comparison" ADD CONSTRAINT "app_voice_comparison_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_comparison_arm" ADD CONSTRAINT "app_voice_comparison_arm_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_golden_set" ADD CONSTRAINT "app_voice_golden_set_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_golden_set_revision" ADD CONSTRAINT "app_voice_golden_set_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_overlay" ADD CONSTRAINT "app_voice_overlay_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_overlay_revision" ADD CONSTRAINT "app_voice_overlay_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_overlay_set" ADD CONSTRAINT "app_voice_overlay_set_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_voice_overlay_set_revision" ADD CONSTRAINT "app_voice_overlay_set_revision_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_waitlist_entry" ADD CONSTRAINT "app_waitlist_entry_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
