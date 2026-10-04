-- f-memory t-107 — notes join the memory index as a second source kind. The
-- head version of each of a person's notes is embedded, so it can be found by
-- meaning in that person's conversations only, like what they said (t-129).
--
-- AN EMBEDDING GOES WITH ITS SOURCE (owner ruling 2). One more hand-written
-- foreign key, ON DELETE CASCADE:
--   - "slotValueId" → "framework_slot_value": a version deleted outright (the
--     person's erasure cascades to their slot values) takes its vector.
--     HAND-WRITTEN, against the MAPPED table `framework_slot_value` (`B11`):
--     a fork table must not add a reverse field to Daybreak's `SlotValue`.
-- Removing a note and deleting an exchange rewrite versions IN PLACE rather
-- than deleting them, so no cascade fires for those. Each drops the vectors of
-- the versions it wipes in its own transaction (`forgetWipedNotes` in
-- lib/app/memory/memory-index.ts), and a search reads only live heads.
--
-- THE CHECK IS REPLACED, not added to: every row names exactly one source, the
-- one its kind says. It compares `"sourceKind"::text`, not the enum, because a
-- value added by ALTER TYPE cannot be used as an enum literal in the same
-- transaction that adds it.
--
-- Prisma cannot see the new FK or the CHECK, so a future `migrate dev` will
-- emit DROPs for them. lib/app/leaf-db-drift.ts registers a probe for each;
-- `npm run db:drift-check` fails if one moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 43 statements of which three are ours (the enum value, the
-- column and its unique index). The other 40 are objects Prisma cannot model,
-- the kinds 20261008100000_app_memory_embedding lists: DROP CONSTRAINT for the
-- hand-written FKs (this fork's, t-129's among them, and the framework's), DROP
-- INDEX for the HNSW and GIN indexes, and the `searchVector` DROP DEFAULT.

-- AlterEnum
ALTER TYPE "app_memory_source_kind" ADD VALUE 'note';

-- AlterTable
ALTER TABLE "app_memory_embedding" ADD COLUMN "slotValueId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "app_memory_embedding_slotValueId_key" ON "app_memory_embedding"("slotValueId");

-- AddForeignKey — hand-written; Daybreak's `SlotValue` model maps to "framework_slot_value".
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_slotValueId_fkey"
    FOREIGN KEY ("slotValueId") REFERENCES "framework_slot_value"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Every source kind names its own source, and only that one.
ALTER TABLE "app_memory_embedding" DROP CONSTRAINT "app_memory_embedding_source_check";
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_source_check"
    CHECK (
      ("sourceKind"::text = 'message' AND "messageId" IS NOT NULL AND "slotValueId" IS NULL)
      OR ("sourceKind"::text = 'note' AND "slotValueId" IS NOT NULL AND "messageId" IS NULL)
    );
