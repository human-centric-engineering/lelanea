-- f-journey-record t-149 — the journey record joins the memory index. A kept
-- synopsis and an own entry the person has not kept from her are embedded, so
-- `search_person_memory` can find them by meaning, for that person only
-- (owner ruling 4 at planning: she reads kept synopses and own entries unless
-- an entry is kept from her, and never reads drafts).
--
-- TWO SOURCE KINDS, ONE COLUMN. `synopsis` and `own_entry` both point at
-- "journeyEntryId": the kind says what the hit is to the model (her account
-- the person kept, or their own words), the column says where it lives.
--
-- AN EMBEDDING GOES WITH ITS SOURCE (f-memory owner ruling 2). The foreign key
-- to "app_journey_entry" is ON DELETE CASCADE, so removing an entry, or the
-- person's erasure, takes its vector. Both tables are ours, so this one is
-- modelled in the schema and is not a drift probe. Editing an entry, keeping
-- it from her, or a draft being redrafted drops the vector in the write's own
-- transaction (`forgetJourneyEntry` in lib/app/memory/memory-index.ts).
--
-- THE CHECK IS REPLACED, not added to, as 20261009100100_app_memory_note_source
-- did: every row names exactly one source, the one its kind says. It compares
-- `"sourceKind"::text` because a value added by ALTER TYPE cannot be used as an
-- enum literal in the same transaction that adds it. Prisma cannot see the
-- CHECK; lib/app/leaf-db-drift.ts probes it.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 49 statements of which five are ours (the two enum values, the
-- column, its unique index and its foreign key). The other 44 are objects
-- Prisma cannot model: DROP CONSTRAINT for the hand-written FKs across all
-- three tiers, DROP INDEX for the HNSW and GIN indexes, and the `searchVector`
-- DROP DEFAULT.

-- AlterEnum
ALTER TYPE "app_memory_source_kind" ADD VALUE 'synopsis';
ALTER TYPE "app_memory_source_kind" ADD VALUE 'own_entry';

-- AlterTable
ALTER TABLE "app_memory_embedding" ADD COLUMN "journeyEntryId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "app_memory_embedding_journeyEntryId_key" ON "app_memory_embedding"("journeyEntryId");

-- AddForeignKey
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_journeyEntryId_fkey"
    FOREIGN KEY ("journeyEntryId") REFERENCES "app_journey_entry"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Every source kind names its own source, and only that one.
ALTER TABLE "app_memory_embedding" DROP CONSTRAINT "app_memory_embedding_source_check";
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_source_check"
    CHECK (
      ("sourceKind"::text = 'message'
        AND "messageId" IS NOT NULL AND "slotValueId" IS NULL AND "journeyEntryId" IS NULL)
      OR ("sourceKind"::text = 'note'
        AND "slotValueId" IS NOT NULL AND "messageId" IS NULL AND "journeyEntryId" IS NULL)
      OR ("sourceKind"::text IN ('synopsis', 'own_entry')
        AND "journeyEntryId" IS NOT NULL AND "messageId" IS NULL AND "slotValueId" IS NULL)
    );
