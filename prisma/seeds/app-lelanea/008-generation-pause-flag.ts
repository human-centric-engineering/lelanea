/**
 * The operator's switch that pauses conversations — created, off (§08 t-55).
 *
 * `LELANEA_GENERATION_PAUSED` is a Sunrise feature flag: flip it at
 * `/admin/features` and every turn on her seats is refused before any model call
 * with the plain `paused` ending, while everything readable keeps working. See
 * `lib/app/agent/availability.ts`.
 *
 * ## The row this writes, and who owns it (`fp4`)
 *
 * **Operator-owned.** Created once, off, when it does not exist; never written
 * again. A flag an admin switched on during an incident must stay on through a
 * deploy that re-runs seeds — a seed that switched it off would end the pause
 * behind the operator's back. So this is `create`-if-absent, not an upsert that
 * reconciles, and a changed description here does not reach an existing row.
 *
 * **Safe on empty.** It only ever adds one row, keyed by name. No removal pass.
 *
 * Not in `DEFAULT_FLAGS` (`lib/feature-flags/config.ts`): that list is
 * Sunrise-owned, and adding to it would be a divergence for one row.
 *
 * @see lib/app/agent/availability.ts
 * @see .context/app/agent.md — "When she can't answer"
 */

import type { SeedUnit } from '@/prisma/runner';
import {
  GENERATION_PAUSED_FLAG,
  GENERATION_PAUSED_FLAG_DESCRIPTION,
} from '@/lib/app/agent/availability';

const unit: SeedUnit = {
  name: 'app-lelanea/008-generation-pause-flag',
  async run({ prisma, logger }) {
    const existing = await prisma.featureFlag.findUnique({
      where: { name: GENERATION_PAUSED_FLAG },
      select: { enabled: true },
    });

    if (existing) {
      logger.info(
        `⏭  ${GENERATION_PAUSED_FLAG} already exists (${existing.enabled ? 'ON — conversations are paused' : 'off'}); left as it is`
      );
      return;
    }

    await prisma.featureFlag.create({
      data: {
        name: GENERATION_PAUSED_FLAG,
        description: GENERATION_PAUSED_FLAG_DESCRIPTION,
        enabled: false,
        metadata: {},
      },
    });
    logger.info(`⏸  Created ${GENERATION_PAUSED_FLAG}, off`);
  },
};

export default unit;
