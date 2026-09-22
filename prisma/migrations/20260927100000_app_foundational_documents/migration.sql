-- f-content-seeds t-86: her seven foundational documents move into the database.
-- `content/lelanea_foundational_documents.json` becomes seed material and is no
-- longer read at request time.
--
-- `app_document_collection` holds the collection's identity, version and locale.
-- `app_foundational_document` holds each document as currently served, with its
-- blocks as JSONB. `app_foundational_document_revision` holds one full snapshot
-- per revision, starting with the seed's own. The models' docblocks in
-- `prisma/schema/app.prisma` give the reasoning, and `.context/app/content.md`
-- describes the pipeline.
--
-- These tables are EMPTY after this migration. `prisma/seeds/app-lelanea/015-
-- foundational-documents.ts` fills them once. Until it has run, the pages that
-- read them fail loudly instead of rendering nothing, which is the same contract
-- the file loader had.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `app_foundational_document_revision.editorId`
-- is a plain scalar with no Prisma `@relation`, because a fork table must not add
-- a reverse field to the Sunrise-owned `User` model (CUSTOMIZATION.md §5). So the
-- FK is HAND-WRITTEN at the bottom, against the MAPPED table `user` (`B11`), with
-- `ON DELETE SET NULL`: erasing an admin removes who made an edit, never the
-- record that the words changed. `lib/app/leaf-db-drift.ts` pins it, because
-- Prisma cannot see it and a future `migrate dev` would emit a DROP for it.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev`: the schema and the
-- database diverge here on purpose.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). This was generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`, which
-- also emitted 27 statements that are not ours to run: 22 DROP CONSTRAINTs for
-- hand-written FKs (this fork's and the framework's), four DROP INDEXes for the
-- pgvector HNSW and tsvector GIN indexes, and the `searchVector` DROP DEFAULT.
-- Prisma cannot model any of those objects. What remains below creates only this
-- migration's three tables.

-- CreateEnum
CREATE TYPE "app_content_revision_origin" AS ENUM ('seed', 'admin');

-- CreateTable
CREATE TABLE "app_document_collection" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_document_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_foundational_document" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "category" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "requiresAcknowledgement" BOOLEAN NOT NULL DEFAULT false,
    "placeholders" TEXT[],
    "renderStyle" TEXT,
    "renderNote" TEXT,
    "blocks" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_foundational_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_foundational_document_revision" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "category" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "requiresAcknowledgement" BOOLEAN NOT NULL,
    "placeholders" TEXT[],
    "renderStyle" TEXT,
    "renderNote" TEXT,
    "blocks" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_foundational_document_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_foundational_document_collectionId_position_key" ON "app_foundational_document"("collectionId", "position");

-- CreateIndex
CREATE INDEX "app_foundational_document_revision_documentId_changedAt_idx" ON "app_foundational_document_revision"("documentId", "changedAt");

-- CreateIndex
CREATE INDEX "app_foundational_document_revision_editorId_idx" ON "app_foundational_document_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_foundational_document_revision_documentId_revision_key" ON "app_foundational_document_revision"("documentId", "revision");

-- AddForeignKey
ALTER TABLE "app_foundational_document" ADD CONSTRAINT "app_foundational_document_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "app_document_collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_foundational_document_revision" ADD CONSTRAINT "app_foundational_document_revision_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "app_foundational_document"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey (HAND-WRITTEN — see the header. Mapped table `user`, not `User`.)
ALTER TABLE "app_foundational_document_revision" ADD CONSTRAINT "app_foundational_document_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
