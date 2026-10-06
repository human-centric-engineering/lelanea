-- f-recap t-142: what a session recap drew on, on its turn row.
--
-- The recap is the AI's own opening of a new session, steered by material the
-- person never sees (`lib/app/conversation/recap.ts`). The account under the
-- reply says what it drew on, and reads it from here. Shape:
-- `{ since, words, notes: [heading], journey }` (`recapAccountSchema`) —
-- counts and headings, never the person's words or a note's value.
-- Nullable: every turn that is not a recap has none.
--
-- Schema only, no data. Hand-written (idea #34: `migrate dev` cannot run on
-- this repo). Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

ALTER TABLE "app_turn" ADD COLUMN "recap" JSONB;
