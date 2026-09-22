-- f-content-seeds t-88: the crisis resource, in every environment.
--
-- WHY THIS MIGRATION EXISTS AT ALL. t-88 removes the bundled-file fallback
-- from `lib/app/safety/resources-store.ts`. Before this, an environment that
-- had migrated `20260923100000_app_crisis_resources` (which creates the tables
-- and inserts nothing) but had never been asked to run the seeder served the
-- bundled file on every crisis turn and nobody noticed. With the fallback gone
-- it would serve NOTHING to a person in danger, with the app otherwise healthy.
--
-- Production runs `db:migrate:deploy` before every start and runs the seeder
-- only when someone asks (owner rule, 22 Sep 2026,
-- `.context/app/database-changes.md`). So the row has to arrive here.
--
-- WHAT IT WRITES is exactly what `010-crisis-resources.ts` writes, from
-- `seed-data/drafted/lelanea_crisis_resources.json`. A test parses the literal
-- back out of this file and fails if it differs from what the seed would write
-- today (`tests/unit/lib/app/safety/crisis-data-migration.test.ts`).
--
-- Rows are operator-owned (`fp4`): each insert runs only while its table is
-- empty, so an admin's edits and an admin's removal of a region are never
-- undone by a re-deploy. Seeded `draft` because the file's provenance says
-- draft — these words are awaiting sign-off, and a migration cannot grant it.
--
-- Data only: no schema diff. Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

CREATE TEMP TABLE "_t88_crisis" AS SELECT $t88crisis${
  "copy": {
    "hardIntro": "It sounds like you might be in real danger right now. You deserve support from a person, straight away — this app can't give you that, but these people can.",
    "softIntro": "If things feel like too much right now, you don't have to carry it alone. These people are there to talk, any time.",
    "emergency": "If you are in immediate danger, call your local emergency number now.",
    "keptMessage": "What you wrote is still in the box — nothing has been sent or lost.",
    "internationalName": "Find A Helpline",
    "internationalContact": "findahelpline.com",
    "internationalUrl": "https://findahelpline.com",
    "internationalHours": "A free directory of crisis lines in over 130 countries"
  },
  "status": "draft",
  "regions": [
    {
      "region": "GB",
      "emergencyNumber": "999",
      "services": [
        {
          "name": "Samaritans",
          "contact": "Call 116 123",
          "hours": "Free, 24 hours a day"
        },
        {
          "name": "Shout",
          "contact": "Text SHOUT to 85258",
          "hours": "Free, 24 hours a day"
        }
      ]
    },
    {
      "region": "IE",
      "emergencyNumber": "112 or 999",
      "services": [
        {
          "name": "Samaritans Ireland",
          "contact": "Call 116 123",
          "hours": "Free, 24 hours a day"
        },
        {
          "name": "Text About It",
          "contact": "Text HELLO to 50808",
          "hours": "Free, 24 hours a day"
        }
      ]
    },
    {
      "region": "US",
      "emergencyNumber": "911",
      "services": [
        {
          "name": "988 Suicide & Crisis Lifeline",
          "contact": "Call or text 988",
          "hours": "Free, 24 hours a day"
        },
        {
          "name": "Crisis Text Line",
          "contact": "Text HOME to 741741",
          "hours": "Free, 24 hours a day"
        }
      ]
    },
    {
      "region": "CA",
      "emergencyNumber": "911",
      "services": [
        {
          "name": "9-8-8 Suicide Crisis Helpline",
          "contact": "Call or text 988",
          "hours": "Free, 24 hours a day"
        }
      ]
    },
    {
      "region": "AU",
      "emergencyNumber": "000",
      "services": [
        {
          "name": "Lifeline",
          "contact": "Call 13 11 14",
          "hours": "24 hours a day"
        },
        {
          "name": "Beyond Blue",
          "contact": "Call 1300 22 4636",
          "hours": "24 hours a day"
        }
      ]
    },
    {
      "region": "NZ",
      "emergencyNumber": "111",
      "services": [
        {
          "name": "Need to talk?",
          "contact": "Call or text 1737",
          "hours": "Free, 24 hours a day"
        },
        {
          "name": "Lifeline Aotearoa",
          "contact": "Call 0800 543 354",
          "hours": "24 hours a day"
        }
      ]
    }
  ]
}$t88crisis$::jsonb AS "s";

-- The shared copy and the international directory. One row, keyed `global`.
INSERT INTO "app_crisis_copy" (
  "slug", "hardIntro", "softIntro", "emergency", "keptMessage",
  "internationalName", "internationalContact", "internationalUrl", "internationalHours",
  "status", "signedOffAt", "version", "createdAt", "updatedAt"
)
SELECT
  'global',
  "s"->'copy'->>'hardIntro',
  "s"->'copy'->>'softIntro',
  "s"->'copy'->>'emergency',
  "s"->'copy'->>'keptMessage',
  "s"->'copy'->>'internationalName',
  "s"->'copy'->>'internationalContact',
  "s"->'copy'->>'internationalUrl',
  "s"->'copy'->>'internationalHours',
  ("s"->>'status')::"app_crisis_content_status",
  NULL,
  1,
  now(),
  now()
FROM "_t88_crisis"
WHERE NOT EXISTS (SELECT 1 FROM "app_crisis_copy");

-- One row per region. `services` is stored as authored; the read validates it.
INSERT INTO "app_crisis_region" (
  "region", "emergencyNumber", "services", "status", "signedOffAt",
  "version", "createdAt", "updatedAt"
)
SELECT
  "r"->>'region',
  "r"->>'emergencyNumber',
  "r"->'services',
  ("s"->>'status')::"app_crisis_content_status",
  NULL,
  1,
  now(),
  now()
FROM "_t88_crisis", jsonb_array_elements("s"->'regions') AS "r"
WHERE NOT EXISTS (SELECT 1 FROM "app_crisis_region");

DROP TABLE "_t88_crisis";
