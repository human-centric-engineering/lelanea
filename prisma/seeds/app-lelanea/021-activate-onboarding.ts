/**
 * Activate the onboarding module on a fresh database (§15, t-102).
 *
 * A person's journey starts by entering the `onboarding` node, and Daybreak's
 * engine enters only a node whose module is live, which needs status
 * `active`. Module rows are born `draft`. Existing databases are moved by the
 * migration `20261005100000_app_activate_onboarding_module`; a fresh database
 * has no module rows when migrations run, so this unit does the same once the
 * rows exist (`001-journey-map` creates them, and runs first).
 *
 * ## Who owns the row (`fp4`)
 *
 * **Operator-owned.** It moves the row from `draft` to `active` and nothing
 * else, and it runs once per database (its source hash never changes). An
 * admin who later sets onboarding back to `draft` keeps that, unless this
 * file itself changes. Onboarding only: the other modules are activated as
 * their content lands (owner ruling, 30 Sept 2026).
 *
 * **Safe on empty.** A missing row is logged and skipped.
 */

import type { SeedUnit } from '@/prisma/runner';
import { ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import { MODULE_STATUS } from '@/lib/framework/modules/status';

const unit: SeedUnit = {
  name: 'app-lelanea/021-activate-onboarding',
  async run({ prisma, logger }) {
    const moved = await prisma.module.updateMany({
      where: { slug: ONBOARDING_NODE_KEY, status: MODULE_STATUS.draft },
      data: { status: MODULE_STATUS.active },
    });
    if (moved.count > 0) {
      logger.info(`▶  Activated the ${ONBOARDING_NODE_KEY} module`);
      return;
    }
    const row = await prisma.module.findFirst({
      where: { slug: ONBOARDING_NODE_KEY },
      select: { status: true },
    });
    logger.info(
      row
        ? `⏭  ${ONBOARDING_NODE_KEY} module is already ${row.status}; left as it is`
        : `⏭  No ${ONBOARDING_NODE_KEY} module row yet; nothing to activate`
    );
  },
};

export default unit;
