-- §03 t-7 — AppWaitlistEntry: the public waitlist, and what someone said while joining it.
--
-- The first `app_*` table in this leaf. Scoped to `app_*` only; everything the
-- generator emitted outside that prefix was stripped — see the note below.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `userId` is a plain scalar with no Prisma
-- `@relation`, because a fork table must not add a reverse field to the
-- Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the FK is HAND-WRITTEN
-- below, with `ON DELETE SET NULL`: an entry is a record of who asked to be
-- told, and it outlives the account rather than cascading with it.
--
-- `SET NULL` alone would retain the person's email, name and answers on a row
-- nothing points at any more, so it is NOT the whole policy: the erasure hook
-- registered from `lib/app/leaf-bootstrap.ts` DELETES the matching row inside
-- the erasure transaction, matching on both `userId` and the subject's email.
-- The FK action is the backstop for a row the hook cannot match.
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
-- --create-only` diffs the schema against a shadow database and silently emits
-- drops for every object the schema cannot model. Here that was 21 statements,
-- none of them ours: DROP CONSTRAINT for all fifteen hand-written framework FKs
-- to `user`, `ai_agent`, `ai_knowledge_document`, `ai_knowledge_tag`,
-- `ai_workflow` and `ai_message`; DROP INDEX for `idx_knowledge_embedding`,
-- `idx_message_embedding` and `idx_framework_node_embedding` (pgvector HNSW)
-- and `idx_ai_knowledge_chunk_search_vector` (tsvector GIN); and
-- `ALTER TABLE "ai_knowledge_chunk" ALTER COLUMN "searchVector" DROP DEFAULT`,
-- which would have disarmed the generated search column. Applying any of them
-- would have taken out framework erasure and every vector search in the
-- product. Everything below this line is the table this migration is for.

-- CreateEnum
CREATE TYPE "app_waitlist_source" AS ENUM ('form', 'conversation');

-- CreateTable
CREATE TABLE "app_waitlist_entry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "heardFrom" TEXT,
    "intent" TEXT,
    "source" "app_waitlist_source" NOT NULL DEFAULT 'form',
    "locale" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_waitlist_entry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_waitlist_entry_email_key" ON "app_waitlist_entry"("email");

-- CreateIndex
CREATE INDEX "app_waitlist_entry_userId_idx" ON "app_waitlist_entry"("userId");

-- CreateIndex
CREATE INDEX "app_waitlist_entry_createdAt_idx" ON "app_waitlist_entry"("createdAt");

-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_waitlist_entry"
    ADD CONSTRAINT "app_waitlist_entry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
