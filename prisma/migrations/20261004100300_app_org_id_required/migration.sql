-- t-115: every app_* row must name its org.
--
-- Every tenant-owned app_* table carries a nullable `orgId` (t-112, following
-- Sunrise, whose own tables leave NOT NULL to a later stage). The tenancy
-- extension stamps it on every create, so nothing writes a row without one
-- today. But a row with no org would belong to nobody: no org's screens would
-- show it, and no per-org unique key would catch it, because Postgres treats
-- two NULLs as different. A person's acceptance of the terms could then be
-- stored twice. The owner's ruling: the database refuses such a row, so the
-- fault shows the day it is introduced.
--
-- A CHECK rather than NOT NULL, so Prisma's types (and every create in the
-- leaf) are unchanged: Prisma cannot model a CHECK, which is why each one is
-- pinned by a drift probe over APP_ORG_OWNED_TABLES in
-- lib/app/leaf-db-drift.ts. An always-run test pins that list to the
-- schema's tenant-owned app_* tables, so a new one fails until it is listed,
-- and `db:drift-check` then fails until its migration adds the CHECK.
--
-- Every existing row should already have an org: t-112 backfilled them, and
-- the tenancy client has stamped every create since. A row written without
-- one (a raw INSERT, a create under runAsSystem) would make its ALTER fail and
-- stop the deploy, so each table is backfilled to the install org first, as
-- t-112 did. That is where every such row came from: nothing but the install
-- org has written to these tables.
--
-- The backfill is DML, and on a database where `db:tenancy:enable` has run
-- (FORCE ROW LEVEL SECURITY) a NOBYPASSRLS owner would see none of the rows,
-- so the bypass is on for this transaction only. The CHECK's own validation
-- is not subject to row security.
-- Hand-written, not `migrate diff` output (B13).

SELECT set_config('app.bypass_rls', 'on', true);

UPDATE "app_acknowledgement" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_acknowledgement" ADD CONSTRAINT "app_acknowledgement_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_agent_settings" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_agent_settings" ADD CONSTRAINT "app_agent_settings_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_crisis_copy" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_crisis_copy" ADD CONSTRAINT "app_crisis_copy_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_crisis_region" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_crisis_region" ADD CONSTRAINT "app_crisis_region_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_discovery_question" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_discovery_question" ADD CONSTRAINT "app_discovery_question_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_discovery_question_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_discovery_question_revision" ADD CONSTRAINT "app_discovery_question_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_document_collection" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_document_collection" ADD CONSTRAINT "app_document_collection_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_foundational_document" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_foundational_document" ADD CONSTRAINT "app_foundational_document_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_foundational_document_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_foundational_document_revision" ADD CONSTRAINT "app_foundational_document_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_journey" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_journey" ADD CONSTRAINT "app_journey_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_journey_module" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_journey_module" ADD CONSTRAINT "app_journey_module_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_journey_module_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_journey_module_revision" ADD CONSTRAINT "app_journey_module_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_journey_tier" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_journey_tier" ADD CONSTRAINT "app_journey_tier_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_journey_tier_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_journey_tier_revision" ADD CONSTRAINT "app_journey_tier_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_knowledge_designation" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_knowledge_designation" ADD CONSTRAINT "app_knowledge_designation_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_question_set" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_question_set" ADD CONSTRAINT "app_question_set_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_question_set_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_question_set_revision" ADD CONSTRAINT "app_question_set_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_resource" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_resource" ADD CONSTRAINT "app_resource_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_resource_collection" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_resource_collection" ADD CONSTRAINT "app_resource_collection_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_resource_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_resource_revision" ADD CONSTRAINT "app_resource_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_resource_words" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_resource_words" ADD CONSTRAINT "app_resource_words_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_resource_words_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_resource_words_revision" ADD CONSTRAINT "app_resource_words_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_safety_event" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_safety_event" ADD CONSTRAINT "app_safety_event_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_slot_definition" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_slot_definition" ADD CONSTRAINT "app_slot_definition_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_slot_definition_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_slot_definition_revision" ADD CONSTRAINT "app_slot_definition_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_turn" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_turn" ADD CONSTRAINT "app_turn_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_turn_slot_write" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_turn_slot_write" ADD CONSTRAINT "app_turn_slot_write_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_user_budget" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_user_budget" ADD CONSTRAINT "app_user_budget_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_comparison" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_comparison" ADD CONSTRAINT "app_voice_comparison_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_comparison_arm" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_comparison_arm" ADD CONSTRAINT "app_voice_comparison_arm_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_golden_set" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_golden_set" ADD CONSTRAINT "app_voice_golden_set_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_golden_set_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_golden_set_revision" ADD CONSTRAINT "app_voice_golden_set_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_overlay" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_overlay" ADD CONSTRAINT "app_voice_overlay_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_overlay_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_overlay_revision" ADD CONSTRAINT "app_voice_overlay_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_overlay_set" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_overlay_set" ADD CONSTRAINT "app_voice_overlay_set_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_voice_overlay_set_revision" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_voice_overlay_set_revision" ADD CONSTRAINT "app_voice_overlay_set_revision_orgId_not_null" CHECK ("orgId" IS NOT NULL);
UPDATE "app_waitlist_entry" SET "orgId" = 'install' WHERE "orgId" IS NULL;
ALTER TABLE "app_waitlist_entry" ADD CONSTRAINT "app_waitlist_entry_orgId_not_null" CHECK ("orgId" IS NOT NULL);
