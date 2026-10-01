/**
 * Activate the values module on a fresh database (§15, t-106).
 *
 * Onboarding ends by entering the person into the `values` node, and
 * Daybreak's engine enters only a node whose module is live, which needs
 * status `active`. Module rows are born `draft`. Existing databases are moved
 * by the migration `20261006100000_app_activate_values_module`; a fresh
 * database has no module rows when migrations run, so this unit does the same
 * once the rows exist (`001-journey-map` creates them, and runs first).
 *
 * Operator-owned and safe on empty, as `021-activate-onboarding` is: it moves
 * the row from `draft` to `active` once and nothing else, and a missing row is
 * logged and skipped.
 */

import type { SeedUnit } from '@/prisma/runner';
import { VALUES_NODE_KEY } from '@/lib/app/journey/map-definition';
import { MODULE_STATUS } from '@/lib/framework/modules/status';

const unit: SeedUnit = {
  name: 'app-lelanea/022-activate-values',
  async run({ prisma, logger }) {
    const moved = await prisma.module.updateMany({
      where: { slug: VALUES_NODE_KEY, status: MODULE_STATUS.draft },
      data: { status: MODULE_STATUS.active },
    });
    if (moved.count > 0) {
      logger.info(`▶  Activated the ${VALUES_NODE_KEY} module`);
      return;
    }
    const row = await prisma.module.findFirst({
      where: { slug: VALUES_NODE_KEY },
      select: { status: true },
    });
    logger.info(
      row
        ? `⏭  ${VALUES_NODE_KEY} module is already ${row.status}; left as it is`
        : `⏭  No ${VALUES_NODE_KEY} module row yet; nothing to activate`
    );
  },
};

export default unit;
