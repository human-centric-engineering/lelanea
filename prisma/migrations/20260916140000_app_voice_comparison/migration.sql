-- §05 t-28 — AppVoiceComparison / AppVoiceComparisonArm: what Sunrise's
-- evaluation harness has no column for.
--
-- Sunrise already runs a dataset against an agent and stores every answer
-- (`ai_dataset`, `ai_evaluation_run`, `ai_evaluation_case_result`). What it does
-- not record is which VERSION of her voice the agent was wearing when it
-- answered, or that two runs were queued together as the two arms of one
-- comparison. `ai_evaluation_run` has no free metadata column to put either in.
--
-- Deriving the version at render time instead was the alternative, and it is
-- wrong in the one case the feature exists for: the moment the core changes,
-- every historical run silently re-attributes itself to the new version, and
-- "v1.0 beside v1.1" becomes v1.1 beside itself. `systemPrompt` is stored whole
-- rather than hashed for the same reason — the prompt is the evidence, the
-- version string beside it is only a claim.
--
-- ERASURE DISPOSITION (GDPR Art. 17). None needed: a version string, a content
-- hash, a composed system prompt and two timestamps. Nothing here is about a
-- person, and the admin who queued a comparison is recorded by Sunrise on
-- `ai_evaluation_run.userId` rather than copied down here. Declared as
-- EXCLUSIONS, with that reason, in lib/app/leaf-data-export.ts — which is what a
-- data subject is shown verbatim.
--
-- The FK from the arm to `ai_evaluation_run` is HAND-WRITTEN below, because a
-- fork table must not add a reverse relation field to a Sunrise-owned model
-- (CUSTOMIZATION.md §5) and `AiEvaluationRun` lives in
-- prisma/schema/orchestration-evaluation.prisma. `ON DELETE CASCADE`: an arm
-- attributes a run's outputs, and without the run it attributes nothing. Note the
-- reference names the MAPPED TABLE `ai_evaluation_run`, not the model name
-- (`B11`).
--
-- Prisma cannot see that constraint (it computes desired state from a schema with
-- no `@relation` for it), so a future `migrate dev` will emit a DROP for it.
-- lib/app/leaf-db-drift.ts registers a probe that pins both its existence and its
-- `ON DELETE` action; `npm run db:drift-check` fails if either moves.
--
-- The comparison → arm FK is NOT hand-written: both tables are ours, the relation
-- is in `prisma/schema/app.prisma`, and Prisma manages it.
--
-- APPLY WITH `npm run db:migrate:deploy`, not `migrate dev` — the schema and the
-- database diverge here on purpose, and the development command reads that
-- divergence as drift and "corrects" it.
--
-- WHAT WAS STRIPPED FROM THE GENERATED SQL (`B13`). `prisma migrate dev
-- --create-only` emits DROP CONSTRAINT for this fork's three existing
-- hand-written FKs (`app_waitlist_entry_userId_fkey`,
-- `app_acknowledgement_userId_fkey`,
-- `app_knowledge_designation_documentId_fkey`) and for the framework's FKs to
-- `user`, `ai_agent`, `ai_knowledge_document`, `ai_knowledge_tag`, `ai_workflow`
-- and `ai_message`; DROP INDEX for the pgvector HNSW indexes and the tsvector GIN
-- index; and the `searchVector` DROP DEFAULT. Every one of them an object Prisma
-- cannot model. Everything below this line is the two tables this migration is
-- for.

-- CreateTable
CREATE TABLE "app_voice_comparison" (
    "id" TEXT NOT NULL,
    "goldenSetVersion" TEXT NOT NULL,
    "datasetContentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_voice_comparison_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_voice_comparison_arm" (
    "id" TEXT NOT NULL,
    "comparisonId" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "fingerprintVersion" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "evaluationRunId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_voice_comparison_arm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_voice_comparison_createdAt_idx" ON "app_voice_comparison"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "app_voice_comparison_arm_evaluationRunId_key" ON "app_voice_comparison_arm"("evaluationRunId");

-- CreateIndex
CREATE INDEX "app_voice_comparison_arm_comparisonId_idx" ON "app_voice_comparison_arm"("comparisonId");

-- CreateIndex
CREATE UNIQUE INDEX "app_voice_comparison_arm_comparisonId_arm_key" ON "app_voice_comparison_arm"("comparisonId", "arm");

-- AddForeignKey — ours to ours; Prisma models this one.
ALTER TABLE "app_voice_comparison_arm"
    ADD CONSTRAINT "app_voice_comparison_arm_comparisonId_fkey"
    FOREIGN KEY ("comparisonId") REFERENCES "app_voice_comparison"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey — hand-written; the core `AiEvaluationRun` model maps to table
-- "ai_evaluation_run".
ALTER TABLE "app_voice_comparison_arm"
    ADD CONSTRAINT "app_voice_comparison_arm_evaluationRunId_fkey"
    FOREIGN KEY ("evaluationRunId") REFERENCES "ai_evaluation_run"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
