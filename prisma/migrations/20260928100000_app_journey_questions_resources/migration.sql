-- f-content-seeds t-87: the journey's text, the discovery questions and the
-- resource library move into the database.
-- `content/lelanea_module_structure.json`,
-- `content/onboarding_discovery_questions.json` and
-- `seed-data/drafted/lelanea_resources.json` become seed material and are no
-- longer read at request time.
--
-- Fourteen tables, in three groups, each on the pattern t-86 set for her
-- documents (`20260927100000_app_foundational_documents`): one row per thing a
-- surface shows, a full snapshot per revision from the first write.
--
-- - `app_journey`, `app_journey_tier`, `app_journey_module`, and a revision table
--   for tiers and for modules. These hold the journey's TEXT. Its structure
--   (which modules, their number, their tier) is the code roster in
--   `lib/app/journey/roster.ts`; see `AppJourney` in `prisma/schema/app.prisma`.
-- - `app_question_set`, `app_discovery_question`, and a revision table for each.
-- - `app_resource_collection`, `app_resource` (films and readings, one id
--   namespace), `app_resource_words`, and a revision table for resources and
--   for words.
--
-- These tables are EMPTY after this migration. The next one,
-- `20260928100100_app_journey_questions_resources_data`, fills them in every
-- environment, because production does not run the seeder on deploy.
--
-- ERASURE DISPOSITION (GDPR Art. 17). Each of the six revision tables has an
-- `editorId` that is a plain scalar with no Prisma `@relation`, because a fork
-- table must not add a reverse field to the Sunrise-owned `User` model
-- (CUSTOMIZATION.md §5). So each FK is HAND-WRITTEN at the bottom, against the
-- MAPPED table `user` (`B11`), with `ON DELETE SET NULL`: erasing an admin
-- removes who made an edit, never the record that the words changed.
-- `lib/app/leaf-db-drift.ts` pins all six, because Prisma cannot see them and a
-- future `migrate dev` would emit a DROP for each.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev`: the schema and the
-- database diverge here on purpose.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). This was generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`, which
-- also emitted 28 statements that are not ours to run: 23 DROP CONSTRAINTs for
-- hand-written FKs (this fork's and the framework's), four DROP INDEXes for the
-- pgvector HNSW and tsvector GIN indexes, and the `searchVector` DROP DEFAULT.
-- Prisma cannot model any of those objects. What remains below creates only this
-- migration's fourteen tables.

