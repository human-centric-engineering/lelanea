-- §34 f-framework-tenancy (Hub t-134): every framework row knows its org.
--
-- Sunrise 0.13.0 (§107) classifies every model as tenant-owned (carries
-- `orgId`), global config or system, and its always-run guards fail on any
-- model that is none of them — the 19 framework_* tables included. Ruling
-- (Hub decision on §34, 2026-09-25): all 19 are tenant-owned.
--
-- Shape follows Sunrise's 20260919200000_tenant_owned_org_id: nullable
-- `orgId`, backfilled to the install org, indexed, FK to "org" ON DELETE
-- CASCADE (so eraseOrg() cascades without enumerating tables). The FK is written
-- here by hand, named and ruled exactly as Prisma names the `org` relation each
-- model declares (`<table>_orgId_fkey`, ON DELETE/UPDATE CASCADE), so Prisma
-- treats it as its own. The back-relations sit in a marked DAYBREAK block on
-- Sunrise's `Org` model (its model-classification test requires the relation).
-- NOT NULL is a later staged migration, as upstream.
--
-- Seven global uniques become per-org, so two orgs (or one user in two orgs)
-- can hold the same slug / role / slug-keyed row: framework_module.slug,
-- framework_facilitation_graph.slug, framework_slot_definition.slug,
-- framework_facilitation_agent.role, and the slug-keyed uniques on
-- framework_user_journey, framework_slot_value and framework_node_embedding.
-- The backfill runs BEFORE the new uniques are built, so every row carries
-- 'install' and the per-org key admits exactly the rows the global one did.
--
-- Hand-folded from `prisma migrate diff` (B13): it also emitted DROPs for the
-- 14 hand-written framework FKs, the framework HNSW index, three Sunrise
-- pgvector/tsvector indexes and the GENERATED searchVector default — Prisma
-- cannot model any of them. All removed. Scoped to framework_* tables only.


-- 1. Columns
ALTER TABLE "framework_conversation_eval" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_facilitation_agent" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_facilitation_graph" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_facilitation_graph_version" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_facilitation_policy" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_journey_event" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_journey_nudge" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_module" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_module_agent" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_module_knowledge_document" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_module_knowledge_tag" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_module_version" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_module_workflow" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_node_embedding" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_slot_definition" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_slot_value" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_structure_change_proposal" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_user_journey" ADD COLUMN     "orgId" TEXT;
ALTER TABLE "framework_user_node_state" ADD COLUMN     "orgId" TEXT;

-- 2. Backfill every existing row to the install org (lib/tenancy/constants.ts INSTALL_ORG_ID)
UPDATE "framework_conversation_eval" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_facilitation_agent" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_facilitation_graph" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_facilitation_graph_version" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_facilitation_policy" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_journey_event" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_journey_nudge" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_module" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_module_agent" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_module_knowledge_document" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_module_knowledge_tag" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_module_version" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_module_workflow" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_node_embedding" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_slot_definition" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_slot_value" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_structure_change_proposal" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_user_journey" SET "orgId" = 'install' WHERE "orgId" IS NULL;
UPDATE "framework_user_node_state" SET "orgId" = 'install' WHERE "orgId" IS NULL;

-- 3. The seven global uniques this migration makes per-org
DROP INDEX "framework_facilitation_agent_role_key";
DROP INDEX "framework_facilitation_graph_slug_key";
DROP INDEX "framework_module_slug_key";
DROP INDEX "framework_node_embedding_graphSlug_nodeKey_version_key";
DROP INDEX "framework_slot_definition_slug_key";
DROP INDEX "framework_slot_value_userId_slotSlug_version_key";
DROP INDEX "framework_user_journey_userId_graphSlug_contextKey_key";

