-- The resource kinds are video, audio and article — never "film" or
-- "reading" (owner ruling, 24 Sept 2026: resources are videos, audio and
-- articles, in every word the product, the admin and the AI use).
--
-- WHAT IT MOVES, on every database that already exists, and only rows still
-- at the old value (`.context/app/database-changes.md`):
--
--   1. `app_resource.kind` and `app_resource_revision.kind`: `film` becomes
--      `video`, `reading` becomes `article`. A rename of the stored
--      vocabulary, not an edit of anyone's content, so no revision is written
--      and no revision number moves: an admin mid-edit is not refused for a
--      change they cannot see. History is renamed with the rows, so an old
--      revision still reads back through `toResource`. `audio` is new and
--      has no rows to move.
--
--   2. `app_resource_collection`: the seeded title and provenance note, which
--      named films and reading, where an admin has not already changed them.
--      `resources.test.ts` pins these literals to the seed file.
--
--   3. `ai_capability` for `suggest_resource`: the `functionDefinition` the
--      model reads and the operator `description`, each only while it is
--      still exactly what `20260927100000_app_suggest_resource_capability`
--      inserted. An admin's edited description is theirs (fp4). The
--      code-owned definition is also re-applied by seed 014 on every seed run;
--      this is for the environments that never run the seed.
--
-- The row itself, for a database without it, is established by the next
-- migration, `20261001100100_app_suggest_resource_capability_kinds`.

UPDATE "app_resource" SET "kind" = 'video' WHERE "kind" = 'film';
UPDATE "app_resource" SET "kind" = 'article' WHERE "kind" = 'reading';
UPDATE "app_resource_revision" SET "kind" = 'video' WHERE "kind" = 'film';
UPDATE "app_resource_revision" SET "kind" = 'article' WHERE "kind" = 'reading';

UPDATE "app_resource_collection"
SET "title" = $title_to$Lelañea — videos, audio and articles, in her own words$title_to$
WHERE "title" = $title_from$Lelañea — films and reading, in her own words$title_from$;

UPDATE "app_resource_collection"
SET "provenance" = jsonb_set("provenance"::jsonb, '{note}', to_jsonb($note_to$The shape of the resources drawer (f-resources t-74). The two passages here are verbatim excerpts of her authored material, chosen by the builder as a starting point and awaiting her confirmation or replacement; the video, audio and article lists are empty because no video or audio of hers exists yet and only she can say which pieces belong beside which module. Her list lands in t-76.$note_to$::text))
WHERE "provenance"::jsonb ->> 'note' = $note_from$The shape of the resources drawer (f-resources t-74). The two passages here are verbatim excerpts of her authored material, chosen by the builder as a starting point and awaiting her confirmation or replacement; the film and reading lists are empty because no film of hers exists yet and only she can say which pieces belong beside which module. Her list lands in t-76.$note_from$;

UPDATE "ai_capability"
SET "functionDefinition" = $definition_to${
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
}$definition_to$::jsonb
WHERE "slug" = 'suggest_resource'
  AND "functionDefinition"::jsonb = $definition_from${
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
}$definition_from$::jsonb;

UPDATE "ai_capability"
SET "description" = 'Hands the person one of Lelañea Fulton’s videos, audio or articles, by id, when it fits what they are working through. Read-only: the library answers with its own words.'
WHERE "slug" = 'suggest_resource'
  AND "description" = 'Hands the person one of Lelañea Fulton’s films or pieces of writing, by id, when it fits what they are working through. Read-only: the library answers with its own words.';
