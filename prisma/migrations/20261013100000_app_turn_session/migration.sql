-- f-recap t-141: the session a turn fell in, on its turn row.
--
-- A session is a `session.started` row in Daybreak's `framework_journey_event`
-- (owner ruling, 6 Oct 2026); this column holds that row's id, stamped when the
-- turn is claimed (`lib/app/sessions/store.ts`).
--
-- Nullable, and NOT backfilled: turns from before this were taken in sittings
-- nobody recorded, and inventing them from timestamps now would be a record of
-- something that did not happen.
--
-- The FK is hand-written and not modelled by Prisma (a relation would add a
-- reverse field to Daybreak's `JourneyEvent`). It names the mapped table
-- (`B11`). `ON DELETE SET NULL`: the turn's metering outlives a session row
-- removed on its own; erasure removes both through their own cascades to
-- `user`. Pinned by a drift probe in `lib/app/leaf-db-drift.ts`.
--
-- Schema only, no data. Hand-written (idea #34: `migrate dev` cannot run on
-- this repo). Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

ALTER TABLE "app_turn" ADD COLUMN "sessionId" TEXT;

CREATE INDEX "app_turn_sessionId_idx" ON "app_turn"("sessionId");

ALTER TABLE "app_turn" ADD CONSTRAINT "app_turn_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "framework_journey_event"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
