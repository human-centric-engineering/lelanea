-- f-registers t-125: the register a turn was steered to, on its turn row.
--
-- Guiding or teaching, decided when the turn seam claims the turn and read
-- back by the context contributor, so the prompt and the account under the
-- reply say one value. `registerSource` says why: the person's module, or a
-- crisis. Both nullable: a seat with no register, and every turn claimed
-- before this, has neither.
--
-- Schema only, no data. Hand-written (idea #34: `migrate dev` cannot run on
-- this repo). Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

ALTER TABLE "app_turn" ADD COLUMN "register" TEXT;
ALTER TABLE "app_turn" ADD COLUMN "registerSource" TEXT;
