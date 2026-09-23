/**
 * The journey's text — tier labels and intents, module titles, subtitles and
 * phases — loaded into the tables every surface reads, once (f-content-seeds
 * t-87).
 *
 * Fills `app_journey`, `app_journey_tier`, `app_journey_module` and each tier's
 * and module's revision 1 (`origin: seed`) from
 * `content/lelanea_module_structure.json`. After this has run, the file is
 * reference material. Nothing reads it at request time.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Operator-owned**, written once while no journey row exists and never
 * again, so an admin edit (t-91) survives every later seed. The write-once rule
 * lives in the service (`seedJourneyStructure` in
 * `lib/app/content/journey-store.ts`), not here, so every writer is held to it.
 *
 * **In practice this writes nothing.** The data migration
 * `20260928100100_app_journey_questions_resources_data` inserts the same rows
 * (the JSON in it IS `buildJourneySeed()`, pinned by `journey-seed.test.ts`),
 * because production migrates on every start and seeds only when asked. It stays
 * as the write-once contract every writer is held to.
 *
 * **Safe on empty; idempotent.** No removal pass, and a second run reads one row
 * and writes none. No `hashInputs` over the JSON, on purpose: editing the file
 * must not re-run a unit that would do nothing while implying the edit landed.
 * A change existing databases need ships as a migration
 * (`.context/app/database-changes.md`).
 *
 * **It throws before writing anything if the file and the roster disagree**
 * about which modules exist, their numbers or their tiers.
 *
 * @see lib/app/content/seed-input/journey-seed.ts — the file, projected
 * @see lib/app/journey/roster.ts — the structure the text is joined with
 */

import type { SeedUnit } from '@/prisma/runner';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { seedJourneyStructure } from '@/lib/app/content/journey-store';

const unit: SeedUnit = {
  name: 'app-lelanea/016-journey-structure',
  async run({ prisma, logger }) {
    // Built first, even when the tables are already seeded, so a file that no
    // longer matches the roster is reported on every seed.
    const seed = buildJourneySeed();
    const result = await seedJourneyStructure(seed, prisma);

    if (result.status === 'skipped') {
      logger.info(
        `⏭  Journey already in the database (${result.tiers} tiers, ${result.modules} modules); left as it is`
      );
      return;
    }
    logger.info(
      `🧭 Seeded the journey's text at version ${seed.journey.version}: ` +
        `${result.tiers} tiers and ${result.modules} modules, each at revision 1`
    );
  },
};

export default unit;
