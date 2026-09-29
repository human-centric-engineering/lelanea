-- t-113: the ten content tables are keyed per org.
--
-- t-112 gave every app_* row an `orgId` but left these tables keyed by an
-- authored name (a document, journey, tier, module, question set, question,
-- resource or collection id, and a words key) unique across the install, so
-- two orgs could never both hold a `module_01_values`. Each now follows
-- t-112's app_slot_definition: a generated `id` primary key, the authored
-- name in `slug` (words: `key`) unique with `orgId`, and every child pointing
-- at its parent's generated id while keeping the parent's name in a plain
-- `…Slug` column (words revisions: the existing `wordsKey`).
--
-- The FK columns keep their names, so the existing constraints and indexes
-- carry over. And every one of those FKs is ON UPDATE CASCADE, so step 3,
-- which replaces each parent's authored id with a generated one, rewrites
-- every child's FK in the same statement. Steps 1 and 2 copy the authored
-- names out first.
--
-- The five other name-keyed tables (voice overlays, golden set, crisis
-- regions, user budgets) are t-114.
--
-- Generated ids use the cuid-shaped expression, never a bare UUID: see the
-- t-93 note in .context/app/database-changes.md.
--
-- Hand-written, not `migrate diff` output (B13): the diff drops and re-adds
-- the renamed columns, losing their data, and emits drops for hand-written
-- FKs and indexes elsewhere in the schema.

-- Every step below reads and writes tenant-owned rows. On a database where
-- `db:tenancy:enable` has run (FORCE ROW LEVEL SECURITY) a NOBYPASSRLS owner
-- would otherwise see none of them, update nothing, and fail at the first
-- SET NOT NULL (.context/tenancy/isolation.md). Transaction-local: Prisma
-- runs the file as one transaction.
SELECT set_config('app.bypass_rls', 'on', true);

-- 1. Children keep their parent's authored name
ALTER TABLE "app_foundational_document" ADD COLUMN "collectionSlug" TEXT;
UPDATE "app_foundational_document" SET "collectionSlug" = "collectionId";
ALTER TABLE "app_foundational_document" ALTER COLUMN "collectionSlug" SET NOT NULL;

ALTER TABLE "app_foundational_document_revision" ADD COLUMN "documentSlug" TEXT;
UPDATE "app_foundational_document_revision" SET "documentSlug" = "documentId";
ALTER TABLE "app_foundational_document_revision" ALTER COLUMN "documentSlug" SET NOT NULL;

ALTER TABLE "app_journey_tier" ADD COLUMN "journeySlug" TEXT;
UPDATE "app_journey_tier" SET "journeySlug" = "journeyId";
ALTER TABLE "app_journey_tier" ALTER COLUMN "journeySlug" SET NOT NULL;

ALTER TABLE "app_journey_module" ADD COLUMN "journeySlug" TEXT;
UPDATE "app_journey_module" SET "journeySlug" = "journeyId";
ALTER TABLE "app_journey_module" ALTER COLUMN "journeySlug" SET NOT NULL;

ALTER TABLE "app_journey_tier_revision" ADD COLUMN "tierSlug" TEXT;
UPDATE "app_journey_tier_revision" SET "tierSlug" = "tierId";
ALTER TABLE "app_journey_tier_revision" ALTER COLUMN "tierSlug" SET NOT NULL;

ALTER TABLE "app_journey_module_revision" ADD COLUMN "moduleSlug" TEXT;
UPDATE "app_journey_module_revision" SET "moduleSlug" = "moduleId";
ALTER TABLE "app_journey_module_revision" ALTER COLUMN "moduleSlug" SET NOT NULL;

ALTER TABLE "app_question_set" ADD COLUMN "moduleSlug" TEXT;
UPDATE "app_question_set" SET "moduleSlug" = "moduleId";
ALTER TABLE "app_question_set" ALTER COLUMN "moduleSlug" SET NOT NULL;

ALTER TABLE "app_question_set_revision" ADD COLUMN "setSlug" TEXT;
UPDATE "app_question_set_revision" SET "setSlug" = "setId";
ALTER TABLE "app_question_set_revision" ALTER COLUMN "setSlug" SET NOT NULL;

ALTER TABLE "app_discovery_question" ADD COLUMN "setSlug" TEXT;
UPDATE "app_discovery_question" SET "setSlug" = "setId";
ALTER TABLE "app_discovery_question" ALTER COLUMN "setSlug" SET NOT NULL;

ALTER TABLE "app_discovery_question_revision" ADD COLUMN "questionSlug" TEXT;
UPDATE "app_discovery_question_revision" SET "questionSlug" = "questionId";
ALTER TABLE "app_discovery_question_revision" ALTER COLUMN "questionSlug" SET NOT NULL;

ALTER TABLE "app_resource" ADD COLUMN "collectionSlug" TEXT;
ALTER TABLE "app_resource" ADD COLUMN "documentSlug" TEXT;
UPDATE "app_resource" SET "collectionSlug" = "collectionId", "documentSlug" = "documentId";
ALTER TABLE "app_resource" ALTER COLUMN "collectionSlug" SET NOT NULL;

ALTER TABLE "app_resource_revision" ADD COLUMN "resourceSlug" TEXT;
UPDATE "app_resource_revision" SET "resourceSlug" = "resourceId";
ALTER TABLE "app_resource_revision" ALTER COLUMN "resourceSlug" SET NOT NULL;
-- A snapshot of the resource's document, never a foreign key: it names the
-- document as authored, so it becomes the slug copy rather than an id.
ALTER TABLE "app_resource_revision" RENAME COLUMN "documentId" TO "documentSlug";

