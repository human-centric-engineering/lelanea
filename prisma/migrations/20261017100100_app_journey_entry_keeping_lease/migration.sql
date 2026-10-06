-- f-journey-record t-147 (review round 1) — what keeping still owes, and the
-- lease that serialises keeping and redrafting.
--
--   - "notesPending": set by the write that keeps a synopsis, cleared once its
--     notes are confirmed or re-read. A keep that failed between the two is
--     finished by the next keep instead of being taken for done.
--   - "workingSince": a keep or a redraft is under way. A second submit meets
--     it and waits; one older than the lease is taken over, so a crash never
--     holds an entry for good.
--
-- Both nullable, so every existing row reads as settled and idle. Nothing
-- Prisma cannot model is touched. Hand-written (idea #34); apply with
-- `npm run db:migrate:deploy`.

-- CreateEnum
CREATE TYPE "app_journey_notes_pending" AS ENUM ('confirm', 'reread');

-- AlterTable
ALTER TABLE "app_journey_entry" ADD COLUMN "notesPending" "app_journey_notes_pending";
ALTER TABLE "app_journey_entry" ADD COLUMN "workingSince" TIMESTAMP(3);
