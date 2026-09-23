-- f-content-seeds t-88: which golden set is current, in every environment.
--
-- Production runs `db:migrate:deploy` before every start and runs the seeder
-- only when someone asks (owner rule, 22 Sep 2026,
-- `.context/app/database-changes.md`). Without this row `/admin/app/voice`,
-- the preflight and the comparison cannot say which dataset is current, and
-- since t-88 none of them may fall back to the authored file to find out.
--
-- WHAT IT WRITES is exactly what `004-voice-golden-set.ts` writes through
-- `seedGoldenSetPointer`. The literal below is `buildGoldenSetSeed()`, pinned
-- by `tests/unit/lib/app/content/golden-set-seed.test.ts`.
--
-- NOTE what it does NOT write: the prompts. They are `ai_dataset_case` rows
-- and seed 004 owns them, because a dataset is a pure projection that can be
-- reconciled safely. This row cannot be, which is why it is separate (`fp4`).
-- An environment migrating for the first time therefore gets the pointer here
-- and the cases when the seeder is run; a comparison that finds the pointer
-- but no cases fails with the honest "not in this install" error rather than
-- silently running the previous version's questions.
--
-- Operator-owned (`fp4`): the insert runs only while the table is empty.
-- Seeded `draft` — the words await her sign-off and a migration cannot grant it.
--
-- Data only: no schema diff. Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

CREATE TEMP TABLE "_t88_goldenset" AS SELECT $t88gs${
  "id": "lelanea_voice_golden_set",
  "title": "Lelañea — Voice Fingerprint · the golden set",
  "version": "1.1",
  "locale": "en-US",
  "provenance": {
    "status": "drafted_from_corpus",
    "awaitingSignOffFrom": "Lelañea Fulton",
    "note": "The prompts are what a person says to her, drafted from the moments the app actually has. They are not her words — but they decide which moments she is ever heard in, so they are authored here rather than written into a seed, and they wait on her the same way the core and the overlays do."
  }
}$t88gs$::jsonb AS "s";

INSERT INTO "app_voice_golden_set" (
  "id", "title", "version", "locale", "provenance", "status", "signedOffAt",
  "revision", "createdAt", "updatedAt"
)
SELECT
  "s"->>'id', "s"->>'title', "s"->>'version', "s"->>'locale', "s"->'provenance',
  'draft', NULL, 1, now(), now()
FROM "_t88_goldenset"
WHERE NOT EXISTS (SELECT 1 FROM "app_voice_golden_set");

-- Revision 1, derived from the row just inserted rather than from the JSON.
INSERT INTO "app_voice_golden_set_revision" (
  "id", "setId", "revision", "title", "version", "locale", "provenance",
  "status", "changedFields", "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "t"."id", 1, "t"."title", "t"."version", "t"."locale",
  "t"."provenance", "t"."status",
  ARRAY['title', 'version', 'locale', 'provenance', 'status'],
  'seed', NULL, now()
FROM "app_voice_golden_set" AS "t"
WHERE "t"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_voice_golden_set_revision" AS "r" WHERE "r"."setId" = "t"."id");

DROP TABLE "_t88_goldenset";
