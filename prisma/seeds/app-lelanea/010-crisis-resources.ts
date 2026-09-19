/**
 * The crisis resource, moved into the tables an admin edits — once (f-safety t-63).
 *
 * Fills `app_crisis_copy` and `app_crisis_region` from the bundled
 * `content/lelanea_crisis_resources.json`, with the file's own sign-off status.
 * Until this runs the file is served, so nothing is ever missing in between.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Operator-owned.** Written once, while the copy row is absent, and never
 * again. The copy row is the marker because it is written with the regions in
 * one transaction: its presence means this has run, whatever an admin has done
 * since. So a re-run after an admin **removed** a region does not bring it
 * back, and one after an admin **edited** a number does not undo the edit — a
 * per-region "create if absent" would get the first of those wrong.
 *
 * A region later added to the file therefore does not reach a seeded database.
 * That is deliberate: once seeded, the tables are the source and the admin page
 * is how a region is added. The file remains the floor the resolver falls back
 * to (`lib/app/safety/resources-store.ts`).
 *
 * **Safe on empty.** It only ever adds rows. No removal pass.
 *
 * @see lib/app/safety/resources-store.ts
 * @see .context/app/safety.md — "The resource"
 */

import type { SeedUnit } from '@/prisma/runner';
import { getCrisisResources } from '@/lib/app/content/crisis-resources';
import { CRISIS_COPY_SLUG } from '@/lib/app/safety/resources-store';

const unit: SeedUnit = {
  name: 'app-lelanea/010-crisis-resources',
  async run({ prisma, logger }) {
    const existing = await prisma.appCrisisCopy.findUnique({
      where: { slug: CRISIS_COPY_SLUG },
      select: { version: true, status: true },
    });
    if (existing) {
      logger.info(
        `⏭  Crisis resources already in the database (copy v${existing.version}, ${existing.status}); left as they are`
      );
      return;
    }

    const file = getCrisisResources();
    const status = file.resources.provenance.status;
    const signedOffAt = status === 'signed_off' ? new Date() : null;

    await prisma.$transaction([
      prisma.appCrisisCopy.create({
        data: {
          slug: CRISIS_COPY_SLUG,
          ...file.copy,
          internationalName: file.international.name,
          internationalContact: file.international.contact,
          internationalUrl: file.international.url,
          internationalHours: file.international.hours,
          status,
          signedOffAt,
        },
      }),
      prisma.appCrisisRegion.createMany({
        data: file.regions.map((r) => ({
          region: r.region,
          emergencyNumber: r.emergencyNumber,
          services: r.services.map((s) => ({ ...s })),
          status,
          signedOffAt,
        })),
        skipDuplicates: true,
      }),
    ]);
    logger.info(
      `🆘 Seeded the crisis resource: ${file.regions.length} regions and the shared copy (${status})`
    );
  },
};

export default unit;
