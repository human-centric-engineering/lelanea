-- f-content-seeds t-90: which app row a mirrored knowledge document came from.
--
-- The knowledge mirror (`lib/app/content/knowledge-mirror.ts`) puts her words
-- about the work into the knowledge base, so the agent can recall them by
-- meaning. Each mirrored document needs a stable key back to the row it mirrors,
-- so that an edit re-ingests the same document and a removed row deletes it.
--
-- WHY HERE AND NOT IN `ai_knowledge_document.metadata`. The platform's ingestion
-- REPLACES that column on upload and re-chunk, so a key stored there would be
-- lost the first time the document was re-processed. This table is ours and
-- outside every platform write path, which is also why the licensing note lives
-- here.
--
-- Null on every existing row: nothing has been mirrored yet, and a document an
-- admin uploaded never carries a key. No data to move.
--
-- APPLY WITH `npm run db:migrate:deploy` (see idea #34 on `migrate dev`).

-- AlterTable
ALTER TABLE "app_knowledge_designation" ADD COLUMN "sourceKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "app_knowledge_designation_sourceKey_key" ON "app_knowledge_designation"("sourceKey");
