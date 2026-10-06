-- f-journey-record t-146 — the notes a synopsis lists beside it.
--
-- A drafted synopsis lists the visible notes its session wrote, so keeping it
-- can confirm the ones still ticked (owner ruling 2, 6 Oct 2026) and an edit
-- re-extracts only those slots (ruling 3). Each is `{ slotSlug, version }`: a
-- reference, never a reading, so removing a note still takes its words.
--
-- One column, defaulted, so every existing row reads as listing none. Nothing
-- Prisma cannot model is touched. Hand-written (idea #34: `migrate dev`
-- cannot run on this repo); apply with `npm run db:migrate:deploy`.

-- AlterTable
ALTER TABLE "app_journey_entry" ADD COLUMN "notes" JSONB NOT NULL DEFAULT '[]';
