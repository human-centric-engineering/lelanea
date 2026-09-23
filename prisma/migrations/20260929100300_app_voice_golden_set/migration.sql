-- f-content-seeds t-88: which golden set is current, in the database.
--
-- WHAT THIS ROW IS FOR. The prompts already lived in the database — seed 004
-- writes them as an `AiDataset` with one `AiDatasetCase` per prompt — but the
-- dataset is keyed BY the authored version (`lelanea-voice-golden-set-v1.1`),
-- so reading it required already knowing which version was current. The
-- authored file was the only thing that knew. That is what kept
-- `app/admin/app/voice`, `lib/app/voice/preflight.ts` and
-- `lib/app/voice/comparison.ts` reading a bundled file at request time.
--
-- ONE OWNER PER FIELD (`fp4`). This table holds the POINTER and the
-- PROVENANCE, and nothing else. The prompts stay in `ai_dataset_case`; the
-- control's system instructions stay on the control agent. Copying either here
-- would give her prompts two writable homes — the failure t-87 named when it
-- split the journey's roster from the journey's words.
--
-- These tables are EMPTY after this migration. The next one,
-- `20260929100400_app_voice_golden_set_data`, fills them in every environment.
--
-- ERASURE DISPOSITION (GDPR Art. 17). `editorId` is a plain scalar with no
-- Prisma `@relation` (CUSTOMIZATION.md §5), so its FK is HAND-WRITTEN at the
-- bottom against the MAPPED table `user` (`B11`) with `ON DELETE SET NULL`,
-- and pinned by a probe in `lib/app/leaf-db-drift.ts`.
--
-- APPLY WITH `npm run db:migrate:deploy`. Generated with `prisma migrate diff`
-- and stripped of the drops Prisma emits for objects it cannot model (`B13`).

-- CreateTable
CREATE TABLE "app_voice_golden_set" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "status" "app_voice_content_status" NOT NULL DEFAULT 'draft',
    "signedOffAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_voice_golden_set_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_voice_golden_set_revision" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "provenance" JSONB NOT NULL,
    "status" "app_voice_content_status" NOT NULL,
    "changedFields" TEXT[],
    "origin" "app_content_revision_origin" NOT NULL,
    "editorId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_voice_golden_set_revision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_voice_golden_set_revision_setId_changedAt_idx" ON "app_voice_golden_set_revision"("setId", "changedAt");

-- CreateIndex
CREATE INDEX "app_voice_golden_set_revision_editorId_idx" ON "app_voice_golden_set_revision"("editorId");

-- CreateIndex
CREATE UNIQUE INDEX "app_voice_golden_set_revision_setId_revision_key" ON "app_voice_golden_set_revision"("setId", "revision");

-- AddForeignKey
ALTER TABLE "app_voice_golden_set_revision" ADD CONSTRAINT "app_voice_golden_set_revision_setId_fkey" FOREIGN KEY ("setId") REFERENCES "app_voice_golden_set"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- AddForeignKey
-- Hand-written: `editorId` has no Prisma relation (see the header).
ALTER TABLE "app_voice_golden_set_revision" ADD CONSTRAINT "app_voice_golden_set_revision_editorId_fkey" FOREIGN KEY ("editorId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
