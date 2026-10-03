-- f-memory t-129 — AppMemoryEmbedding: what a person says, embedded so it can
-- be found again by meaning, for that person only. A leaf stand-in for
-- daybreak#287 (owner ruling 1, 3 Oct 2026); only lib/app/memory/memory-index.ts
-- reads or writes it.
--
-- AN EMBEDDING GOES WITH ITS SOURCE (owner ruling 2). Three foreign keys, every
-- one ON DELETE CASCADE:
--   - "userId" → "user": erasing the person takes their vectors. HAND-WRITTEN,
--     against the MAPPED table `user` (`B11`): a fork table must not add a
--     reverse field to the Sunrise-owned `User` model (CUSTOMIZATION.md §5).
--   - "messageId" → "ai_message": deleting a message, an exchange (t-127) or a
--     conversation (Sunrise's route, retention) takes its vector. HAND-WRITTEN,
--     against the mapped table `ai_message`, for the same reason.
--   - "orgId" → "org": the generated one, as every app_* table has.
-- The CHECK below ties `sourceKind` to its column, so a `message` row always
-- has the id its cascade follows. A row with no source would never be deleted.
--
-- Prisma cannot see the two hand-written FKs, the two CHECKs or the HNSW index,
-- so a future `migrate dev` will emit DROPs for them. lib/app/leaf-db-drift.ts
-- registers a probe for each; `npm run db:drift-check` fails if one moves.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose.
--
-- TENANCY. The `org_isolation` policy ships dormant, like every other app_*
-- table's (20261003100100_app_org_isolation_policies). On a database where
-- `npm run db:tenancy:enable` has already run, run it again after this
-- migration so the new table's row security is switched on with the rest.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). Generated with
-- `prisma migrate diff --from-config-datasource --to-schema prisma/schema`,
-- which emitted 37 statements that are not ours: DROP CONSTRAINT for this
-- fork's eighteen existing hand-written FKs and fourteen framework FKs, DROP
-- INDEX for the three pgvector HNSW indexes and the tsvector GIN index, and the
-- `searchVector` DROP DEFAULT. Every one an object Prisma cannot model.

-- CreateEnum
CREATE TYPE "app_memory_source_kind" AS ENUM ('message');

-- CreateTable
CREATE TABLE "app_memory_embedding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKind" "app_memory_source_kind" NOT NULL,
    "messageId" TEXT,
    "embedding" vector(1536) NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "embeddingProvider" TEXT NOT NULL,
    "embeddingDimension" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orgId" TEXT,

    CONSTRAINT "app_memory_embedding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_memory_embedding_messageId_key" ON "app_memory_embedding"("messageId");

-- CreateIndex
CREATE INDEX "app_memory_embedding_userId_embeddingModel_idx" ON "app_memory_embedding"("userId", "embeddingModel");

-- CreateIndex
CREATE INDEX "app_memory_embedding_orgId_idx" ON "app_memory_embedding"("orgId");

-- AddForeignKey
ALTER TABLE "app_memory_embedding" ADD CONSTRAINT "app_memory_embedding_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "org"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — hand-written; the core `User` model maps to table "user".
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "user"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — hand-written; the core `AiMessage` model maps to "ai_message".
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "ai_message"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Every source kind names its source. t-107 widens this when notes join.
ALTER TABLE "app_memory_embedding"
    ADD CONSTRAINT "app_memory_embedding_source_check"
    CHECK ("sourceKind" = 'message' AND "messageId" IS NOT NULL);

-- t-115: every app_* row names its org.
ALTER TABLE "app_memory_embedding" ADD CONSTRAINT "app_memory_embedding_orgId_not_null" CHECK ("orgId" IS NOT NULL);

-- HNSW over cosine distance, the shape of idx_framework_node_embedding. A search
-- filters on "userId" first; see memory-index.ts on what that costs at scale.
CREATE INDEX "idx_app_memory_embedding" ON "app_memory_embedding" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);

-- t-112: dormant until `npm run db:tenancy:enable` (see TENANCY above).
CREATE POLICY "org_isolation" ON "app_memory_embedding"
  USING (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  )
  WITH CHECK (
    current_setting('app.bypass_rls', true) = 'on'
    OR "orgId" = NULLIF(current_setting('app.current_org', true), '')
  );
