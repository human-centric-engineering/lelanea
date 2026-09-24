-- The `suggest_resource` capability row and its grant to `lelanea-guide`,
-- established with the resource kinds' words: videos, audio and articles
-- (owner ruling, 24 Sept 2026). Supersedes
-- `20260927100000_app_suggest_resource_capability` as the migration
-- `suggest-resource-capability.test.ts` pins to the code, and is otherwise
-- the same two guarded inserts: each only where the row is absent, so an
-- admin's edited row and an operator's switched-off binding are left alone.
-- On a database that already has the row it writes nothing; the previous
-- migration, `20261001100000_app_resource_kinds`, moved its words.
--
-- Why the id is cuid-shaped, why the definition is a `$json$` literal and
-- why the seed's `create` branch stays: see the 20260927100000 header.

INSERT INTO "ai_capability" (
  "id", "slug", "name", "description", "category",
  "functionDefinition", "executionType", "executionHandler",
  "rateLimit", "isActive", "isSystem"
)
SELECT
  'c' || replace(gen_random_uuid()::text, '-', ''),
  'suggest_resource',
  'Suggest a resource',
  'Hands the person one of Lelañea Fulton’s videos, audio or articles, by id, when it fits what they are working through. Read-only: the library answers with its own words.',
  'app',
  $json${
  "name": "suggest_resource",
  "description": "Offer the person one of Lelañea’s videos, audio or articles, by its id, when it genuinely fits what they are working through right now. Use an id from the list of resources in your context — never invent one. Suggest one thing at a time, and only when it would help; most turns need none. The person sees the resource beside your reply and can open it.",
  "parameters": {
    "type": "object",
    "properties": {
      "id": {
        "type": "string",
        "description": "The id of the video, audio or article, exactly as listed in your context.",
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

INSERT INTO "ai_agent_capability" ("id", "agentId", "capabilityId", "isEnabled")
SELECT 'c' || replace(gen_random_uuid()::text, '-', ''), a."id", c."id", true
FROM "ai_agent" AS a
CROSS JOIN "ai_capability" AS c
WHERE a."slug" = 'lelanea-guide'
  AND a."deletedAt" IS NULL
  AND c."slug" = 'suggest_resource'
  AND NOT EXISTS (
    SELECT 1 FROM "ai_agent_capability" AS g
    WHERE g."agentId" = a."id" AND g."capabilityId" = c."id"
  );
