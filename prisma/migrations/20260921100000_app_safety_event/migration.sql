-- f-safety t-58 — AppSafetyEvent: that a crisis was detected, and what the app
-- did about it. Never the words: see the model's docblock.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `app_safety_event.userId` is a plain
-- scalar with no Prisma `@relation`, because a fork table must not add a
-- reverse field to the Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the
-- FK is HAND-WRITTEN below, against the MAPPED table `user` (`B11`), with
-- `ON DELETE CASCADE`: an event is about the person it happened to and goes
-- with the account. The column is NULLABLE so the pre-signup conversation can
-- write the same record; a null row belongs to nobody and is never exported.
-- The Art. 15 export returns it (lib/app/leaf-data-export.ts).
--
-- Prisma cannot see that constraint, so a future `migrate dev` will emit a DROP
-- for it. lib/app/leaf-db-drift.ts registers a probe that pins both its
-- existence and its `ON DELETE` action; `npm run db:drift-check` fails if either
-- moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 25 statements that are not ours: DROP CONSTRAINT for this
-- fork's six existing hand-written FKs and fourteen framework FKs, DROP INDEX
-- for the three pgvector HNSW indexes and the tsvector GIN index, and the
-- `searchVector` DROP DEFAULT. Every one of them an object Prisma cannot model.
-- Everything below this line is the one table this migration is for.

-- CreateEnum
CREATE TYPE "app_safety_event_kind" AS ENUM ('crisis');

-- CreateEnum
CREATE TYPE "app_crisis_tier" AS ENUM ('soft', 'hard');

-- CreateEnum
CREATE TYPE "app_context_check_outcome" AS ENUM ('not_run', 'confirmed', 'softened', 'error', 'timeout', 'unavailable');

-- CreateTable
CREATE TABLE "app_safety_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" "app_safety_event_kind" NOT NULL,
    "seat" TEXT NOT NULL,
    "detectedTier" "app_crisis_tier",
    "actedTier" "app_crisis_tier",
    "categories" TEXT[],
    "contextCheck" "app_context_check_outcome",
    "locale" TEXT,
    "resourceRegion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_safety_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_safety_event_userId_createdAt_idx" ON "app_safety_event"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "app_safety_event_createdAt_idx" ON "app_safety_event"("createdAt");


-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_safety_event"
    ADD CONSTRAINT "app_safety_event_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
