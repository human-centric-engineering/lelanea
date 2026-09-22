/**
 * The resource library — her films, her reading, and her words on each key —
 * loaded into the tables the drawer, the library route and the conversation
 * read, once (f-content-seeds t-87).
 *
 * Fills `app_resource_collection`, `app_resource`, `app_resource_words` and each
 * resource's and key's revision 1 (`origin: seed`) from
 * `seed-data/drafted/lelanea_resources.json`.
 *
 * **Operator-owned**, written once and never again; the rule is in
 * `seedResources` (`lib/app/content/resource-store.ts`), which also checks every
 * key against the modules in the database before writing. **In practice this
 * writes nothing**: the data migration
 * `20260928100100_app_journey_questions_resources_data` inserts the same rows,
 * pinned to `buildResourcesSeed()` by `resources-seed.test.ts`. Safe on empty,
 * idempotent, and no `hashInputs` over the JSON, for the reasons
 * `016-journey-structure.ts` gives.
 *
 * **Her list (t-76) is therefore a migration, not an edit to the file.** The
 * file ships with no films and no readings. Once this has written the library,
 * adding them to the file reaches only a database that was never seeded.
 *
 * Runs after 015 and 016: a reading names a document, and a key names a module.
 */

import type { SeedUnit } from '@/prisma/runner';
import { buildResourcesSeed } from '@/lib/app/content/resources-seed';
import { seedResources } from '@/lib/app/content/resource-store';

const unit: SeedUnit = {
  name: 'app-lelanea/018-resources',
  async run({ prisma, logger }) {
    const seed = buildResourcesSeed();
    const result = await seedResources(seed, prisma);

    if (result.status === 'skipped') {
      logger.info(
        `⏭  Resource library already in the database (${result.resources} resources, ` +
          `${result.words} keys of words); left as it is`
      );
      return;
    }
    logger.info(
      `🎞️  Seeded the resource library at version ${seed.collection.version}: ` +
        `${result.resources} films and readings, words for ${result.words} keys, each at revision 1`
    );
  },
};

export default unit;
