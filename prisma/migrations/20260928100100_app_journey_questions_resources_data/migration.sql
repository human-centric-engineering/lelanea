-- f-content-seeds t-87: the journey's text, the discovery questions and the
-- resource library, written into the tables
-- `20260928100000_app_journey_questions_resources` created, so that every
-- environment has them the moment it migrates.
--
-- WHY A MIGRATION AND NOT ONLY THE SEED (owner rule, 22 September 2026;
-- `.context/app/database-changes.md`). Production runs `db:migrate:deploy`
-- before every start and runs the seeder only when someone asks. From t-87 the
-- map drawer, every module page, the home page, three content routes and every
-- conversation turn read these tables, so an environment that migrated but was
-- not seeded would fail on all of them. The seed units
-- (`prisma/seeds/app-lelanea/016-journey-structure.ts`,
-- `017-discovery-questions.ts`, `018-resources.ts`) write the same rows and are
-- written to find them here and do nothing.
--
-- WHAT IT WRITES is exactly what the seeds write. The three JSON literals below
-- are `buildJourneySeed()`, `buildQuestionSeed()` and `buildResourcesSeed()`
-- (`lib/app/content/*-seed.ts`), generated from
-- `content/lelanea_module_structure.json`,
-- `content/onboarding_discovery_questions.json` and
-- `seed-data/drafted/lelanea_resources.json`. A test per collection parses its
-- literal back out of this file and fails if it differs from what the seed
-- would write today.
--
-- Rows are operator-owned (`fp4`), so each insert runs only while its table is
-- empty. Every row gets revision 1 with `origin = 'seed'` and a null
-- `editorId`, because the operator wrote it, not a person. Revision ids are
-- UUIDs, as in `20260927100100_app_foundational_documents_data`: the column is
-- TEXT, nothing parses it, and no admin route takes it as a path parameter.
--
-- A JSON `null` in a nullable JSON column is written as SQL NULL (`NULLIF`),
-- which is what Prisma writes for the seed's `null`.
--
-- Runs after `20260927100100_app_foundational_documents_data`: a reading may
-- name one of her documents, and the foreign key needs the row.
--
-- Data only: no schema diff. Apply with `npm run db:migrate:deploy`, then
-- `npm run db:drift-check`.

-- ============================================================================
-- The journey's text
-- ============================================================================

