-- §05 t-25 — AppKnowledgeDesignation: the part of a document's designation that
-- cannot be a tag.
--
-- Purpose (`knowledge` | `voice` | `both`) and sensitivity (`public` | `private`
-- | `client`) are managed `knowledge_tag` rows, seeded by
-- prisma/seeds/app-lelanea/002-knowledge-designation.ts. This table holds the
-- third designation — the free-text licensing / permission note — because
-- `knowledge_tag` has no per-document value column, and because
-- `ai_knowledge_document.metadata` is REPLACED wholesale by
-- lib/orchestration/knowledge/document-manager.ts on ingest, retry and re-chunk:
-- a note stored there would vanish the first time a document was re-processed.
--
-- ERASURE DISPOSITION (GDPR Art. 17). None needed: every column is about a FILE,
-- not about a person. `designatedBy` holds the admin's id who last set it and is
-- deliberately NOT a foreign key to `user` — the note outlives the admin account,
-- and an FK here would either make `eraseUser()` fail with `P2003` or silently
-- rewrite the record of who designated what. Declared as an EXCLUSION, with that
-- reason, in lib/app/leaf-data-export.ts, which is what a data subject is shown.
--
-- `documentId` is the PRIMARY KEY, not a separate id: one designation per
-- document, so a re-designation is an UPDATE rather than a second row.
--
-- The FK to `ai_knowledge_document` is HAND-WRITTEN below, because a fork table
-- must not add a reverse relation field to a Sunrise-owned model
-- (CUSTOMIZATION.md §5) and `AiKnowledgeDocument` lives in
-- prisma/schema/orchestration-knowledge.prisma. `ON DELETE CASCADE`: the note is
-- about the document and means nothing without it. Note the reference names the
-- MAPPED TABLE `ai_knowledge_document`, not the model name (`B11`).
--
-- Prisma cannot see this constraint (it computes desired state from a schema
-- with no `@relation` for it), so a future `migrate dev` will emit a DROP for it.
-- lib/app/leaf-db-drift.ts registers a probe that pins both its existence and its
-- `ON DELETE` action; `npm run db:drift-check` fails if either moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose, and the development command reads that
-- divergence as drift and "corrects" it.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). `prisma migrate dev
-- --create-only` emits DROP CONSTRAINT for this fork's two existing hand-written
-- FKs (`app_waitlist_entry_userId_fkey`, `app_acknowledgement_userId_fkey`) and
-- for the framework's FKs to `user`, `ai_agent`, `ai_knowledge_document`,
-- `ai_knowledge_tag`, `ai_workflow` and `ai_message`; DROP INDEX for the pgvector
-- HNSW indexes and the tsvector GIN index; and the `searchVector` DROP DEFAULT.
-- Every one of them an object Prisma cannot model. Everything below this line is
-- the table this migration is for.

-- CreateTable
CREATE TABLE "app_knowledge_designation" (
    "documentId" TEXT NOT NULL,
    "licensing" TEXT,
    "designatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_knowledge_designation_pkey" PRIMARY KEY ("documentId")
);

-- AddForeignKey — hand-written; the core `AiKnowledgeDocument` model maps to
-- table "ai_knowledge_document".
ALTER TABLE "app_knowledge_designation"
    ADD CONSTRAINT "app_knowledge_designation_documentId_fkey"
    FOREIGN KEY ("documentId") REFERENCES "ai_knowledge_document"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
