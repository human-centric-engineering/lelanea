-- §06 t-15 — AppAcknowledgement: what a person acknowledged, which version, and when.
--
-- The ledger the gate in front of the shell reads. A row is one acknowledgement
-- of one kind (`disclaimer`, `terms`, `age_18`) against one version; a kind is
-- satisfied only by a row carrying the CURRENT version, so a change to either
-- document re-gates and the old row stays as the record. Insert-only.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `userId` is a plain scalar with no Prisma
-- `@relation`, because a fork table must not add a reverse field to the
-- Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the FK is HAND-WRITTEN
-- below, with `ON DELETE CASCADE`: an acknowledgement is personal data about
-- the account and nothing else, so it goes when the account goes. Unlike
-- `app_waitlist_entry` there is no email on the row and no pre-signup path, so
-- the cascade is the whole policy and no erasure hook is needed. The Art. 15
-- export returns the rows in full (`lib/app/leaf-data-export.ts`).
--
-- Prisma cannot see this constraint (it computes desired state from a schema
-- with no `@relation` for it), so a future `migrate dev` will emit a DROP for
-- it. `lib/app/leaf-db-drift.ts` registers a probe that pins both its existence
-- and its `ON DELETE` action; `npm run db:drift-check` fails if either moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and
-- the database diverge here on purpose, and the development command reads that
-- divergence as drift and "corrects" it.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (B13). `prisma migrate dev
-- --create-only` emitted 20 statements that are not ours: DROP CONSTRAINT for
-- the waitlist's own hand-written FK and fourteen framework FKs to `user`,
-- `ai_agent`, `ai_knowledge_document`, `ai_knowledge_tag`, `ai_workflow` and
-- `ai_message`; DROP INDEX for the three pgvector HNSW indexes and the tsvector
-- GIN index; and the `searchVector` DROP DEFAULT. Same list as the waitlist
-- migration plus our own earlier FK — every one of them an object Prisma cannot
-- model. Everything below this line is the table this migration is for.

-- CreateEnum
CREATE TYPE "app_acknowledgement_kind" AS ENUM ('disclaimer', 'terms', 'age_18');

-- CreateTable
CREATE TABLE "app_acknowledgement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "app_acknowledgement_kind" NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_acknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_acknowledgement_userId_idx" ON "app_acknowledgement"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "app_acknowledgement_userId_kind_documentVersion_key" ON "app_acknowledgement"("userId", "kind", "documentVersion");

-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_acknowledgement"
    ADD CONSTRAINT "app_acknowledgement_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
