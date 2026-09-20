-- Which slots a turn has already written, so a retried turn cannot write one
-- twice (f-slots t-72; product description §8.1).
--
-- HAND-WRITTEN rather than generated. `prisma migrate dev` refuses to run
-- against this development database at all: `20260916140000_app_voice_comparison`
-- was edited after it had been applied (commit 3a57c856, deliberately), and the
-- only remedy `migrate dev` offers is resetting the schema. That is a
-- pre-existing condition of the tree, unrelated to this table, and not worth a
-- developer's database. Applied with `db:migrate:deploy`, which is the command
-- `B11` names for hand-written SQL in any case.
--
-- The FK names `app_turn` — the MAPPED table — not the `AppTurn` model
-- (`B11`): the two differ, and the model name fails at apply time rather than
-- at type-check.
--
-- `ON DELETE CASCADE`, and it carries the whole Art. 17 disposition for this
-- table. `app_turn.userId` already cascades from `user`, so erasing an account
-- removes its turns and these rows with them. A constraint re-created with
-- `NO ACTION` would pass an existence check while making `eraseUser()` fail
-- with P2003 for anyone who had ever had something noted about them — which is
-- why `lib/app/leaf-db-drift.ts` probes the DEFINITION, not the existence.
CREATE TABLE "app_turn_slot_write" (
    "id" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "slotSlug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "minted" BOOLEAN NOT NULL,
    "writtenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_turn_slot_write_pkey" PRIMARY KEY ("id")
);

-- The guard itself. Not merely an index: this is what makes "this turn has
-- already written this slot" a fact two concurrent dispatches cannot both miss.
CREATE UNIQUE INDEX "app_turn_slot_write_turnId_slotSlug_key" ON "app_turn_slot_write"("turnId", "slotSlug");

ALTER TABLE "app_turn_slot_write"
    ADD CONSTRAINT "app_turn_slot_write_turnId_fkey"
    FOREIGN KEY ("turnId") REFERENCES "app_turn"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
