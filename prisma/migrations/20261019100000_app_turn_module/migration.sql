-- f-forget-session t-152: the module a turn was taken in, on its turn row.
--
-- The slug of the module the person was in when the turn was claimed: the
-- module the register read (`resolveRegister`, which catches a failed journey
-- read and stamps null; `lib/app/voice/register-store.ts`). It is what makes "everything I said in
-- this module" a lookup (owner ruling 2, 7 Oct 2026, journal on §23).
--
-- Nullable, and NOT backfilled: nothing recorded which module an earlier turn
-- fell in, and reconstructing it from journey node states would be a guess
-- (several nodes can be active at once, and a node state holds no exit time).
-- Null also means the seat has no register, or the journey could not be read.
--
-- No FK: a module's slug is an identity in the registry, not a row this table
-- should hold open, and a retired module's turns are still the person's.
--
-- Schema only, no data. Hand-written (idea #34: `migrate dev` cannot run on
-- this repo). Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

ALTER TABLE "app_turn" ADD COLUMN "moduleSlug" TEXT;

CREATE INDEX "app_turn_userId_moduleSlug_idx" ON "app_turn"("userId", "moduleSlug");
