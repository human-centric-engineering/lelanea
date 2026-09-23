/**
 * Mirror her words about the work into the knowledge base (f-content-seeds t-90).
 *
 * Runs the one reconcile in `lib/app/content/knowledge-mirror.ts`. That module's
 * header says what is mirrored and why; this unit only decides when.
 *
 * **Why a seed unit at all.** `seedFoundationalDocuments` mirrors after it
 * writes, but on `db:reset` the documents arrive by migration and seed 015
 * writes nothing. So a fresh database gets its first mirror here. Production
 * gets it from the cron route, because production seeds only when asked.
 *
 * **Pure projection, fully reconciled (`fp4`).** The mirror is an index over
 * the rows, never edited in its own right, so this unit may create, re-ingest
 * and delete. It stays idempotent: in step, it writes nothing and makes no
 * embedding call.
 *
 * **It throws when a document fails**, typically when no embedding provider is
 * configured. The runner then records no `SeedHistory` row, so the next
 * `db:seed` tries again rather than marking a missing mirror as done. The
 * documents that succeeded stay mirrored.
 *
 * `hashInputs` folds in the mirror module, so a change to what is mirrored, or
 * how it is rendered, re-runs this unit on the next seed.
 */

import type { SeedUnit } from '@/prisma/runner';
import { reconcileKnowledgeMirror } from '@/lib/app/content/knowledge-mirror';

const unit: SeedUnit = {
  name: 'app-lelanea/020-knowledge-mirror',
  hashInputs: ['../../../lib/app/content/knowledge-mirror.ts'],
  async run({ logger }) {
    const result = await reconcileKnowledgeMirror();

    if (result.status === 'not_seeded') {
      throw new Error('No foundational documents to mirror. Seed 015 has not written them.');
    }
    if (result.failed.length > 0) {
      throw new Error(
        `Knowledge mirror failed for ${result.failed
          .map((failure) => `${failure.sourceKey} (${failure.error})`)
          .join('; ')}. The rest are mirrored; re-run "npm run db:seed" to retry.`
      );
    }

    logger.info(
      `🪞 Knowledge mirror: ${result.created.length} created, ${result.reingested.length} re-ingested, ` +
        `${result.designated.length} designated, ${result.removed.length} removed, ` +
        `${result.unchanged.length} unchanged`
    );
  },
};

export default unit;
