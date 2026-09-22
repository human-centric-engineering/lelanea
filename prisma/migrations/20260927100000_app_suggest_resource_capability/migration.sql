-- f-resources t-93 — the `suggest_resource` capability row, and its grant to
-- `lelanea-guide`, on every database that already exists.
--
-- WHY. t-77 (#89) gave the guide the tool through a seed unit,
-- `prisma/seeds/app-lelanea/014-suggest-resource.ts`. On a FRESH database that
-- is enough. On dev, preview and production it is not: the migrator runs before
-- every `web` start, while the seeder is opt-in (`docker-compose.prod.yml`,
-- `profiles: ['seed']`) and only runs when someone runs it. So after #89
-- deployed, the handler was registered in the code and the row was in no
-- database anyone was using — and a grant that never landed is a tool the agent
-- does not have, with nothing to say so: the dispatcher simply never advertises
-- it, and the guide answers as though the library were not there.
--
-- Owner rule, 22 Sept 2026: a change existing databases need ships as a
-- migration, never as a post-deploy step (`.context/app/database-changes.md`).
-- t-77's description carried "reseed after the merge"; that was the wrong
-- remedy and this is the right one.
--
-- THE SEED UNIT STAYS, BUT THIS TAKES OVER THE CREATE. Migrations run before
-- the seed — on `db:reset` as well as on a deploy — so from here on it is THIS
-- statement that first writes the capability row, and seed 014's `upsert` finds
-- it and takes its `update` branch. What the seed still owns is the half that
-- matters most: re-applying the CODE-OWNED fields (`functionDefinition`,
-- `executionType`, `executionHandler`) on every run — #545, so an existing row
-- never keeps advertising a schema the code has moved on from. This migration
-- does not do that job and must not: see below. The seed also still owns the
-- GRANT on a fresh database, where the guide does not exist yet when migrations
-- run.
--
-- SO DO NOT EDIT SEED 014's `create:` BRANCH ALONE. Its five operator-owned
-- literals (`name`, `description`, `category`, `rateLimit`, `isActive`) are
-- dead on a fresh database now — the row already exists by the time it runs —
-- and dead on an existing one, which took them from here. A change to any of
-- them belongs in BOTH, and a new migration for the databases already holding
-- the old value. `suggest-resource-capability.test.ts` pins the five equal, so
-- editing one alone fails rather than silently doing nothing.
--
-- WHAT IT WRITES — exactly what the seed's `create` branch writes, and only
-- where the row is absent:
--
--   1. `ai_capability` — one row for slug `suggest_resource`, active, a system
--      capability, carrying the same `functionDefinition` literal the seed and
--      the class both carry. `tests/unit/prisma/migrations/suggest-resource-capability.test.ts`
--      pins the JSON below to `SUGGEST_RESOURCE_DEFINITION`, so the three
--      copies cannot drift apart. `id` is a random UUID rather than a cuid —
--      the column is TEXT and nothing parses it (as `20260926100000`).
--   2. `ai_agent_capability` — the binding to the agent with slug
--      `lelanea-guide`, switched on, no `customConfig`: an id in, a library
--      record out, nothing to allow or deny.
--
-- WHAT IT LEAVES ALONE (`fp4`). Both statements insert only where nothing is
-- there. A capability row an admin renamed, rate-limited, quarantined or
-- switched off is theirs; a binding an operator switched off (`isEnabled =
-- false`) is theirs; neither is touched, and re-running this would write
-- nothing (Prisma never will). On a fresh database the tables are empty when
-- migrations run and the guide does not exist yet, so the first statement
-- writes the row and the second writes nothing — then the seed creates the
-- guide and unit 014 makes the grant. Either order ends in the same two rows.
--
-- ONE REVOCATION IT CANNOT SEE. The admin surface also revokes by DELETING the
-- binding (`DELETE /api/v1/admin/orchestration/agents/[id]/capabilities/
-- [capId]`), and a deleted row is indistinguishable from one that was never
-- created — so an operator who revoked that way is re-granted here, silently.
-- Nothing in SQL can tell the two apart; recording the revocation would need a
-- tombstone the schema does not have. Stated rather than solved because the
-- blast radius is small and known: no deployed database has ever held this row
-- (that is why this migration exists), so there is nowhere it could already
-- have been revoked, and seed unit 014 has behaved identically since #89 —
-- this migration adds no asymmetry, it inherits one. If a tombstone is ever
-- wanted, it belongs on the seed and the migration together.
--
-- WHERE THE GUIDE IS ABSENT, NOTHING IS GRANTED. A database that has the
-- platform but never seeded this app gets the capability row and no binding,
-- rather than a binding pointing at nothing. Unit 014 throws in that case
-- because a seed run that banked "the guide can suggest" for an agent that
-- cannot is worse than a failure; a migration cannot throw on a legitimately
-- unseeded database without blocking every deploy, so it declines quietly and
-- the seed remains the thing that insists.
--
-- No schema change, so nothing for `prisma migrate diff` to generate and no
-- unmodelled object for `db:drift-check` to miss.

-- The capability row. `$json$ … $json$` is dollar-quoted so the definition is
-- the literal JSON the code holds, with no SQL escaping in the way of reading
-- it back — which is what lets the test compare it to the constant.
INSERT INTO "ai_capability" (
  "id", "slug", "name", "description", "category",
  "functionDefinition", "executionType", "executionHandler",
  "rateLimit", "isActive", "isSystem"
)
SELECT
  gen_random_uuid()::text,
  'suggest_resource',
  'Suggest a resource',
  'Hands the person one of Lelañea Fulton’s films or pieces of writing, by id, when it fits what they are working through. Read-only: the library answers with its own words.',
  'app',
  $json${
  "name": "suggest_resource",
  "description": "Offer the person one of Lelañea’s films or pieces of writing, by its id, when it genuinely fits what they are working through right now. Use an id from the list of resources in your context — never invent one. Suggest one thing at a time, and only when it would help; most turns need none. The person sees the resource beside your reply and can open it.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The id of the film or reading, exactly as listed in your context.",
        "maxLength": 80
      }
    },
    "required": [
      "id"
    ]
  }
}$json$::jsonb,
  'internal',
  'SuggestResourceCapability',
  30,
  true,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM "ai_capability" WHERE "slug" = 'suggest_resource'
);

-- The grant. Reads the capability id back rather than assuming this migration
-- wrote it, so a database that already had the row still gets the binding.
INSERT INTO "ai_agent_capability" ("id", "agentId", "capabilityId", "isEnabled")
SELECT gen_random_uuid()::text, a."id", c."id", true
FROM "ai_agent" AS a
CROSS JOIN "ai_capability" AS c
WHERE a."slug" = 'lelanea-guide'
  AND a."deletedAt" IS NULL
  AND c."slug" = 'suggest_resource'
  AND NOT EXISTS (
    SELECT 1 FROM "ai_agent_capability" AS g
    WHERE g."agentId" = a."id" AND g."capabilityId" = c."id"
  );
