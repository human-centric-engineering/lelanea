/**
 * Smoke: passing the gate starts a person's journey, on the real development
 * database (§15, t-102).
 *
 * The unit tests mock Prisma and every framework call, so they prove this code
 * calls the right functions in the right order. What they cannot prove is the
 * wiring those calls rely on: that `createJourney` writes a row on the
 * published Lelañea map, that the engine really accepts an `enter` of the
 * `onboarding` node on that map (availability is computed from the stored
 * graph, the module rows and their liveness), that a second call writes
 * nothing, and that `recordNodeProgress` then accepts a once-only beat. That
 * last one is the reason the node is entered at all.
 *
 * Needs a seeded database: the map published (`001-journey-map`) and the
 * gate's documents present. Skips (exit 0, says so) with no database, and fails
 * with a clear message when the map is not published.
 *
 * Self-cleaning: creates one `smoke-app-onboarding-*` user and removes it and
 * every row keyed on it, on every path. Never unscoped deletes.
 *
 * FORK NOTE — this runs the real `lib/app/leaf-bootstrap` seam (`initLeafApp()`),
 * because the map projection checks each node against the module registry it
 * fills. It asserts Lelañea's map, its `onboarding` node and its gate; a fork
 * with a different journey, or none, should replace this script rather than
 * pin ours.
 *
 * Usage: `npm run smoke:app-onboarding` (reads `.env.local`). Exit 0 on every
 * assertion passing, 1 otherwise.
 */

import { prisma } from '@/lib/db/client';
import { ACKNOWLEDGEMENT_KINDS } from '@/lib/app/gateway/kinds';
import { getGateStatus, recordAcknowledgement } from '@/lib/app/gateway/acknowledgements';
import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import { getJourneyMap } from '@/lib/app/journey/map';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { ensureJourneyStarted } from '@/lib/app/journey/start';
import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { getPublishedMapVersion } from '@/lib/framework/facilitation/map/version-service';

const PREFIX = 'smoke-app-onboarding';
const stamp = Date.now();

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

async function cleanup(userId: string): Promise<void> {
  const journeys = await prisma.userJourney.findMany({ where: { userId }, select: { id: true } });
  const journeyIds = journeys.map((j) => j.id);
  await prisma.journeyEvent.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.userNodeState
    .deleteMany({ where: { journeyId: { in: journeyIds } } })
    .catch(() => undefined);
  await prisma.userJourney.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.appAcknowledgement.deleteMany({ where: { userId } }).catch(() => undefined);
  await prisma.user.deleteMany({ where: { id: userId } }).catch(() => undefined);
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:app-onboarding skipped — no database reachable.');
    return;
  }

  let userId: string | null = null;
  try {
    // The map projection checks each node against the module registry, which a
    // server fills at boot and a script has to fill itself.
    await initLeafApp();

    if ((await getPublishedMapVersion(JOURNEY_MAP_SLUG)) === null) {
      throw new Error(`the map "${JOURNEY_MAP_SLUG}" is not published — run npm run db:seed`);
    }

    const user = await prisma.user.create({
      data: { name: `${PREFIX} person`, email: `${PREFIX}-${stamp}@example.com` },
    });
    userId = user.id;

    console.log('\n1. The gate');
    for (const kind of ACKNOWLEDGEMENT_KINDS) {
      const result = await recordAcknowledgement(user.id, kind);
      check(result.created, `${kind} recorded`);
    }
    check((await getGateStatus(user.id)).complete, 'the gate is complete');

    console.log('\n2. The journey starts');
    check((await ensureJourneyStarted(user.id)) === 'started', 'the first call starts it');
    const journeys = await prisma.userJourney.findMany({ where: { userId: user.id } });
    check(
      journeys.length === 1 && journeys[0].graphSlug === JOURNEY_MAP_SLUG,
      `one journey, on the published map "${JOURNEY_MAP_SLUG}"`
    );
    const journeyId = journeys[0].id;
    const states = await prisma.userNodeState.findMany({ where: { journeyId } });
    check(
      states.length === 1 &&
        states[0].nodeKey === ONBOARDING_NODE_KEY &&
        states[0].status === NODE_STATE_STATUS.active,
      'onboarding is the one node, and it is active'
    );

    console.log('\n3. A second call writes nothing');
    const eventsBefore = await prisma.journeyEvent.count({ where: { journeyId } });
    check((await ensureJourneyStarted(user.id)) === 'already', 'the second call answers already');
    check(
      (await prisma.userJourney.count({ where: { userId: user.id } })) === 1,
      'still one journey'
    );
    check(
      (await prisma.journeyEvent.count({ where: { journeyId } })) === eventsBefore,
      `no new event (${eventsBefore} total)`
    );

    console.log('\n4. The drawer reads it');
    const map = await getJourneyMap(user.id);
    const current = map?.modules.filter((m) => m.state === 'current').map((m) => m.slug);
    check(
      current?.length === 1 && current[0] === ONBOARDING_NODE_KEY,
      'onboarding is the one current module'
    );
    check(
      map?.modules.filter((m) => m.state === 'open').length === (map?.modules.length ?? 0) - 1,
      'every other module is open'
    );

    console.log('\n5. A once-only beat is accepted');
    const beat = await recordNodeProgress(
      { userId: user.id },
      { userId: user.id, graphSlug: JOURNEY_MAP_SLUG },
      ONBOARDING_NODE_KEY,
      { welcomed: true }
    );
    check(beat.ok, 'recordNodeProgress accepts a beat on the entered node');

    console.log('\n✓ smoke:app-onboarding passed');
  } finally {
    if (userId) await cleanup(userId);
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:app-onboarding failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