ALTER TABLE "app_resource_words" ADD COLUMN "collectionSlug" TEXT;
UPDATE "app_resource_words" SET "collectionSlug" = "collectionId";
ALTER TABLE "app_resource_words" ALTER COLUMN "collectionSlug" SET NOT NULL;

-- 2. Parents keep their authored name
ALTER TABLE "app_document_collection" ADD COLUMN "slug" TEXT;
UPDATE "app_document_collection" SET "slug" = "id";
ALTER TABLE "app_document_collection" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_foundational_document" ADD COLUMN "slug" TEXT;
UPDATE "app_foundational_document" SET "slug" = "id";
ALTER TABLE "app_foundational_document" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_journey" ADD COLUMN "slug" TEXT;
UPDATE "app_journey" SET "slug" = "id";
ALTER TABLE "app_journey" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_journey_tier" ADD COLUMN "slug" TEXT;
UPDATE "app_journey_tier" SET "slug" = "id";
ALTER TABLE "app_journey_tier" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_journey_module" ADD COLUMN "slug" TEXT;
UPDATE "app_journey_module" SET "slug" = "id";
ALTER TABLE "app_journey_module" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_question_set" ADD COLUMN "slug" TEXT;
UPDATE "app_question_set" SET "slug" = "id";
ALTER TABLE "app_question_set" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_discovery_question" ADD COLUMN "slug" TEXT;
UPDATE "app_discovery_question" SET "slug" = "id";
ALTER TABLE "app_discovery_question" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_resource_collection" ADD COLUMN "slug" TEXT;
UPDATE "app_resource_collection" SET "slug" = "id";
ALTER TABLE "app_resource_collection" ALTER COLUMN "slug" SET NOT NULL;

ALTER TABLE "app_resource" ADD COLUMN "slug" TEXT;
UPDATE "app_resource" SET "slug" = "id";
ALTER TABLE "app_resource" ALTER COLUMN "slug" SET NOT NULL;

-- 3. Generated ids. ON UPDATE CASCADE carries each into its children's FKs.
UPDATE "app_document_collection" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_foundational_document" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_journey" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_journey_tier" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_journey_module" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_question_set" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_discovery_question" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_resource_collection" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
UPDATE "app_resource" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');

-- 4. Resource words: keyed by `key`, so they gain an id and their revisions
-- a `wordsId`, backfilled from the key. The key was the primary key, so it
-- alone finds the parent; matching the org too could only drop a match.
ALTER TABLE "app_resource_words" ADD COLUMN "id" TEXT;
UPDATE "app_resource_words" SET "id" = 'c' || replace(gen_random_uuid()::text, '-', '');
ALTER TABLE "app_resource_words" ALTER COLUMN "id" SET NOT NULL;

ALTER TABLE "app_resource_words_revision" ADD COLUMN "wordsId" TEXT;
UPDATE "app_resource_words_revision" r
   SET "wordsId" = w."id"
  FROM "app_resource_words" w
 WHERE w."key" = r."wordsKey";
ALTER TABLE "app_resource_words_revision" ALTER COLUMN "wordsId" SET NOT NULL;

ALTER TABLE "app_resource_words_revision" DROP CONSTRAINT "app_resource_words_revision_wordsKey_fkey";
DROP INDEX "app_resource_words_revision_wordsKey_revision_key";
DROP INDEX "app_resource_words_revision_wordsKey_changedAt_idx";
ALTER TABLE "app_resource_words" DROP CONSTRAINT "app_resource_words_pkey";
ALTER TABLE "app_resource_words" ADD CONSTRAINT "app_resource_words_pkey" PRIMARY KEY ("id");
CREATE UNIQUE INDEX "app_resource_words_revision_wordsId_revision_key" ON "app_resource_words_revision"("wordsId", "revision");
CREATE INDEX "app_resource_words_revision_wordsId_changedAt_idx" ON "app_resource_words_revision"("wordsId", "changedAt");
ALTER TABLE "app_resource_words_revision" ADD CONSTRAINT "app_resource_words_revision_wordsId_fkey" FOREIGN KEY ("wordsId") REFERENCES "app_resource_words"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Authored names are unique per org
CREATE UNIQUE INDEX "app_document_collection_orgId_slug_key" ON "app_document_collection"("orgId", "slug");
CREATE UNIQUE INDEX "app_foundational_document_orgId_slug_key" ON "app_foundational_document"("orgId", "slug");
CREATE UNIQUE INDEX "app_journey_orgId_slug_key" ON "app_journey"("orgId", "slug");
CREATE UNIQUE INDEX "app_journey_tier_orgId_slug_key" ON "app_journey_tier"("orgId", "slug");
CREATE UNIQUE INDEX "app_journey_module_orgId_slug_key" ON "app_journey_module"("orgId", "slug");
CREATE UNIQUE INDEX "app_question_set_orgId_slug_key" ON "app_question_set"("orgId", "slug");
CREATE UNIQUE INDEX "app_discovery_question_orgId_slug_key" ON "app_discovery_question"("orgId", "slug");
CREATE UNIQUE INDEX "app_resource_collection_orgId_slug_key" ON "app_resource_collection"("orgId", "slug");
CREATE UNIQUE INDEX "app_resource_orgId_slug_key" ON "app_resource"("orgId", "slug");
CREATE UNIQUE INDEX "app_resource_words_orgId_key_key" ON "app_resource_words"("orgId", "key");
