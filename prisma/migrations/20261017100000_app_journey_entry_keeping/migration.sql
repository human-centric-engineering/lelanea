-- f-journey-record t-147 — keeping a synopsis.
--
-- Two columns, both defaulted, so every existing row reads as never
-- regenerated and never flagged:
--   - "regenerations": how many times the person asked for another draft.
--     Capped in code, and claimed before the model is called, so a double
--     submit drafts once.
--   - "sourceRemovedAt": set when an exchange a kept synopsis was written from
--     is deleted (owner ruling, 6 Oct 2026, at t-147). A draft is removed
--     instead, in the deletion's own transaction.
--
-- Nothing Prisma cannot model is touched. Hand-written (idea #34: `migrate dev`
-- cannot run on this repo); apply with `npm run db:migrate:deploy`.

-- AlterTable
ALTER TABLE "app_journey_entry" ADD COLUMN "regenerations" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "app_journey_entry" ADD COLUMN "sourceRemovedAt" TIMESTAMP(3);
