-- f-slots t-70 — the authored slot taxonomy: what the app aims to learn about a
-- person (product description §5), held as data with every revision kept.
--
-- `app_slot_definition` is the current wording of each global slot;
-- `app_slot_definition_revision` is one full snapshot per version. The snapshot
-- is what makes "what did this slot mean when that answer was given?" a read at
-- a timestamp rather than a replay of diffs. See the models' docblocks in
-- `prisma/schema/app.prisma` and `.context/app/slots.md`.
--
-- `slug` is the PRIMARY KEY of the definition table and is immutable: it is what
-- a captured `framework_slot_value.slotSlug` points at, so a rename would orphan
-- every answer already given under it. A rename is an add plus a retire, which
-- is what `isActive` is for.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `app_slot_definition_revision.editorId` is
-- a plain scalar with no Prisma `@relation`, because a fork table must not add a
-- reverse field to the Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the
-- FK is HAND-WRITTEN at the bottom, against the MAPPED table `user` (`B11`),
-- with `ON DELETE SET NULL`.
--
-- `SET NULL`, not `CASCADE`, and the distinction is the whole point of the
-- table: the history is about the TAXONOMY, not about the editor. Erasing an
-- admin's account must remove their identity from this record; it must not
-- remove the record that the wording changed on a given date, because every
-- value captured after that date is read against it. Under `CASCADE`, erasing
-- one admin would silently delete the wording history that other people's
-- answers resolve through. `origin` survives the null, so a row left by an
-- erased admin still reads as an admin edit rather than as the seed.
--
-- Prisma cannot see that constraint, so a future `migrate dev` will emit a DROP
-- for it. `lib/app/leaf-db-drift.ts` registers a probe pinning both its
-- existence and its `ON DELETE` action; `npm run db:drift-check` fails if either
-- moves.
--
-- The sibling FK — `app_slot_definition_revision_slotSlug_fkey` — is NOT probed,
-- and that is not an omission: both of its tables are ours and the relation is
-- in the schema, so Prisma owns it and will not drop it.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 26 statements that are not ours: DROP CONSTRAINT for this fork's
-- seven existing hand-written FKs and fourteen framework FKs, DROP INDEX for the
-- three pgvector HNSW indexes and the tsvector GIN index, and the `searchVector`
-- DROP DEFAULT. Every one of them an object Prisma cannot model. Everything
-- below this line is the two tables this migration is for.

-- CreateEnum
CREATE TYPE "app_slot_revision_origin" AS ENUM ('seed', 'admin');

-- CreateTable
CREATE TABLE "app_slot_definition" (
    "slug" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'open',
    "mode" TEXT NOT NULL DEFAULT 'targeted',
    "dataType" TEXT NOT NULL DEFAULT 'text',
    "sensitivity" TEXT NOT NULL DEFAULT 'standard',
    "priorityWeight" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_slot_definition_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "app_slot_definition_revision" (
    "id" TEXT NOT NULL,
    "slotSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "group" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "sensitivity" TEXT NOT NULL,
    "priorityWeight" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_slot_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_slot_definition_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_slot_definition_isActive_group_idx" ON "app_slot_definition"("isActive", "group");

-- CreateIndex
CREATE INDEX "app_slot_definition_revision_slotSlug_changedAt_idx" ON "app_slot_definition_revision"("slotSlug", "changedAt");

-- CreateIndex
CREATE INDEX "app_slot_definition_revision_editorId_idx" ON "app_slot_definition_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_slot_definition_revision_slotSlug_version_key" ON "app_slot_definition_revision"("slotSlug", "version");

-- AddForeignKey
ALTER TABLE "app_slot_definition_revision" ADD CONSTRAINT "app_slot_definition_revision_slotSlug_fkey" FOREIGN KEY ("slotSlug") REFERENCES "app_slot_definition"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (HAND-WRITTEN — see the header. Mapped table `user`, not `User`.)
ALTER TABLE "app_slot_definition_revision" ADD CONSTRAINT "app_slot_definition_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
