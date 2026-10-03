-- f-registers t-125: the guiding and teaching overlays, in every environment.
--
-- The facilitator seat's register (guiding or teaching, from the person's
-- module) selects one of these two rows as its overlay. An environment that
-- had the four situation overlays from `20260929100100_app_voice_overlays_data`
-- needs these two as well, and production runs the seeder only on request, so
-- they ship as a migration (`.context/app/database-changes.md`). Without them
-- a register selects nothing and the seat falls back to the core-only block,
-- which is safe and silent; the rows are what make it speak in a register.
--
-- WHAT IT WRITES is what the seed writes for these two situations. The JSON
-- literal below is the `guiding` and `teaching` entries of
-- `buildVoiceOverlaySeed()`; a test parses it back out and fails if it differs
-- (`tests/unit/lib/app/content/seed-input/voice-overlay-seed.test.ts`).
--
-- Per set, so per org, and only where that org's set has no overlay of the
-- situation (`fp4`: an operator who already added one keeps theirs). The
-- position is placed after that set's last one, not taken from the literal,
-- because an admin may have added situations since and positions are unique
-- per set. A fresh database has no set when migrations run, so this writes
-- nothing there: seed 019 writes all six. Each row gets revision 1 with
-- `origin = 'seed'`, a null `editorId` and `status = 'draft'`: drafted in her
-- register, awaiting her review at project end (idea #46).
--
-- Data only: no schema diff. Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

SELECT set_config('app.bypass_rls', 'on', true);

CREATE TEMP TABLE "_t125_overlays" AS SELECT $t125overlays$
{
  "overlays": [
    {
      "situation": "guiding",
      "position": 5,
      "label": "Guiding",
      "reviewerNote": "The facilitator seat, when the person's module starts in the guiding register or something hard came up recently (f-registers §12).",
      "heading": "Register for this moment — guiding",
      "lines": [
        "This is the guiding register. Hold space: your work is to be with what they bring, not to move them somewhere.",
        "Open by receiving how it is for them, before anything about what it means. Do not point out a contradiction they have not pointed out themselves.",
        "Reflect back what you heard, in their own words.",
        "Warm, and unhurried. Short lines are a kindness.",
        "At most one gentle, open question, and only if it helps them stay with it.",
        "If gentleness is letting them step around something they keep circling, you may name it once, softly, and ask whether they want to look at it. If they say no, no is a complete answer."
      ],
      "exemplarQuery": "holding space, gentleness, compassion for oneself, being with what is here without fixing it"
    },
    {
      "situation": "teaching",
      "position": 6,
      "label": "Teaching",
      "reviewerNote": "The facilitator seat, when the person's module starts in the teaching register (f-registers §12).",
      "heading": "Register for this moment — teaching",
      "lines": [
        "This is the teaching register. Push past the comfortable answer, kindly, and without softening it into nothing.",
        "Do not open by sympathising or by calling it challenging. Open by naming plainly, in one sentence, what you see.",
        "Ask the question underneath the question. Would they still choose this if nobody rewarded them for it?",
        "Say where in her material it comes from, when it does.",
        "Challenge the idea, never the person. Nothing about them is being graded.",
        "One probing question, then stop and wait. Never two.",
        "If something painful surfaces, or they are struggling rather than avoiding, set the teaching down and hold space instead. That always comes first."
      ],
      "exemplarQuery": "questioning conditioning, honesty with oneself, discernment, challenging what you were handed, accountability"
    }
  ]
}
$t125overlays$::jsonb AS "s";

INSERT INTO "app_voice_overlay" (
  "id", "situation", "setSlug", "setId", "position", "label", "reviewerNote", "heading",
  "lines", "exemplarQuery", "status", "revision", "orgId", "createdAt", "updatedAt"
)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  "o"."value"->>'situation',
  "set"."slug",
  "set"."id",
  (SELECT COALESCE(MAX("x"."position"), 0) FROM "app_voice_overlay" AS "x" WHERE "x"."setId" = "set"."id")
    + "o"."ordinality"::int,
  "o"."value"->>'label',
  "o"."value"->>'reviewerNote',
  "o"."value"->>'heading',
  ARRAY(SELECT jsonb_array_elements_text("o"."value"->'lines')),
  "o"."value"->>'exemplarQuery',
  'draft',
  1,
  "set"."orgId",
  now(),
  now()
FROM "_t125_overlays",
  jsonb_array_elements("s"->'overlays') WITH ORDINALITY AS "o"("value", "ordinality"),
  "app_voice_overlay_set" AS "set"
WHERE NOT EXISTS (
  SELECT 1 FROM "app_voice_overlay" AS "e"
  WHERE "e"."orgId" IS NOT DISTINCT FROM "set"."orgId"
    AND "e"."situation" = "o"."value"->>'situation'
);

-- Revision 1, derived from the rows just inserted, so a snapshot can never
-- disagree with the row it is a snapshot of.
INSERT INTO "app_voice_overlay_revision" (
  "id", "situation", "overlayId", "revision", "position", "label", "reviewerNote", "heading",
  "lines", "exemplarQuery", "status", "changedFields", "origin", "editorId", "orgId", "changedAt"
)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''), "o"."situation", "o"."id", 1, "o"."position",
  "o"."label", "o"."reviewerNote", "o"."heading", "o"."lines", "o"."exemplarQuery", "o"."status",
  ARRAY['position', 'label', 'reviewerNote', 'heading', 'lines', 'exemplarQuery', 'status'],
  'seed', NULL, "o"."orgId", now()
FROM "app_voice_overlay" AS "o"
WHERE "o"."situation" IN ('guiding', 'teaching')
  AND "o"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_voice_overlay_revision" AS "r" WHERE "r"."overlayId" = "o"."id");

DROP TABLE "_t125_overlays";