CREATE TEMP TABLE "_t87_journey" AS SELECT $t87journey${"journey":{"id":"Lelañea","title":"The Lelañea App Journey","subtitle":"A guided path from inner foundations to expanded consciousness","version":"1.0","locale":"en-US"},"tiers":[{"id":"onboarding","label":"Onboarding","intent":"Welcome, orientation, consent, and the first meeting with the guide."},{"id":"foundations","label":"Foundations","intent":"Establish the inner compass, the lines that protect it, the bar it is held to, and who is holding it."},{"id":"inner_authority","label":"Inner Authority","intent":"Move from externally granted permission to internally held authority."},{"id":"embodied_relationship","label":"Embodied Relationship","intent":"Bring the work into the body and into contact with other people."},{"id":"integration_and_expansion","label":"Integration & Expansion","intent":"The Spiritual Oneness arc, where Lelañea's own original frameworks emerge."}],"modules":[{"id":"module_00_onboarding","displayNumber":"00","title":"Onboarding","subtitle":null,"chartTitle":null,"phases":[{"number":1,"displayNumber":"01","title":"The Initiation","description":"The welcome statement. Frames Lelañea as an invitation rather than an app, and introduces the guide.","contentRef":"the_initiation","proposed":false,"phaseTier":null,"questionCount":null,"personalized":true,"requiresAcknowledgement":false,"produces":null},{"number":2,"displayNumber":"02","title":"The Heart Behind Lelañea","description":"The intent and philosophy: remembering rather than improving; lowercase self and capital Self.","contentRef":"the_heart_behind_lelanea","proposed":false,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":3,"displayNumber":"03","title":"The Mission","description":"Why the app exists: making transcendental coaching accessible regardless of financial means.","contentRef":"the_mission","proposed":false,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":4,"displayNumber":"04","title":"About the Creator","description":"Lelañea Fulton's background, training, and lineage of study.","contentRef":"about_the_creator","proposed":false,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":5,"displayNumber":"05","title":"The Lineage of Lelañea","description":"Acknowledgement of the traditions, teachers, and research the work draws on.","contentRef":"the_lineage_of_lelanea","proposed":false,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":6,"displayNumber":"06","title":"What It Is, What It Is Not","description":"The disclaimer: educational and contemplative, not healthcare, not crisis support.","contentRef":"disclaimer","proposed":false,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":true,"produces":null},{"number":7,"displayNumber":"07","title":"Terms of Use","description":"Legal agreement, accepted before the journey begins.","contentRef":"terms_of_use","proposed":false,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":true,"produces":null},{"number":8,"displayNumber":"08","title":"Discovery Questions","description":"Thirty long-form self-examination questions on ego and Higher Self, individuality, purpose, conditioning, memory, love, prayer, and transcendence. Establishes the user's starting point.","contentRef":"onboarding_discovery_questions","proposed":false,"phaseTier":null,"questionCount":30,"personalized":false,"requiresAcknowledgement":false,"produces":{"artifact":"discovery_baseline","revisitable":true}},{"number":9,"displayNumber":"09","title":"Begin the Journey","description":"Hand-off into Module 01. Sets expectations for pace, journaling, and returning check-ins.","contentRef":null,"proposed":true,"phaseTier":null,"questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null}],"phaseTiers":null,"produces":null},{"id":"module_01_values","displayNumber":"01","title":"Values","subtitle":"From inherited definitions to an embodied, consciously chosen inner compass","chartTitle":"Module 01 | Values","phases":[{"number":1,"displayNumber":"01","title":"Enter the Values Module","description":"Frame values as an inner compass, not goals.","contentRef":null,"proposed":false,"phaseTier":"orientation","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":2,"displayNumber":"02","title":"Understand Values","description":"Psychological lens: beliefs, identity, decisions, and behavior.","contentRef":null,"proposed":false,"phaseTier":"orientation","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":3,"displayNumber":"03","title":"Expand the Lens","description":"Spiritual + energetic perspectives: purpose, coherence, resonance, and alignment.","contentRef":null,"proposed":false,"phaseTier":"orientation","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":4,"displayNumber":"04","title":"Why Values Matter","description":"Centered living vs. inherited “default settings” and external conditioning.","contentRef":null,"proposed":false,"phaseTier":"orientation","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":5,"displayNumber":"05","title":"Values Inventory","description":"Explore the full values library and notice what resonates.","contentRef":null,"proposed":false,"phaseTier":"discernment","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":6,"displayNumber":"06","title":"Color-Code the Self","description":"Green = confirmed • Yellow = wavering • Red = release • Purple = future self.","contentRef":null,"proposed":false,"phaseTier":"discernment","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":7,"displayNumber":"07","title":"Question the Inherited","description":"Examine yellow + red values: family, culture, safety, belonging, and past survival.","contentRef":null,"proposed":false,"phaseTier":"discernment","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":8,"displayNumber":"08","title":"Meet the Becoming Self","description":"Explore purple values and the qualities the user wants to embody next.","contentRef":null,"proposed":false,"phaseTier":"discernment","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":9,"displayNumber":"09","title":"Choose the Core","description":"Narrow to Top 10 extended values, then Top 5 core values.","contentRef":null,"proposed":false,"phaseTier":"integration","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":10,"displayNumber":"10","title":"Alignment Audit","description":"Test values across relationships, self, career, home, family, habits, beliefs, and choices.","contentRef":null,"proposed":false,"phaseTier":"integration","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":11,"displayNumber":"11","title":"Reflect + Embody","description":"Journal, somatic pause, letting go, gratitude, and integration.","contentRef":null,"proposed":false,"phaseTier":"integration","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null},{"number":12,"displayNumber":"12","title":"Save the Values Baseline","description":"Store core values + reflections so the app can revisit shifts over time.","contentRef":null,"proposed":false,"phaseTier":"integration","questionCount":null,"personalized":false,"requiresAcknowledgement":false,"produces":null}],"phaseTiers":[{"id":"orientation","label":"Orientation","order":1,"phases":[1,2,3,4]},{"id":"discernment","label":"Discernment","order":2,"phases":[5,6,7,8]},{"id":"integration","label":"Integration","order":3,"phases":[9,10,11,12]}],"produces":{"artifact":"values_profile","revisitable":true,"contents":["color_coded_selections","top_10_extended_values","top_5_core_values","reflection_responses"]}},{"id":"module_02_boundaries","displayNumber":"02","title":"Boundaries","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_03_standards","displayNumber":"03","title":"Standards","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_04_the_self","displayNumber":"04","title":"The self","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_05_kindness_vs_nice","displayNumber":"05","title":"Kindness vs. Nice","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_06_discernment_vs_judgment","displayNumber":"06","title":"Discernment vs. Judgment","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_07_morals_and_integrity","displayNumber":"07","title":"Morals & Integrity","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_08_my_lotus_of_life","displayNumber":"08","title":"My Lotus of Life","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_09_nervous_system","displayNumber":"09","title":"Nervous System","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_10_capacity","displayNumber":"10","title":"Capacity","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_11_curiosity_of_self","displayNumber":"11","title":"Curiosity of self (work of Byron Katie)","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_12_communication","displayNumber":"12","title":"Communication","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_13_consciousness_hawkins_scale","displayNumber":"13","title":"Consciousness: Dr. Hawkins’ Scale","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_14_shadow_work","displayNumber":"14","title":"Shadow Work","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_15_dogma_of_reality","displayNumber":"15","title":"Dogma of Reality","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null},{"id":"module_16_oneness","displayNumber":"16","title":"Oneness","subtitle":null,"chartTitle":null,"phases":[],"phaseTiers":null,"produces":null}]}$t87journey$::jsonb AS "s";

INSERT INTO "app_journey" ("id", "title", "subtitle", "version", "locale", "createdAt", "updatedAt")
SELECT
  "s"->'journey'->>'id',
  "s"->'journey'->>'title',
  "s"->'journey'->>'subtitle',
  "s"->'journey'->>'version',
  "s"->'journey'->>'locale',
  now(),
  now()
FROM "_t87_journey"
WHERE NOT EXISTS (SELECT 1 FROM "app_journey");

INSERT INTO "app_journey_tier" ("id", "journeyId", "label", "intent", "revision", "createdAt", "updatedAt")
SELECT "t"->>'id', "s"->'journey'->>'id', "t"->>'label', "t"->>'intent', 1, now(), now()
FROM "_t87_journey", jsonb_array_elements("s"->'tiers') AS "t"
WHERE NOT EXISTS (SELECT 1 FROM "app_journey_tier");

INSERT INTO "app_journey_module" (
  "id", "journeyId", "displayNumber", "title", "subtitle", "chartTitle", "phases",
  "phaseTiers", "produces", "revision", "createdAt", "updatedAt"
)
SELECT
  "m"->>'id',
  "s"->'journey'->>'id',
  "m"->>'displayNumber',
  "m"->>'title',
  "m"->>'subtitle',
  "m"->>'chartTitle',
  "m"->'phases',
  NULLIF("m"->'phaseTiers', 'null'::jsonb),
  NULLIF("m"->'produces', 'null'::jsonb),
  1,
  now(),
  now()
FROM "_t87_journey", jsonb_array_elements("s"->'modules') AS "m"
WHERE NOT EXISTS (SELECT 1 FROM "app_journey_module");

INSERT INTO "app_journey_tier_revision" (
  "id", "tierId", "revision", "label", "intent", "changedFields", "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "t"."id", 1, "t"."label", "t"."intent",
  ARRAY['label', 'intent'], 'seed', NULL, now()
FROM "app_journey_tier" AS "t"
WHERE "t"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_journey_tier_revision" AS "r" WHERE "r"."tierId" = "t"."id");

INSERT INTO "app_journey_module_revision" (
  "id", "moduleId", "revision", "displayNumber", "title", "subtitle", "chartTitle",
  "phases", "phaseTiers", "produces", "changedFields", "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "m"."id", 1, "m"."displayNumber", "m"."title", "m"."subtitle",
  "m"."chartTitle", "m"."phases", "m"."phaseTiers", "m"."produces",
  ARRAY['displayNumber', 'title', 'subtitle', 'chartTitle', 'phases', 'phaseTiers', 'produces'],
  'seed', NULL, now()
FROM "app_journey_module" AS "m"
WHERE "m"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_journey_module_revision" AS "r" WHERE "r"."moduleId" = "m"."id");

DROP TABLE "_t87_journey";

-- ============================================================================
-- The discovery questions
-- ============================================================================

CREATE TEMP TABLE "_t87_questions" AS SELECT $t87questions${"set":{"id":"onboarding_discovery_questions","title":"Discovery Questions","chartTitle":"‘Lelañea’ Coach App Discovery Onboarding Questions","moduleId":"module_00_onboarding","phase":8,"preamble":{"style":"italic","text":"These questions are not meant to be rushed. Please take your time to sit in each one and deepen into the experience of self-examination. The only “correct” answer is the one that comes from a clear lens of self-awareness and accountability. These answers are from you and for you."},"pacing":{"rushDiscouraged":true,"allowPartialCompletion":true,"note":"The preamble explicitly asks the user not to rush. A single sitting of thirty long-form questions runs against that; the set should be resumable."},"version":"1.0","locale":"en-US"},"questions":[{"id":"q01","number":1,"text":"In your experience, who or what is your ego, and are you able to differentiate between the Higher Self and the lower self, or ego?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q02","number":2,"text":"How does your ego express itself?","inputType":"long_text","hint":"i.e. behaviors, thoughts, beliefs, stories?","conditionalFollowUp":null},{"id":"q03","number":3,"text":"How does your Higher Self express itself?","inputType":"long_text","hint":"i.e. behaviors, thoughts, beliefs, stories?","conditionalFollowUp":null},{"id":"q04","number":4,"text":"Are there times that you feel connected to everyone and everything around you?","inputType":"long_text","hint":null,"conditionalFollowUp":{"ifYes":"Please describe these experiences.","ifNo":"How do you imagine it would feel if you did have such experiences?"}},{"id":"q05","number":5,"text":"What does “individuality” mean to you, and in what ways are you an individual?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q06","number":6,"text":"What does your “individual self” have in common with other individuals? What makes you completely and utterly unique? In what ways are you not unique?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q07","number":7,"text":"What does it mean to “have a purpose”? What does “purpose” look like? Are there examples of purpose?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q08","number":8,"text":"Please list any “limiting beliefs” that you recognize are stopping you from a full and expansive human experience.","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q09","number":9,"text":"What “spiritual” practices do you have that serve as a connection to that which is beyond the self? A higher power, a universal consciousness, to nature and the heartbeat of the planet?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q10","number":10,"text":"What do you like or enjoy most about being a living, breathing human having a material experience?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q11","number":11,"text":"What have you disliked most about being a living, breathing human having a material experience?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q12","number":12,"text":"What’s the hardest part about being you in this lifetime?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q13","number":13,"text":"What would you like to change or experience in this lifetime?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q14","number":14,"text":"Does societal and cultural content influence how you see or experience yourself? What story does each of these tell you about yourself?","inputType":"long_text","hint":"i.e. social media content, Hollywood, pop culture, music, political affiliations, religious affiliations, your family of origin, your profession, your relationships.","conditionalFollowUp":null},{"id":"q15","number":15,"text":"How does your body feel when you are on social media platforms?","inputType":"long_text","hint":"If you are unsure, go three days with no social media and then log on and explore what feelings occur in your body, and what stories your mind begins to express.","conditionalFollowUp":null},{"id":"q16","number":16,"text":"Do you know what personal values are directing you in how you move through the world? Are these your values or learned values? How did you come upon these values?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q17","number":17,"text":"What is your earliest childhood memory?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q18","number":18,"text":"What is your favorite childhood memory? Has this memory impacted or influenced how you experience the world?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q19","number":19,"text":"If you could change one thing about your life that would create a massive ripple effect impacting all areas of your life, what would it be? What is keeping you from making this change now?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q20","number":20,"text":"What does it mean to “be Love”? How does Love move through the world? What times in your life are you moving from a place of Love, and how does it affect those you interact with? What times in your life are you not moving through the world as Love, and how has it impacted those around you?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q21","number":21,"text":"What does the word “prayer” mean to you? Is it only affiliated with religion? What does it mean to move through the world from a place of prayer?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q22","number":22,"text":"Let’s pretend you will have another life after this one, as another human. How would you like that life to look and feel? What would you like to have access to in this next life? Who would you be? What purpose would you have?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q23","number":23,"text":"What does “material world” mean to you? What does “spiritual world” mean to you?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q24","number":24,"text":"What are examples of a “material experience”?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q25","number":25,"text":"Have you had an experience where you were able to distance yourself from the material human experience and recognize something greater and grander?","inputType":"long_text","hint":null,"conditionalFollowUp":{"ifYes":"Please describe this.","ifNo":"What do you imagine this would feel and look like?"}},{"id":"q26","number":26,"text":"Who do you want to be by the end of your journey via this Inner Work App?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q27","number":27,"text":"What does it mean to “transcend” the self?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q28","number":28,"text":"What parts of your ego or self are you most willing to let go of, and why?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q29","number":29,"text":"What parts of your ego or self would you like to explore and refine?","inputType":"long_text","hint":null,"conditionalFollowUp":null},{"id":"q30","number":30,"text":"What parts of your ego or self are absolutely perfect and deserve to be celebrated?","inputType":"long_text","hint":null,"conditionalFollowUp":null}]}$t87questions$::jsonb AS "s";

INSERT INTO "app_question_set" (
  "id", "title", "chartTitle", "moduleId", "phase", "preamble", "pacing", "version",
  "locale", "revision", "createdAt", "updatedAt"
)
SELECT
  "s"->'set'->>'id',
  "s"->'set'->>'title',
  "s"->'set'->>'chartTitle',
  "s"->'set'->>'moduleId',
  ("s"->'set'->>'phase')::int,
  "s"->'set'->'preamble',
  "s"->'set'->'pacing',
  "s"->'set'->>'version',
  "s"->'set'->>'locale',
  1,
  now(),
  now()
FROM "_t87_questions"
WHERE NOT EXISTS (SELECT 1 FROM "app_question_set");

INSERT INTO "app_discovery_question" (
  "id", "setId", "number", "text", "inputType", "hint", "conditionalFollowUp", "revision",
  "createdAt", "updatedAt"
)
SELECT
  "q"->>'id',
  "s"->'set'->>'id',
  ("q"->>'number')::int,
  "q"->>'text',
  "q"->>'inputType',
  "q"->>'hint',
  NULLIF("q"->'conditionalFollowUp', 'null'::jsonb),
  1,
  now(),
  now()
FROM "_t87_questions", jsonb_array_elements("s"->'questions') AS "q"
WHERE NOT EXISTS (SELECT 1 FROM "app_discovery_question");

INSERT INTO "app_question_set_revision" (
  "id", "setId", "revision", "title", "chartTitle", "phase", "preamble", "pacing", "version",
  "locale", "changedFields", "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "q"."id", 1, "q"."title", "q"."chartTitle", "q"."phase",
  "q"."preamble", "q"."pacing", "q"."version", "q"."locale",
  ARRAY['title', 'chartTitle', 'phase', 'preamble', 'pacing', 'version', 'locale'],
  'seed', NULL, now()
FROM "app_question_set" AS "q"
WHERE "q"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_question_set_revision" AS "r" WHERE "r"."setId" = "q"."id");

INSERT INTO "app_discovery_question_revision" (
  "id", "questionId", "revision", "number", "text", "inputType", "hint",
  "conditionalFollowUp", "changedFields", "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "q"."id", 1, "q"."number", "q"."text", "q"."inputType", "q"."hint",
  "q"."conditionalFollowUp",
  ARRAY['number', 'text', 'inputType', 'hint', 'conditionalFollowUp'],
  'seed', NULL, now()
FROM "app_discovery_question" AS "q"
WHERE "q"."revision" = 1
  AND NOT EXISTS (
    SELECT 1 FROM "app_discovery_question_revision" AS "r" WHERE "r"."questionId" = "q"."id"
  );

DROP TABLE "_t87_questions";

-- ============================================================================
-- The resource library
-- ============================================================================

CREATE TEMP TABLE "_t87_resources" AS SELECT $t87resources${"collection":{"id":"lelanea_resources","title":"Lelañea — films and reading, in her own words","version":"0.1","locale":"en-US","provenance":{"status":"draft","awaitingSignOffFrom":"Lelañea Fulton","note":"The shape of the resources drawer (f-resources t-74). The two passages here are verbatim excerpts of her authored material, chosen by the builder as a starting point and awaiting her confirmation or replacement; the film and reading lists are empty because no film of hers exists yet and only she can say which pieces belong beside which module. Her list lands in t-76."}},"resources":[],"words":[{"key":"module_01_values","quote":"If you don't shape your values, the world will shape them for you.","paragraphs":["When you know your values deeply — not as nice words on a wall, but as lived principles — you become centered, congruent, and grounded in your being.","You are no longer a sponge soaking up the expectations of the world. You become an anchor."],"sourceCollection":"values_module","sourceId":"lesson_centered_living"},{"key":"default","quote":"Whatever it is that brought you here, you listened.","paragraphs":["This is not simply an app.","It is an invitation.","An invitation to explore the relationship you have with yourself, your consciousness, and the magnificent intelligence that has always existed beneath the noise of the human experience."],"sourceCollection":"foundational_documents","sourceId":"the_initiation"}]}$t87resources$::jsonb AS "s";

INSERT INTO "app_resource_collection" (
  "id", "title", "version", "locale", "provenance", "createdAt", "updatedAt"
)
SELECT
  "s"->'collection'->>'id',
  "s"->'collection'->>'title',
  "s"->'collection'->>'version',
  "s"->'collection'->>'locale',
  "s"->'collection'->'provenance',
  now(),
  now()
FROM "_t87_resources"
WHERE NOT EXISTS (SELECT 1 FROM "app_resource_collection");

-- Empty today: the file ships no films and no readings (her list is t-76). The
-- statement is here so the migration writes exactly what the seed would.
INSERT INTO "app_resource" (
  "id", "collectionId", "kind", "position", "title", "subtitle", "relatesTo", "duration",
  "readingTime", "href", "documentId", "revision", "createdAt", "updatedAt"
)
SELECT
  "r"->>'id',
  "s"->'collection'->>'id',
  "r"->>'kind',
  ("r"->>'position')::int,
  "r"->>'title',
  "r"->>'subtitle',
  "r"->>'relatesTo',
  "r"->>'duration',
  "r"->>'readingTime',
  "r"->>'href',
  "r"->>'documentId',
  1,
  now(),
  now()
FROM "_t87_resources", jsonb_array_elements("s"->'resources') AS "r"
WHERE NOT EXISTS (SELECT 1 FROM "app_resource");

INSERT INTO "app_resource_words" (
  "key", "collectionId", "quote", "paragraphs", "sourceCollection", "sourceId", "revision",
  "createdAt", "updatedAt"
)
SELECT
  "w"->>'key',
  "s"->'collection'->>'id',
  "w"->>'quote',
  ARRAY(SELECT jsonb_array_elements_text("w"->'paragraphs')),
  "w"->>'sourceCollection',
  "w"->>'sourceId',
  1,
  now(),
  now()
FROM "_t87_resources", jsonb_array_elements("s"->'words') AS "w"
WHERE NOT EXISTS (SELECT 1 FROM "app_resource_words");

INSERT INTO "app_resource_revision" (
  "id", "resourceId", "revision", "kind", "position", "title", "subtitle", "relatesTo",
  "duration", "readingTime", "href", "documentId", "changedFields", "origin", "editorId",
  "changedAt"
)
SELECT
  gen_random_uuid()::text, "r"."id", 1, "r"."kind", "r"."position", "r"."title", "r"."subtitle",
  "r"."relatesTo", "r"."duration", "r"."readingTime", "r"."href", "r"."documentId",
  ARRAY['kind', 'position', 'title', 'subtitle', 'relatesTo', 'duration', 'readingTime', 'href', 'documentId'],
  'seed', NULL, now()
FROM "app_resource" AS "r"
WHERE "r"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_resource_revision" AS "v" WHERE "v"."resourceId" = "r"."id");

INSERT INTO "app_resource_words_revision" (
  "id", "wordsKey", "revision", "quote", "paragraphs", "sourceCollection", "sourceId",
  "changedFields", "origin", "editorId", "changedAt"
)
SELECT
  gen_random_uuid()::text, "w"."key", 1, "w"."quote", "w"."paragraphs", "w"."sourceCollection",
  "w"."sourceId",
  ARRAY['quote', 'paragraphs', 'sourceCollection', 'sourceId'],
  'seed', NULL, now()
FROM "app_resource_words" AS "w"
WHERE "w"."revision" = 1
  AND NOT EXISTS (SELECT 1 FROM "app_resource_words_revision" AS "v" WHERE "v"."wordsKey" = "w"."key");

DROP TABLE "_t87_resources";