-- 4. orgId indexes + the per-org uniques
CREATE INDEX "framework_conversation_eval_orgId_idx" ON "framework_conversation_eval"("orgId");
CREATE INDEX "framework_facilitation_agent_orgId_idx" ON "framework_facilitation_agent"("orgId");
CREATE UNIQUE INDEX "framework_facilitation_agent_orgId_role_key" ON "framework_facilitation_agent"("orgId", "role");
CREATE INDEX "framework_facilitation_graph_orgId_idx" ON "framework_facilitation_graph"("orgId");
CREATE UNIQUE INDEX "framework_facilitation_graph_orgId_slug_key" ON "framework_facilitation_graph"("orgId", "slug");
CREATE INDEX "framework_facilitation_graph_version_orgId_idx" ON "framework_facilitation_graph_version"("orgId");
CREATE INDEX "framework_facilitation_policy_orgId_idx" ON "framework_facilitation_policy"("orgId");
CREATE INDEX "framework_journey_event_orgId_idx" ON "framework_journey_event"("orgId");
CREATE INDEX "framework_journey_nudge_orgId_idx" ON "framework_journey_nudge"("orgId");
CREATE INDEX "framework_module_orgId_idx" ON "framework_module"("orgId");
CREATE UNIQUE INDEX "framework_module_orgId_slug_key" ON "framework_module"("orgId", "slug");
CREATE INDEX "framework_module_agent_orgId_idx" ON "framework_module_agent"("orgId");
CREATE INDEX "framework_module_knowledge_document_orgId_idx" ON "framework_module_knowledge_document"("orgId");
CREATE INDEX "framework_module_knowledge_tag_orgId_idx" ON "framework_module_knowledge_tag"("orgId");
CREATE INDEX "framework_module_version_orgId_idx" ON "framework_module_version"("orgId");
CREATE INDEX "framework_module_workflow_orgId_idx" ON "framework_module_workflow"("orgId");
CREATE INDEX "framework_node_embedding_orgId_idx" ON "framework_node_embedding"("orgId");
CREATE UNIQUE INDEX "framework_node_embedding_orgId_graphSlug_nodeKey_version_key" ON "framework_node_embedding"("orgId", "graphSlug", "nodeKey", "version");
CREATE INDEX "framework_slot_definition_orgId_idx" ON "framework_slot_definition"("orgId");
CREATE UNIQUE INDEX "framework_slot_definition_orgId_slug_key" ON "framework_slot_definition"("orgId", "slug");
CREATE INDEX "framework_slot_value_orgId_idx" ON "framework_slot_value"("orgId");
CREATE UNIQUE INDEX "framework_slot_value_orgId_userId_slotSlug_version_key" ON "framework_slot_value"("orgId", "userId", "slotSlug", "version");
CREATE INDEX "framework_structure_change_proposal_orgId_idx" ON "framework_structure_change_proposal"("orgId");
CREATE INDEX "framework_user_journey_orgId_idx" ON "framework_user_journey"("orgId");
CREATE UNIQUE INDEX "framework_user_journey_orgId_userId_graphSlug_contextKey_key" ON "framework_user_journey"("orgId", "userId", "graphSlug", "contextKey");
CREATE INDEX "framework_user_node_state_orgId_idx" ON "framework_user_node_state"("orgId");

-- 5. FK to "org" (mapped table name, B11), matching the Prisma `org` relation
ALTER TABLE "framework_conversation_eval" ADD CONSTRAINT "framework_conversation_eval_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_facilitation_agent" ADD CONSTRAINT "framework_facilitation_agent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_facilitation_graph" ADD CONSTRAINT "framework_facilitation_graph_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_facilitation_graph_version" ADD CONSTRAINT "framework_facilitation_graph_version_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_facilitation_policy" ADD CONSTRAINT "framework_facilitation_policy_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_journey_event" ADD CONSTRAINT "framework_journey_event_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_journey_nudge" ADD CONSTRAINT "framework_journey_nudge_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_module" ADD CONSTRAINT "framework_module_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_module_agent" ADD CONSTRAINT "framework_module_agent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_module_knowledge_document" ADD CONSTRAINT "framework_module_knowledge_document_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_module_knowledge_tag" ADD CONSTRAINT "framework_module_knowledge_tag_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_module_version" ADD CONSTRAINT "framework_module_version_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_module_workflow" ADD CONSTRAINT "framework_module_workflow_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_node_embedding" ADD CONSTRAINT "framework_node_embedding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_slot_definition" ADD CONSTRAINT "framework_slot_definition_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_slot_value" ADD CONSTRAINT "framework_slot_value_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_structure_change_proposal" ADD CONSTRAINT "framework_structure_change_proposal_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_user_journey" ADD CONSTRAINT "framework_user_journey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "framework_user_node_state" ADD CONSTRAINT "framework_user_node_state_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;
