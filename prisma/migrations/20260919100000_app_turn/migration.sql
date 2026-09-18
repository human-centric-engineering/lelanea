-- §08 t-54 — AppTurn: every turn with her has an id, knows whose it is and
-- which seat, and records what produced it.
--
-- The claim on a turn id is the `@@unique([userId, turnId])` index: a second
-- request with the same id from the same person meets the existing row instead
-- of calling the model again. Scoped per person, never globally, so one
-- person's id can neither collide with nor reveal another's. What each status
-- lets a repeat do is lib/app/agent/turns.ts.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `app_turn.userId` is a plain scalar with
-- no Prisma `@relation`, because a fork table must not add a reverse field to
-- the Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the FK is
-- HAND-WRITTEN below, against the MAPPED table `user` (`B11`), with
-- `ON DELETE CASCADE`: a turn is about the person who took it and goes with the
-- account. The Art. 15 export returns it (lib/app/leaf-data-export.ts). The
-- message ids are deliberately NOT foreign keys — see the model's docblock.
--
-- Prisma cannot see that constraint, so a future `migrate dev` will emit a DROP
-- for it. lib/app/leaf-db-drift.ts registers a probe that pins both its
-- existence and its `ON DELETE` action; `npm run db:drift-check` fails if either
-- moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose, and the development command reads that
-- divergence as drift and "corrects" it.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 24 statements that are not ours: DROP CONSTRAINT for this
-- fork's five existing hand-written FKs and fourteen framework FKs, DROP INDEX
-- for the three pgvector HNSW indexes and the tsvector GIN index, and the
-- `searchVector` DROP DEFAULT. Every one of them an object Prisma cannot model.
-- Everything below this line is the one table this migration is for.

-- CreateEnum
CREATE TYPE "app_turn_status" AS ENUM ('running', 'completed', 'failed');

-- CreateEnum
CREATE TYPE "app_turn_pricing" AS ENUM ('priced', 'unpriced', 'local');

-- CreateTable
CREATE TABLE "app_turn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "clientSupplied" BOOLEAN NOT NULL,
    "requestHash" TEXT NOT NULL,
    "seat" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "status" "app_turn_status" NOT NULL DEFAULT 'running',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "fingerprintVersion" TEXT,
    "conversationId" TEXT,
    "userMessageId" TEXT,
    "assistantMessageId" TEXT,
    "model" TEXT,
    "provider" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "costUsd" DOUBLE PRECISION,
    "pricing" "app_turn_pricing",
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "app_turn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_turn_userId_startedAt_idx" ON "app_turn"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "app_turn_conversationId_idx" ON "app_turn"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "app_turn_userId_turnId_key" ON "app_turn"("userId", "turnId");


-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_turn"
    ADD CONSTRAINT "app_turn_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
