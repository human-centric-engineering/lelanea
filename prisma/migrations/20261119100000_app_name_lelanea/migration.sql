-- The app is Lelanea, with a plain n; the person, Lelañea Fulton, keeps the ñ
-- (owner ruling, 19 Nov 2026; f-content-polish t-193).
--
-- The AI that speaks in the app is the app, so its name follows the rename:
-- "Lelanea's notes", "Lelanea's replies". What is hers keeps the ñ: her name,
-- her writing, her videos, audio and articles, her material, what she says
-- and believes. The phrases below in `keep` are exactly those, as the seed
-- content now writes them; `tests/unit/prisma/migrations/app-name-lelanea.test.ts`
-- fails if the content files gain a ñ this list does not cover.
--
-- WHAT IT MOVES, on every database that already exists
-- (`.context/app/database-changes.md`):
--
--   1. The authored and seeded config that names the app: the foundational
--      documents and their collection, the journey (its title and its key),
--      the journey's tiers and modules, the onboarding chart title, the
--      resources and voice collections, the data slot descriptions, the
--      facilitation map's name, the generation-pause flag, the agents, the
--      voice profile, the capabilities and the golden-set datasets.
--
--      A rename of the product's name, as `20261001100000_app_resource_kinds`
--      renamed the resource vocabulary: no revision is written and no revision
--      number moves, so an admin mid-edit is not refused for a change they
--      cannot see. Revision history is renamed with its rows, so an old
--      revision still reads back the same as its current row.
--
--      Only text that still says "Lelañea" moves, and only that word; the
--      person's phrases are protected first. An admin's edit that names the
--      app is renamed with the rest, as the owner's ruling asks.
--
--   2. The journey key. `app_journey.slug` is the app's name
--      (`journeySeedFromFile`), so it moves to "Lelanea" with the children's
--      `journeySlug`; the admin import refuses a structure file whose name
--      differs from the stored journey's. Skipped where a "Lelanea" journey
--      already exists in that org.
--
-- WHAT IT LEAVES: what people said and what was recorded at the time:
-- conversations and messages, journey entries, notes, waitlist entries, audit
-- logs, agent version snapshots, evaluation runs and the voice comparison
-- arms. And the knowledge mirror (`ai_knowledge_*`): nothing can embed from
-- SQL. The mirror compares each document's text hash with what it ingested,
-- so the daily `/api/v1/app/cron/knowledge-mirror` run re-ingests the renamed
-- documents, as does the next documents write. Seed 020 does not: its own
-- source is unchanged, so the runner skips it.

SELECT set_config('app.bypass_rls', 'on', true);

CREATE FUNCTION pg_temp.app_name_rename(s text) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  -- Longest first, where one contains another.
  keep text[] := ARRAY[
    'Lelañea Fulton',
    'Coach Lelañea',
    'Lelañea — videos, audio and articles',
    'What does Lelañea say',
    'Lelañea often says',
    'Lelañea understands both',
    'Lelañea describes herself',
    'Lelañea holds',
    'Lelañea herself',
    'Lelañea reads',
    'Lelañea can choose',
    'Lelañea’s own original', 'Lelañea''s own original',
    'Lelañea’s own writing', 'Lelañea''s own writing',
    'Lelañea’s own words', 'Lelañea''s own words',
    'Lelañea’s words', 'Lelañea''s words',
    'Lelañea’s videos', 'Lelañea''s videos',
    'Lelañea’s material', 'Lelañea''s material',
    'Lelañea’s personal', 'Lelañea''s personal'
  ];
  i int;
BEGIN
  IF s IS NULL OR position('Lelañea' in s) = 0 THEN
    RETURN s;
  END IF;
  FOR i IN 1..array_length(keep, 1) LOOP
    s := replace(s, keep[i], chr(1) || i || chr(2));
  END LOOP;
  s := replace(s, 'Lelañea', 'Lelanea');
  FOR i IN REVERSE array_length(keep, 1)..1 LOOP
    s := replace(s, chr(1) || i || chr(2), keep[i]);
  END LOOP;
  RETURN s;
END
$fn$;

-- 1. Text columns.
UPDATE "app_document_collection" SET "title" = pg_temp.app_name_rename("title") WHERE "title" LIKE '%Lelañea%';

