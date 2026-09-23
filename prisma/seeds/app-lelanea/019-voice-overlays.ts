/**
 * The context-selected voice overlays, loaded into the tables the voice path
 * reads, once (f-content-seeds t-88).
 *
 * Fills `app_voice_overlay_set`, `app_voice_overlay` and each one's revision 1
 * (`origin: seed`) from `seed-data/drafted/lelanea_voice_overlays.json`.
 *
 * **Operator-owned, and this is the change t-88 makes.** The rule is in
 * `seedVoiceOverlays` (`lib/app/content/voice-overlay-store.ts`): written once
 * and never again, so the first admin edit in t-92 is not undone by the next
 * boot. That is the opposite call from `003-voice-fingerprint`, which
 * reconciles the always-on core onto the agent profile on every run — and the
 * difference is that the core has no editable surface yet, while these rows
 * are about to get one.
 *
 * **In practice this writes nothing**: the data migration
 * `20260929100100_app_voice_overlays_data` inserts the same rows, pinned to
 * `buildVoiceOverlaySeed()` by `voice-overlay-seed.test.ts`. Safe on empty,
 * idempotent, and no `hashInputs` over the JSON, for the reasons
 * `016-journey-structure.ts` gives.
 *
 * Every row is seeded `draft`. The file was drafted in her register rather
 * than transcribed from her, and nothing here may claim she has signed it off.
 */

import type { SeedUnit } from '@/prisma/runner';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { seedVoiceOverlays } from '@/lib/app/content/voice-overlay-store';

const unit: SeedUnit = {
  name: 'app-lelanea/019-voice-overlays',
  async run({ prisma, logger }) {
    // Built first, even when the tables are already seeded, so a file that no
    // longer parses is reported on every seed.
    const seed = buildVoiceOverlaySeed();
    const result = await seedVoiceOverlays(seed, prisma);

    if (result.status === 'skipped') {
      logger.info(
        `⏭  Voice overlays already in the database (${result.overlays}); left as they are`
      );
      return;
    }
    logger.info(
      `🎭 Seeded ${result.overlays} voice overlays at version ${seed.set.version}, each at revision 1 and draft`
    );
  },
};

export default unit;
