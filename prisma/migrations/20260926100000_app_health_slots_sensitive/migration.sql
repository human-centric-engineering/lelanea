-- f-slots t-84 — the nine health slots move from `special_category` to
-- `sensitive`, on every database that already holds the taxonomy.
--
-- WHY. `special_category` makes capture blank out what the person said before it
-- is stored, which left the notes about their health and feelings worthless.
-- Owner ruling of 21 Sept 2026 (journal on f-slots): none of the nine stays
-- `special_category` by default; all nine become `sensitive` — the words are
-- kept, shown to the person, and correctable.
--
-- WHY A MIGRATION AND NOT THE SEED. `content/lelanea_slot_taxonomy.json` only
-- reaches an UNSEEDED database: `prisma/seeds/app-lelanea/011-slot-taxonomy.ts`
-- writes the taxonomy once, while the table is empty, and never again. A seed
-- unit would reach only the databases someone remembered to seed — in
-- `docker-compose.prod.yml` the seeder is opt-in (`profiles: ['seed']`) while the
-- migrator runs before every `web` start. So the edit to the JSON covers a fresh
-- database, and this covers every existing one.
--
-- WHAT IT WRITES — the same three things an admin's edit in Admin → Data slots
-- produces, so the record cannot tell the two paths apart except by `origin`:
--
--   1. `app_slot_definition` — `sensitivity` and a version bump.
--   2. `app_slot_definition_revision` — one full snapshot per changed slot at
--      the new version, `changedFields = {sensitivity}`, `origin = 'seed'` (the
--      operator changed it, not a person; `editorId` null). `id` is a random
--      UUID rather than a cuid — the column is TEXT and nothing parses it.
--   3. `framework_slot_definition` — the projection masking actually reads.
--      The server's boot sync (`syncRegisteredSlotDefinitions()`) would rewrite
--      it from (1) on the next start anyway, since `sensitivity` is one of the
--      fields it diffs; writing it here closes the window between this
--      migration and that boot, and the boot then finds nothing to change.
--
-- WHAT IT LEAVES ALONE. Only rows still at `special_category` move. On a fresh
-- database the tables are empty when this runs (migrations precede the seed),
-- so it writes nothing and the seed brings the new values from the JSON. A slot
-- an admin has already moved keeps what the admin chose. Running it twice is a
-- no-op, though Prisma never will.
--
-- WHAT IT CANNOT DO. Notes already blanked out stay blanked: the words were
-- never stored.
--
-- No schema change, so nothing for `prisma migrate diff` to generate and no
-- unmodelled object for `db:drift-check` to miss.

-- One statement: the CTE updates the definitions and the insert reads the rows
-- it changed, so the history can never be written for a slot that did not move.
WITH moved AS (
  UPDATE "app_slot_definition"
  SET "sensitivity" = 'sensitive',
      "version" = "version" + 1,
      "updatedAt" = CURRENT_TIMESTAMP
  WHERE "sensitivity" = 'special_category'
    AND "slug" IN (
      'life_physical_health',
      'life_physical_health_strain',
      'life_physical_health_strength',
      'life_emotional_health',
      'life_emotional_health_strain',
      'life_emotional_health_strength',
      'life_spiritual_health',
      'life_spiritual_health_strain',
      'life_spiritual_health_strength'
    )
  RETURNING *
)
INSERT INTO "app_slot_definition_revision" (
  "id", "slotSlug", "version", "group", "description", "visibility", "mode",
  "dataType", "sensitivity", "priorityWeight", "isActive", "changedFields",
  "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "slug", "version", "group", "description", "visibility", "mode",
  "dataType", "sensitivity", "priorityWeight", "isActive", ARRAY['sensitivity'],
  'seed', NULL, "updatedAt"
FROM moved;

-- The projection: the same nine, only among the global rows the leaf's provider
-- owns, and only where the definition now says `sensitive` — so it copies what
-- the statement above left in place and never contradicts a slot an admin set
-- back to `special_category`.
UPDATE "framework_slot_definition" AS f
SET "sensitivity" = 'sensitive',
    "updatedAt" = CURRENT_TIMESTAMP
FROM "app_slot_definition" AS a
WHERE f."slug" = a."slug"
  AND f."scope" = 'global'
  AND f."sensitivity" = 'special_category'
  AND a."sensitivity" = 'sensitive'
  AND a."slug" IN (
    'life_physical_health',
    'life_physical_health_strain',
    'life_physical_health_strength',
    'life_emotional_health',
    'life_emotional_health_strain',
    'life_emotional_health_strength',
    'life_spiritual_health',
    'life_spiritual_health_strain',
    'life_spiritual_health_strength'
  );
