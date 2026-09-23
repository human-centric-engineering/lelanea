-- f-content-seeds t-88: the context-selected voice overlays move into the
-- database. `seed-data/drafted/lelanea_voice_overlays.json` becomes seed
-- material and is no longer read at request time.
--
-- Four tables, on the pattern t-86 and t-87 set (`20260927100000_app_
-- foundational_documents`, `20260928100000_app_journey_questions_resources`):
-- one row per thing a surface shows, a full snapshot per revision from the
-- first write.
--
-- - `app_voice_overlay_set` — the layer's identity, its authored `provenance`,
--   and the two blocks that belong to no single situation: `coreOnly` (the body
--   used when no overlay matched) and `exemplars` (the copy that labels a
--   retrieved passage as hers). Its `originLabel` is load-bearing: it is what
--   tells the model her writing from the person's.
-- - `app_voice_overlay` — one row per situation, keyed BY the situation,
--   because that key is also the `contextId` a chat request carries. There is
--   no second identifier to keep in step with it.
-- - a revision table for each.
--
-- `app_voice_content_status` is a separate enum from `app_crisis_content_status`
-- on purpose: the crisis copy and her register are different material, signed
-- off by different people at different moments.
--
-- These tables are EMPTY after this migration. The next one,
-- `20260929100100_app_voice_overlays_data`, fills them in every environment,
-- because production does not run the seeder on deploy.
--
-- ERASURE DISPOSITION (GDPR Art. 17). Both revision tables have an `editorId`
-- that is a plain scalar with no Prisma `@relation`, because a fork table must
-- not add a reverse field to the Sunrise-owned `User` model (CUSTOMIZATION.md
-- §5). So each FK is HAND-WRITTEN at the bottom, against the MAPPED table
-- `user` (`B11`), with `ON DELETE SET NULL`: erasing an admin removes who made
-- an edit, never the record that the words changed. `lib/app/leaf-db-drift.ts`
-- pins both, because Prisma cannot see them and a future `migrate dev` would
-- emit a DROP for each.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev`: the schema and the
-- database diverge here on purpose.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which also emitted 34 statements that are not ours to run: 29 DROP
-- CONSTRAINTs for hand-written FKs (this fork's and the framework's), four DROP
-- INDEXes for the pgvector HNSW and tsvector GIN indexes, and the
-- `searchVector` DROP DEFAULT. Prisma cannot model any of those objects. What
-- remains below creates only this migration's four tables and one enum.

-- CreateEnum
CREATE TYPE "app_voice_content_status" AS ENUM ('draft', 'signed_off');

-- CreateTable
CREATE TABLE "app_voice_overlay_set" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "exemplars" JSONB NOT NULL,
    "coreOnly" JSONB NOT NULL,
    "status" "app_voice_content_status" NOT NULL DEFAULT 'draft',
    "signedOffAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_voice_overlay_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_voice_overlay_set_revision" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "exemplars" JSONB NOT NULL,
    "coreOnly" JSONB NOT NULL,
    "status" "app_voice_content_status" NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_voice_overlay_set_revision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_voice_overlay" (
    "situation" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "reviewerNote" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "lines" TEXT[],
    "exemplarQuery" TEXT NOT NULL,
    "status" "app_voice_content_status" NOT NULL DEFAULT 'draft',
    "signedOffAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_voice_overlay_pkey" PRIMARY KEY ("situation")
);

-- CreateTable
CREATE TABLE "app_voice_overlay_revision" (
    "id" TEXT NOT NULL,
    "situation" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "reviewerNote" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "lines" TEXT[],
    "exemplarQuery" TEXT NOT NULL,
    "status" "app_voice_content_status" NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_voice_overlay_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_voice_overlay_set_revision_setId_changedAt_idx" ON "app_voice_overlay_set_revision"("setId", "changedAt");

-- CreateIndex
CREATE INDEX "app_voice_overlay_set_revision_editorId_idx" ON "app_voice_overlay_set_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_voice_overlay_set_revision_setId_revision_key" ON "app_voice_overlay_set_revision"("setId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "app_voice_overlay_setId_position_key" ON "app_voice_overlay"("setId", "position");

-- CreateIndex
CREATE INDEX "app_voice_overlay_revision_situation_changedAt_idx" ON "app_voice_overlay_revision"("situation", "changedAt");

-- CreateIndex
CREATE INDEX "app_voice_overlay_revision_editorId_idx" ON "app_voice_overlay_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_voice_overlay_revision_situation_revision_key" ON "app_voice_overlay_revision"("situation", "revision");

-- AddForeignKey
ALTER TABLE "app_voice_overlay_set_revision" ADD CONSTRAINT "app_voice_overlay_set_revision_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app_voice_overlay_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_voice_overlay" ADD CONSTRAINT "app_voice_overlay_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app_voice_overlay_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_voice_overlay_revision" ADD CONSTRAINT "app_voice_overlay_revision_situation_fkey" FOREIGN KEY ("situation") REFERENCES "app_voice_overlay"("situation") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
-- Hand-written: `editorId` has no Prisma relation (see the header). ON DELETE
-- SET NULL, so erasing an admin keeps the record of what the words said.
ALTER TABLE "app_voice_overlay_set_revision" ADD CONSTRAINT "app_voice_overlay_set_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_voice_overlay_revision" ADD CONSTRAINT "app_voice_overlay_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
