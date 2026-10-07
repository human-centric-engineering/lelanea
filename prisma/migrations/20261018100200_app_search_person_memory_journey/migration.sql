-- f-journey-record t-149, review round 1 — `search_person_memory`'s published
-- definition names the journey record's two new kinds of result.
--
-- t-149 made the tool return what the person kept in their journey: an entry
-- they wrote, and an account of a session they kept. The description the model
-- reads still said every result was "their own words or a note", and told it to
-- quote their words back as theirs, which invites quoting a kept account (often
-- the synopsis seat's draft, kept as written) as something they said.
--
-- WHAT IT WRITES: the code-owned `functionDefinition`, only while it is still
-- exactly what 20261009100000_app_search_person_memory_capability inserted. An
-- operator's edited definition is theirs (fp4). Seed 024's `update` branch
-- re-applies the same literal on every seed run; this is for the environments
-- that never run the seed (`.context/app/database-changes.md`).
-- `tests/unit/prisma/migrations/search-person-memory-capability.test.ts` pins
-- the `from` to the earlier migration's INSERT and the `to` to the class.
--
-- No schema change. Apply with `npm run db:migrate:deploy`.

SELECT set_config('app.bypass_rls', 'on', true);

UPDATE "ai_capability"
SET "functionDefinition" = $definition_to${
  "name": "search_person_memory",
  "description": "Search what this person has said to you before, the notes kept about them, and what they kept in their journey, by meaning. Call it when they mention someone or something they may have spoken about before, or when remembering it would help you meet them now. Each result says what it is (their own words, a note, something they wrote in their journey, or an account of a session they kept), when, and how to use it. Quote their words, and what they wrote, back only as theirs, never as yours or as Lela\u00f1ea\u2019s material. A note is your understanding of them, and an account they kept is what they hold true of a session: neither is something they said word for word. If nothing comes back, do not claim to remember.",
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
}$definition_to$::jsonb
WHERE "slug" = 'search_person_memory'
  AND "functionDefinition"::jsonb = $definition_from${
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
}$definition_from$::jsonb;
