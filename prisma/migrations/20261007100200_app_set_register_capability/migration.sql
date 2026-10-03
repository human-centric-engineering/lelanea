-- f-registers t-126 — the `set_register` capability row, and its grant to
-- `lelanea-guide`, on every database that already exists.
--
-- WHY A MIGRATION. The seed unit `prisma/seeds/app-lelanea/023-set-register.ts`
-- writes both on a fresh database, but production runs the seeder only on
-- request, and a tool with no row is one the guide never advertises
-- (`.context/app/database-changes.md`; the shape is t-93's
-- `20260927100000_app_suggest_resource_capability`, whose header gives the
-- full reasoning, including the one revocation SQL cannot see).
--
-- WHAT IT WRITES, only where absent (`fp4`):
--   1. `ai_capability`: slug `set_register`, active, a system capability, with
--      the same `functionDefinition` literal the class and the seed carry,
--      pinned by `tests/unit/prisma/migrations/set-register-capability.test.ts`.
--      A cuid-shaped id, because the admin API validates capability ids as
--      cuids (t-93's header).
--   2. `ai_agent_capability`: the binding to `lelanea-guide`, switched on,
--      where the guide exists and has none. A binding an operator switched off
--      is theirs and is left alone.
--
-- From here on seed 023's `upsert` takes its `update` branch, re-applying the
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
  'set_register',
  'Change how it speaks',
  'Remembers, for a sitting, that the person asked to be met more gently or more directly. Writes only their own lean on their own journey.',
  'app',
  $json$
{
  "name": "set_register",
  "description": "Call this only when the person asks you to change how you speak with them: gentler or softer (\"be gentle with me today\", \"I can’t take being pushed right now\") is guiding; more direct or challenging (\"push me\", \"don’t let me off the hook\") is teaching; asking to go back to how it was is default. It holds for the rest of this sitting. Never call it on your own judgement, and never to push someone who is struggling. Then answer them in that register.",
  "parameters": {
    "type": "object",
    "properties": {
      "register": {
        "type": "string",
        "enum": [
          "guiding",
          "teaching",
          "default"
        ],
        "description": "guiding (gentle, holding space), teaching (direct, probing), or default (back to how this part of the journey starts)."
      }
    },
    "required": [
      "register"
    ]
  }
}
$json$::jsonb,
  'internal',
  'SetRegisterCapability',
  10,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_capability" WHERE "slug" = 'set_register'
);

-- The grant belongs to the guide's org (Sunrise §107), as the tenancy client
-- would stamp it; `ai_capability` is install-wide and carries none.
INSERT INTO "ai_agent_capability" ("id", "agentId", "capabilityId", "isEnabled", "orgId")
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), a."id", c."id", true, a."orgId"
FROM "ai_agent" AS a
CROSS JOIN "ai_capability" AS c
WHERE a."slug" = 'lelanea-guide'
  AND a."deletedAt" IS NULL
  AND c."slug" = 'set_register'
  AND NOT EXISTS (
    SELECT 1 FROM "ai_agent_capability" AS g
    WHERE g."agentId" = a."id" AND g."capabilityId" = c."id"
  );
