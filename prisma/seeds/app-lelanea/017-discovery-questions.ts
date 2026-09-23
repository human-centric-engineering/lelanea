/**
 * The onboarding module's discovery questions, loaded into the tables the
 * content API reads, once (f-content-seeds t-87).
 *
 * Fills `app_question_set`, `app_discovery_question` and each one's revision 1
 * (`origin: seed`) from `content/onboarding_discovery_questions.json`.
 *
 * **Operator-owned**, written once and never again; the rule is in
 * `seedDiscoveryQuestions` (`lib/app/content/question-store.ts`). **In practice
 * this writes nothing**: the data migration
 * `20260928100100_app_journey_questions_resources_data` inserts the same rows,
 * pinned to `buildQuestionSeed()` by `question-seed.test.ts`. Safe on empty,
 * idempotent, and no `hashInputs` over the JSON, for the reasons
 * `016-journey-structure.ts` gives.
 *
 * Runs after 016: the set names its module, and the foreign key needs the row.
 */

import type { SeedUnit } from '@/prisma/runner';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';

const unit: SeedUnit = {
  name: 'app-lelanea/017-discovery-questions',
  async run({ prisma, logger }) {
    const seed = buildQuestionSeed();
    const result = await seedDiscoveryQuestions(seed, prisma);

    if (result.status === 'skipped') {
      logger.info(
        `⏭  Discovery questions already in the database (${result.questions}); left as they are`
      );
      return;
    }
    logger.info(
      `❓ Seeded ${result.questions} discovery questions at version ${seed.set.version}, each at revision 1`
    );
  },
};

export default unit;
