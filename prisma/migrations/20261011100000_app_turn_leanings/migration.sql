-- f-leanings t-136: the leanings a turn applied, on its turn row.
--
-- Decided when the turn seam claims the turn, beside the register, and read
-- back by the context contributor, so the pole lines the prompt carried and
-- the leanings the account under the reply names are one value. Shape:
-- `{ applied: [{ key, stop }], held: [key] }` (`leaningsStampSchema`).
-- Nullable: a seat with no leanings, and every turn claimed before this, has
-- none.
--
-- Schema only, no data. Hand-written (idea #34: `migrate dev` cannot run on
-- this repo). Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

ALTER TABLE "app_turn" ADD COLUMN "leanings" JSONB;
