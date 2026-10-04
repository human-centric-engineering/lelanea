-- f-memory t-130 — the `search_person_memory` capability row, and its grant to
-- `lelanea-guide`, on every database that already exists.
--
-- WHY A MIGRATION. The seed unit
-- `prisma/seeds/app-lelanea/024-search-person-memory.ts` writes both on a fresh
-- database, but production runs the seeder only on request, and a tool with no
-- row is one the guide never advertises (`.context/app/database-changes.md`;
-- the shape is t-93's `20260927100000_app_suggest_resource_capability`, whose
-- header gives the full reasoning, including the one revocation SQL cannot see).
--
-- WHAT IT WRITES, only where absent (`fp4`):
--   1. `ai_capability`: slug `search_person_memory`, active, a system
--      capability, with the same `functionDefinition` literal the class and the
--      seed carry, pinned by
--      `tests/unit/prisma/migrations/search-person-memory-capability.test.ts`.
--      A cuid-shaped id, because the admin API validates capability ids as
--      cuids (t-93's header).
--   2. `ai_agent_capability`: the binding to `lelanea-guide`, switched on,
--      where the guide exists and has none. A binding an operator switched off
--      is theirs and is left alone.
--
-- From here on seed 024's `upsert` takes its `update` branch, re-applying the
-- code-owned fields on every run (#545). The operator-owned literals below are
-- pinned equal to the seed's `create` branch.
--
-- No schema change. Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

SELECT set_config('app.bypass_rls', 'on', true);

INSERT INTO "ai_capability" (
  "id", "slug", "name", "description", "category",
  "functionDefinition", "executionType", "executionHandler",
  "rateLimit", "isActive", "isSystem"
)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  'search_person_memory',
  'Search what the person said before',
  'Finds, by meaning, what this person has said before and the notes kept about them, so the guide can remember it with them. Reads only their own; writes nothing.',
  'app',
  $json$
{
  "name": "search_person_memory",
  "description": "Search what this person has said to you before, and the notes kept about them, by meaning. Call it when they mention someone or something they may have spoken about before, or when remembering it would help you meet them now. Each result says whether it is their own words or a note, and when. Quote their words back only as theirs, never as yours or as Lela\u00f1ea\u2019s material. A note is your understanding of them, not something they said. If nothing comes back, do not claim to remember.",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "What to look for, in plain words: \"my father\", \"starting the new job\".",
        "minLength": 1,
        "maxLength": 500
      }
    },
    "required": [
      "query"
    ]
  }
}
$json$::jsonb,
  'internal',
  'SearchPersonMemoryCapability',
  20,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_capability" WHERE "slug" = 'search_person_memory'
);

-- The grant belongs to the guide's org (Sunrise §107), as the tenancy client
-- would stamp it; `ai_capability` is install-wide and carries none.
INSERT INTO "ai_agent_capability" ("id", "agentId", "capabilityId", "isEnabled", "orgId")
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), a."id", c."id", true, a."orgId"
FROM "ai_agent" AS a
CROSS JOIN "ai_capability" AS c
WHERE a."slug" = 'lelanea-guide'
  AND a."deletedAt" IS NULL
  AND c."slug" = 'search_person_memory'
  AND NOT EXISTS (
    SELECT 1 FROM "ai_agent_capability" AS g
    WHERE g."agentId" = a."id" AND g."capabilityId" = c."id"
  );
