-- f-leanings t-135: the bounds on a person's voice leanings, on every voice
-- overlay set (owner ruling 2, 4 Oct 2026: they live with the overlays).
--
-- WHAT THEY ARE. Per dial, the furthest stop each way a person may move it
-- (-2 to 2, rest 0 always allowed, locked is min = max = 0), and whether the AI
-- may suggest moving it (t-137). Read by `lib/app/voice/leanings-store.ts`,
-- validated by `leaningBoundsSchema` (`lib/app/voice/leanings.ts`). Drafted for
-- Lelañea Fulton's review at project end (idea #46), so the set returns to
-- `draft`, as any change to its words does.
--
-- WHY A MIGRATION. Seed 019 writes the set once, while it is absent, so the
-- `leanings` block added to `seed-data/drafted/lelanea_voice_overlays.json`
-- reaches only a database that was never seeded
-- (`.context/app/database-changes.md`). A fresh database has no set when this
-- runs, writes nothing here, and the seed brings the same bounds from the file.
-- The JSON literal below is that file's `leanings` block; a test parses it back
-- out and fails if the two differ
-- (`tests/unit/prisma/migrations/voice-leaning-bounds.test.ts`).
--
-- WHAT IT WRITES is what an admin's edit of the set writes: the bounds, a
-- revision bump, back to `draft`, and a full snapshot in the revision table
-- with `origin = 'seed'` and a null `editorId`. Only sets with no bounds yet
-- are touched. The revision table's column stays nullable: revisions written
-- before this have no bounds, and a restore of one keeps the bounds it finds.
--
-- Schema and data. Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

SELECT set_config('app.bypass_rls', 'on', true);

ALTER TABLE "app_voice_overlay_set" ADD COLUMN "leanings" JSONB;
ALTER TABLE "app_voice_overlay_set_revision" ADD COLUMN "leanings" JSONB;

WITH "before" AS (
  SELECT "id", "status" FROM "app_voice_overlay_set" WHERE "leanings" IS NULL
),
"moved" AS (
  UPDATE "app_voice_overlay_set" AS "s"
  SET "leanings" = $t135leanings$
{
  "suggest": true,
  "dials": {
    "abstraction": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "devotion": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "directness": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "encouragement": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "length": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "warmth": {
      "min": -2,
      "max": 1,
      "suggest": true
    },
    "pace": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "questions": {
      "min": -2,
      "max": 1,
      "suggest": true
    },
    "imagery": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "playfulness": {
      "min": -2,
      "max": 2,
      "suggest": true
    },
    "formality": {
      "min": -2,
      "max": 2,
      "suggest": true
    }
  }
}
$t135leanings$::jsonb,
      "revision" = "s"."revision" + 1,
      "status" = 'draft',
      "signedOffAt" = NULL,
      "updatedAt" = now()
  FROM "before"
  WHERE "s"."id" = "before"."id"
  RETURNING "s".*, "before"."status" AS "wasStatus"
)
INSERT INTO "app_voice_overlay_set_revision" (
  "id", "setSlug", "setId", "revision", "title", "version", "locale", "provenance",
  "exemplars", "coreOnly", "leanings", "status", "changedFields", "origin", "editorId",
  "orgId", "changedAt"
)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''), "slug", "id", "revision", "title",
  "version", "locale", "provenance", "exemplars", "coreOnly", "leanings", 'draft',
  CASE WHEN "wasStatus" = 'draft' THEN ARRAY['leanings'] ELSE ARRAY['leanings', 'status'] END,
  'seed', NULL, "orgId", "updatedAt"
FROM "moved";

ALTER TABLE "app_voice_overlay_set" ALTER COLUMN "leanings" SET NOT NULL;