UPDATE "app_foundational_document" SET
  "title" = pg_temp.app_name_rename("title"),
  "subtitle" = pg_temp.app_name_rename("subtitle"),
  "blocks" = pg_temp.app_name_rename("blocks"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "subtitle" LIKE '%Lelañea%' OR "blocks"::text LIKE '%Lelañea%';

UPDATE "app_foundational_document_revision" SET
  "title" = pg_temp.app_name_rename("title"),
  "subtitle" = pg_temp.app_name_rename("subtitle"),
  "blocks" = pg_temp.app_name_rename("blocks"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "subtitle" LIKE '%Lelañea%' OR "blocks"::text LIKE '%Lelañea%';

UPDATE "app_journey" SET "title" = pg_temp.app_name_rename("title") WHERE "title" LIKE '%Lelañea%';

UPDATE "app_journey_tier" SET "intent" = pg_temp.app_name_rename("intent") WHERE "intent" LIKE '%Lelañea%';
UPDATE "app_journey_tier_revision" SET "intent" = pg_temp.app_name_rename("intent") WHERE "intent" LIKE '%Lelañea%';

UPDATE "app_journey_module" SET "phases" = pg_temp.app_name_rename("phases"::text)::jsonb WHERE "phases"::text LIKE '%Lelañea%';
UPDATE "app_journey_module_revision" SET "phases" = pg_temp.app_name_rename("phases"::text)::jsonb WHERE "phases"::text LIKE '%Lelañea%';

UPDATE "app_question_set" SET "chartTitle" = pg_temp.app_name_rename("chartTitle") WHERE "chartTitle" LIKE '%Lelañea%';
UPDATE "app_question_set_revision" SET "chartTitle" = pg_temp.app_name_rename("chartTitle") WHERE "chartTitle" LIKE '%Lelañea%';

UPDATE "app_resource_collection" SET
  "title" = pg_temp.app_name_rename("title"),
  "provenance" = pg_temp.app_name_rename("provenance"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "provenance"::text LIKE '%Lelañea%';

UPDATE "app_voice_golden_set" SET
  "title" = pg_temp.app_name_rename("title"),
  "provenance" = pg_temp.app_name_rename("provenance"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "provenance"::text LIKE '%Lelañea%';
UPDATE "app_voice_golden_set_revision" SET
  "title" = pg_temp.app_name_rename("title"),
  "provenance" = pg_temp.app_name_rename("provenance"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "provenance"::text LIKE '%Lelañea%';

UPDATE "app_voice_overlay_set" SET
  "title" = pg_temp.app_name_rename("title"),
  "provenance" = pg_temp.app_name_rename("provenance"::text)::jsonb,
  "exemplars" = pg_temp.app_name_rename("exemplars"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "provenance"::text LIKE '%Lelañea%' OR "exemplars"::text LIKE '%Lelañea%';
UPDATE "app_voice_overlay_set_revision" SET
  "title" = pg_temp.app_name_rename("title"),
  "provenance" = pg_temp.app_name_rename("provenance"::text)::jsonb,
  "exemplars" = pg_temp.app_name_rename("exemplars"::text)::jsonb
WHERE "title" LIKE '%Lelañea%' OR "provenance"::text LIKE '%Lelañea%' OR "exemplars"::text LIKE '%Lelañea%';

UPDATE "framework_slot_definition" SET "description" = pg_temp.app_name_rename("description") WHERE "description" LIKE '%Lelañea%';

UPDATE "framework_facilitation_graph" SET "name" = pg_temp.app_name_rename("name") WHERE "name" LIKE '%Lelañea%';

UPDATE "feature_flag" SET "description" = pg_temp.app_name_rename("description") WHERE "description" LIKE '%Lelañea%';

UPDATE "ai_agent" SET
  "name" = pg_temp.app_name_rename("name"),
  "systemInstructions" = pg_temp.app_name_rename("systemInstructions")
WHERE "name" LIKE '%Lelañea%' OR "systemInstructions" LIKE '%Lelañea%';

UPDATE "ai_agent_profile" SET
  "name" = pg_temp.app_name_rename("name"),
  "persona" = pg_temp.app_name_rename("persona"),
  "guardrails" = pg_temp.app_name_rename("guardrails")
WHERE "name" LIKE '%Lelañea%' OR "persona" LIKE '%Lelañea%' OR "guardrails" LIKE '%Lelañea%';

UPDATE "ai_capability" SET
  "description" = pg_temp.app_name_rename("description"),
  "functionDefinition" = pg_temp.app_name_rename("functionDefinition"::text)::jsonb
WHERE "description" LIKE '%Lelañea%' OR "functionDefinition"::text LIKE '%Lelañea%';

UPDATE "ai_dataset" SET "name" = pg_temp.app_name_rename("name") WHERE "name" LIKE '%Lelañea%';

-- 2. The journey key, then the children of every journey that moved.
UPDATE "app_journey" j SET "slug" = 'Lelanea'
WHERE j."slug" = 'Lelañea'
  AND NOT EXISTS (
    SELECT 1 FROM "app_journey" o
    WHERE o."slug" = 'Lelanea' AND o."orgId" IS NOT DISTINCT FROM j."orgId"
  );

UPDATE "app_journey_tier" t SET "journeySlug" = j."slug"
FROM "app_journey" j
WHERE t."journeyId" = j."id" AND t."journeySlug" = 'Lelañea' AND j."slug" = 'Lelanea';

UPDATE "app_journey_module" m SET "journeySlug" = j."slug"
FROM "app_journey" j
WHERE m."journeyId" = j."id" AND m."journeySlug" = 'Lelañea' AND j."slug" = 'Lelanea';