-- CreateTable
CREATE TABLE "app_journey" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_journey_tier" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_journey_tier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_journey_tier_revision" (
    "id" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_journey_tier_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_journey_module" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "chartTitle" TEXT,
    "phases" JSONB NOT NULL,
    "phaseTiers" JSONB,
    "produces" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_journey_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_journey_module_revision" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "displayNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "chartTitle" TEXT,
    "phases" JSONB NOT NULL,
    "phaseTiers" JSONB,
    "produces" JSONB,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_journey_module_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_question_set" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "chartTitle" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "preamble" JSONB NOT NULL,
    "pacing" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_question_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_question_set_revision" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "chartTitle" TEXT NOT NULL,
    "phase" INTEGER NOT NULL,
    "preamble" JSONB NOT NULL,
    "pacing" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_question_set_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_discovery_question" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "hint" TEXT,
    "conditionalFollowUp" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_discovery_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_discovery_question_revision" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "inputType" TEXT NOT NULL,
    "hint" TEXT,
    "conditionalFollowUp" JSONB,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_discovery_question_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_resource_collection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_resource_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_resource" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "relatesTo" TEXT,
    "duration" TEXT,
    "readingTime" TEXT,
    "href" TEXT,
    "documentId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_resource_revision" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "relatesTo" TEXT,
    "duration" TEXT,
    "readingTime" TEXT,
    "href" TEXT,
    "documentId" TEXT,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_resource_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_resource_words" (
    "key" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "paragraphs" TEXT[],
    "sourceCollection" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_resource_words_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "app_resource_words_revision" (
    "id" TEXT NOT NULL,
    "wordsKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "quote" TEXT NOT NULL,
    "paragraphs" TEXT[],
    "sourceCollection" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_resource_words_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_journey_tier_revision_tierId_changedAt_idx" ON "app_journey_tier_revision"("tierId", "changedAt");

-- CreateIndex
CREATE INDEX "app_journey_tier_revision_editorId_idx" ON "app_journey_tier_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_journey_tier_revision_tierId_revision_key" ON "app_journey_tier_revision"("tierId", "revision");

-- CreateIndex
CREATE INDEX "app_journey_module_revision_moduleId_changedAt_idx" ON "app_journey_module_revision"("moduleId", "changedAt");

-- CreateIndex
CREATE INDEX "app_journey_module_revision_editorId_idx" ON "app_journey_module_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_journey_module_revision_moduleId_revision_key" ON "app_journey_module_revision"("moduleId", "revision");

-- CreateIndex
CREATE INDEX "app_question_set_revision_setId_changedAt_idx" ON "app_question_set_revision"("setId", "changedAt");

-- CreateIndex
CREATE INDEX "app_question_set_revision_editorId_idx" ON "app_question_set_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_question_set_revision_setId_revision_key" ON "app_question_set_revision"("setId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "app_discovery_question_setId_number_key" ON "app_discovery_question"("setId", "number");

-- CreateIndex
CREATE INDEX "app_discovery_question_revision_questionId_changedAt_idx" ON "app_discovery_question_revision"("questionId", "changedAt");

-- CreateIndex
CREATE INDEX "app_discovery_question_revision_editorId_idx" ON "app_discovery_question_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_discovery_question_revision_questionId_revision_key" ON "app_discovery_question_revision"("questionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "app_resource_collectionId_kind_position_key" ON "app_resource"("collectionId", "kind", "position");

-- CreateIndex
CREATE INDEX "app_resource_revision_resourceId_changedAt_idx" ON "app_resource_revision"("resourceId", "changedAt");

-- CreateIndex
CREATE INDEX "app_resource_revision_editorId_idx" ON "app_resource_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_resource_revision_resourceId_revision_key" ON "app_resource_revision"("resourceId", "revision");

-- CreateIndex
CREATE INDEX "app_resource_words_revision_wordsKey_changedAt_idx" ON "app_resource_words_revision"("wordsKey", "changedAt");

-- CreateIndex
CREATE INDEX "app_resource_words_revision_editorId_idx" ON "app_resource_words_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_resource_words_revision_wordsKey_revision_key" ON "app_resource_words_revision"("wordsKey", "revision");

-- AddForeignKey
ALTER TABLE "app_journey_tier" ADD CONSTRAINT "app_journey_tier_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "app_journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_journey_tier_revision" ADD CONSTRAINT "app_journey_tier_revision_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "app_journey_tier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_journey_module" ADD CONSTRAINT "app_journey_module_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "app_journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_journey_module_revision" ADD CONSTRAINT "app_journey_module_revision_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "app_journey_module"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_question_set" ADD CONSTRAINT "app_question_set_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "app_journey_module"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_question_set_revision" ADD CONSTRAINT "app_question_set_revision_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app_question_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_discovery_question" ADD CONSTRAINT "app_discovery_question_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app_question_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_discovery_question_revision" ADD CONSTRAINT "app_discovery_question_revision_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "app_discovery_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource" ADD CONSTRAINT "app_resource_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "app_resource_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource" ADD CONSTRAINT "app_resource_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "app_foundational_document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource_revision" ADD CONSTRAINT "app_resource_revision_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "app_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource_words" ADD CONSTRAINT "app_resource_words_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "app_resource_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_resource_words_revision" ADD CONSTRAINT "app_resource_words_revision_wordsKey_fkey" FOREIGN KEY ("wordsKey") REFERENCES "app_resource_words"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN — see the header. Mapped table `user`, not `User`.)
ALTER TABLE "app_journey_tier_revision" ADD CONSTRAINT "app_journey_tier_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN)
ALTER TABLE "app_journey_module_revision" ADD CONSTRAINT "app_journey_module_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN)
ALTER TABLE "app_question_set_revision" ADD CONSTRAINT "app_question_set_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN)
ALTER TABLE "app_discovery_question_revision" ADD CONSTRAINT "app_discovery_question_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN)
ALTER TABLE "app_resource_revision" ADD CONSTRAINT "app_resource_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN)
ALTER TABLE "app_resource_words_revision" ADD CONSTRAINT "app_resource_words_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
