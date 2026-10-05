-- f-leanings t-137 — the `set_leaning` capability row, and its grant to
-- `lelanea-guide`, on every database that already exists.
--
-- WHY A MIGRATION. The seed unit `prisma/seeds/app-lelanea/025-set-leaning.ts`
-- writes both on a fresh database, but production runs the seeder only on
-- request, and a tool with no row is one the guide never advertises
-- (`.context/app/database-changes.md`; the shape is t-93's
-- `20260927100000_app_suggest_resource_capability`, whose header gives the
-- full reasoning, including the one revocation SQL cannot see).
--
-- WHAT IT WRITES, only where absent (`fp4`):
--   1. `ai_capability`: slug `set_leaning`, active, a system capability, with
--      the same `functionDefinition` literal the class and the seed carry,
--      pinned by `tests/unit/prisma/migrations/set-leaning-capability.test.ts`.
--      A cuid-shaped id, because the admin API validates capability ids as
--      cuids (t-93's header).
--   2. `ai_agent_capability`: the binding to `lelanea-guide`, switched on,
--      where the guide exists and has none. A binding an operator switched off
--      is theirs and is left alone.
--
-- From here on seed 025's `upsert` takes its `update` branch, re-applying the
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
  'set_leaning',
  'Change a leaning',
  'Moves one of the person’s own voice leanings a stop, when they ask or agree to a suggestion. Writes only their own setting, as a new version.',
  'app',
  $json$
{
  "name": "set_leaning",
  "description": "Change one of the person’s lasting leanings: how your voice leans for them from now on, the same dials they have in Settings. Two ways, and only these. (1) They ask in their own words for a lasting change (\"be plainer with me\", \"you can be more direct with me\"): call it then, with how: asked. (2) You notice a pattern they have not named: call it with how: proposed, which changes nothing and only records the proposal, and put it to them in one sentence: what you noticed, and what you would change. Then wait. Only if they say yes in their next message, call it again with how: agreed, the same leaning and the same pole. Never change a leaning on your own inference. Each call moves one leaning one stop toward a pole, or back to rest. This is not set_register: \"be gentle with me today\" is today’s lean, and that is set_register; a lasting setting is this. Then answer them as they asked.",
  "parameters": {
    "type": "object",
    "properties": {
      "leaning": {
        "type": "string",
        "enum": [
          "abstraction",
          "devotion",
          "directness",
          "encouragement",
          "length",
          "warmth",
          "pace",
          "questions",
          "imagery",
          "playfulness",
          "formality"
        ],
        "description": "Which leaning, with its two poles: abstraction (Philosophical ↔ Grounded and practical); devotion (Spiritual and devotional ↔ Secular and plain); directness (Gentle ↔ Direct, and further, challenging); encouragement (Encouraging ↔ Neutral and unsentimental); length (Verbose and exploratory ↔ Concise and spare); warmth (Empathetic and warm ↔ Cool and analytical); pace (Energetic ↔ Slow and spacious); questions (Question-led ↔ Guidance-led); imagery (Story and metaphor ↔ Literal); playfulness (Playful ↔ Serious); formality (Formal ↔ Familiar)."
      },
      "toward": {
        "type": "string",
        "enum": [
          "Philosophical",
          "Grounded and practical",
          "Spiritual and devotional",
          "Secular and plain",
          "Gentle",
          "Direct, and further, challenging",
          "Encouraging",
          "Neutral and unsentimental",
          "Verbose and exploratory",
          "Concise and spare",
          "Empathetic and warm",
          "Cool and analytical",
          "Energetic",
          "Slow and spacious",
          "Question-led",
          "Guidance-led",
          "Story and metaphor",
          "Literal",
          "Playful",
          "Serious",
          "Formal",
          "Familiar",
          "rest"
        ],
        "description": "One of the two poles of that leaning, exactly as written there, to move it one stop toward that pole; or rest, to put it back to her voice unshaded."
      },
      "how": {
        "type": "string",
        "enum": [
          "asked",
          "proposed",
          "agreed"
        ],
        "description": "asked: they asked for this change themselves, without you suggesting it. proposed: you are suggesting it; nothing changes. agreed: you proposed it in your last reply, and they have just said yes."
      }
    },
    "required": [
      "leaning",
      "toward",
      "how"
    ]
  }
}
$json$::jsonb,
  'internal',
  'SetLeaningCapability',
  10,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_capability" WHERE "slug" = 'set_leaning'
);

-- The grant belongs to the guide's org (Sunrise §107), as the tenancy client
-- would stamp it; `ai_capability` is install-wide and carries none.
INSERT INTO "ai_agent_capability" ("id", "agentId", "capabilityId", "isEnabled", "orgId")
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), a."id", c."id", true, a."orgId"
FROM "ai_agent" AS a
CROSS JOIN "ai_capability" AS c
WHERE a."slug" = 'lelanea-guide'
  AND a."deletedAt" IS NULL
  AND c."slug" = 'set_leaning'
  AND NOT EXISTS (
    SELECT 1 FROM "ai_agent_capability" AS g
    WHERE g."agentId" = a."id" AND g."capabilityId" = c."id"
  );
