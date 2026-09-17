-- Flip the arm's hand-written FK to `ai_evaluation_run` from `ON DELETE CASCADE`
-- to `ON DELETE SET NULL`, and make the column nullable to carry it.
--
-- ## Why the change
--
-- `AiEvaluationRun.user` is `onDelete: Cascade`, so erasing the admin who queued
-- a comparison deletes their runs. Under `CASCADE` that took the arm row with
-- them — the stored prompt, the fingerprint version, the record that the check
-- ever happened — and left an `app_voice_comparison` parent the surface still
-- rendered with no arms and no explanation. None of that is about the admin, so
-- their erasure has no business destroying it.
--
-- The per-case ANSWERS go either way: `ai_evaluation_case_result` hangs off the
-- run and is Sunrise's to cascade. What must not go is the half this table was
-- added for. A null `evaluationRunId` now means one specific thing — *the run
-- that produced these answers no longer exists* — and the comparison surface
-- reports it as `run-deleted` rather than as a case not yet answered.
--
-- ## Why this is a SEPARATE migration rather than an edit to 20260916140000
--
-- That migration had already been applied. Editing it in place changes the
-- checksum Prisma recorded in `_prisma_migrations`, so `migrate deploy` in any
-- environment that ran it fails with "migration was modified after it was
-- applied" — and that environment would still be sitting on `CASCADE`, because a
-- migration Prisma has already recorded is never re-run. 20260916140000 is
-- therefore left exactly as it shipped and the correction lands here, where a
-- fresh database gets both in order and an existing one gets only this.
--
-- ## Prisma cannot see either constraint
--
-- `evaluationRunId` is a plain scalar with no `@relation` — a fork table must not
-- add a reverse relation field to a Sunrise-owned model (CUSTOMIZATION.md §5) —
-- so Prisma computes desired state without it and a future `migrate dev` will
-- emit a DROP. `lib/app/leaf-db-drift.ts` probes the constraint AND its delete
-- action, so a silent drop or a re-create with the wrong action fails the drift
-- check rather than surviving an existence test.

-- DropForeignKey
ALTER TABLE "app_voice_comparison_arm"
    DROP CONSTRAINT IF EXISTS "app_voice_comparison_arm_evaluationRunId_fkey";

-- AlterColumn — nullable is what lets the FK set it rather than delete the row.
-- `DROP NOT NULL` is a no-op on a column that is already nullable.
ALTER TABLE "app_voice_comparison_arm"
    ALTER COLUMN "evaluationRunId" DROP NOT NULL;

-- AddForeignKey — hand-written, as in 20260916140000. The reference names the
-- MAPPED TABLE `ai_evaluation_run`, not the model name (`B11`). SET NULL,
-- deliberately — see the header.
ALTER TABLE "app_voice_comparison_arm"
    ADD CONSTRAINT "app_voice_comparison_arm_evaluationRunId_fkey"
    FOREIGN KEY ("evaluationRunId") REFERENCES "ai_evaluation_run"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
