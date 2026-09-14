/**
 * Smoke: the journey-map seed against the real development database.
 *
 * Unit tests prove the definition is publishable and the seed's four branches
 * call the right service function; what no mock can prove is the wiring — that
 * `syncFrameworkForSeed` really leaves seventeen `framework_module` rows for
 * the map's `moduleSlug`s to point at, that the version service really accepts
 * the graph, and that a second run really writes no second version. This runs
 * the seed unit twice and reads the rows back.
 *
 * Leaves the map in place: it is the same row `db:seed` produces, so there is
 * nothing to clean up — but it records the version it found on entry, so the
 * output says whether this run published or only confirmed.
 *
 * Usage: `npm run smoke:app-journey-map` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise; skipped (exit 0, says so) with no database.
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import unit from '@/prisma/seeds/app-lelanea/001-journey-map';
import { JOURNEY_MAP_SLUG, buildJourneyMapDefinition } from '@/lib/app/journey/map-definition';
import { LELANEA_MODULE_COUNT } from '@/lib/app/modules/definitions';
import {
  getPublishedMap,
  validatePublishableMap,
} from '@/lib/framework/facilitation/map/version-service';

async function dbReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

function check(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-journey-map skipped — no database reachable.');
    return;
  }

  try {
    const before = await getPublishedMap(JOURNEY_MAP_SLUG);
    console.log(
      before
        ? `\nMap already published at v${before.version} on entry.`
        : '\nNo published map on entry.'
    );

    console.log('\n1. First run');
    await unit.run({ prisma, logger });

    const modules = await prisma.module.count({ where: { isRegistered: true } });
    check(
      modules === LELANEA_MODULE_COUNT,
      `${LELANEA_MODULE_COUNT} registered module rows exist after the seed's framework boot (found ${modules})`
    );

    const first = await getPublishedMap(JOURNEY_MAP_SLUG);
    check(first !== null, 'the map has a published version');
    const definition = buildJourneyMapDefinition();
    check(
      first!.definition.nodes.length === definition.nodes.length &&
        first!.definition.edges.length === definition.edges.length,
      `published graph has ${definition.nodes.length} nodes and ${definition.edges.length} edges`
    );

    const slugs = new Set(
      (await prisma.module.findMany({ select: { slug: true } })).map((m) => m.slug)
    );
    const dangling = first!.definition.nodes
      .filter((n) => n.type === 'module')
      .map((n) => n.moduleSlug!)
      .filter((slug) => !slugs.has(slug));
    check(
      dangling.length === 0,
      `every module node points at a module row (dangling: ${dangling.length})`
    );

    console.log('\n2. Second run — must write nothing');
    const versionsBefore = await prisma.facilitationGraphVersion.count({
      where: { graph: { slug: JOURNEY_MAP_SLUG } },
    });
    await unit.run({ prisma, logger });
    const second = await getPublishedMap(JOURNEY_MAP_SLUG);
    const versionsAfter = await prisma.facilitationGraphVersion.count({
      where: { graph: { slug: JOURNEY_MAP_SLUG } },
    });
    check(second!.version === first!.version, `published version unchanged (v${first!.version})`);
    check(versionsAfter === versionsBefore, `no new version row (${versionsAfter} total)`);

    console.log('\n3. Publish validation refuses a broken graph');
    let refused = false;
    try {
      validatePublishableMap({
        ...definition,
        edges: [...definition.edges, { from: 'oneness', to: 'nowhere', type: 'related_to' }],
      });
    } catch {
      refused = true;
    }
    check(refused, 'a dangling edge is refused by the publish chain');

    console.log('\n✓ smoke:app-journey-map passed');
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-journey-map failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
