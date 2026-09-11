/**
 * Facilitation-engine write-path smoke (f-engine t-3).
 *
 * Proves what the mocked `applyEvent` unit tests cannot: the sole-writer
 * transaction actually lands against real Postgres — an `enter` writes the
 * `UserNodeState` projection (active) + a `node_entered` `JourneyEvent` with the
 * subject's `userId`, and a `complete` closes the node (status `completed`,
 * `timesCompleted` incremented) + a `node_completed` event, both via the shipped
 * `@@unique([journeyId, nodeKey])` upsert. The map/graph is an in-memory input (as
 * the engine takes it); only the write hits the DB.
 *
 * Skips cleanly (exit 0) when no database is reachable, so it is safe to invoke
 * anywhere. Self-cleaning: creates only `smoke-test-engine-*` rows (+ the journey
 * rows they cascade to) and removes them on every path. Never unscoped deletes.
 *
 * Run with:
 *   npm run smoke:engine
 *   npx tsx --env-file=.env.local scripts/smoke/engine.ts
 */

import { prisma } from '@/lib/db/client';
import { inMemoryGraphStore } from '@/lib/framework/facilitation/engine/graph-store';
import { applyEvent, ENGINE_EVENT_TYPE } from '@/lib/framework/facilitation/engine/apply-event';
import { createJourney } from '@/lib/framework/facilitation/journey/create';

const PREFIX = 'smoke-test-engine';
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

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log('smoke:engine skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }

  let subjectUserId: string | null = null;
  let journeyId: string | null = null;

  try {
    const subject = await prisma.user.create({
      data: { name: `${PREFIX} subject`, email: `${PREFIX}-subject-${stamp}@example.com` },
    });
    subjectUserId = subject.id;

    // Started through the framework seam (#159) rather than the table — the seam is
    // the only sanctioned way to create a journey, and this smoke is the standing
    // witness. Note the slug names no PUBLISHED map on purpose: the engine takes its
    // graph as an input (below), which is exactly why `createJourney` does not
    // validate `graphSlug` against a published version.
    const journey = await createJourney(
      { userId: subject.id },
      { userId: subject.id, graphSlug: `${PREFIX}-graph-${stamp}` }
    );
    journeyId = journey.id;

    // A one-node map, in memory (the engine takes the graph as an input). `welcome`
    // is an entry node — no gates — so it is available to enter.
    const graph = inMemoryGraphStore({
      nodes: [{ key: 'welcome', type: 'milestone', completionMode: 'once' }],
      edges: [],
    });
    const base = { graph, slots: [], moduleLiveness: new Map(), now: new Date() };

    // 1. enter — writes the active projection + a node_entered event.
    const entered = await applyEvent({
      ...base,
      transition: { userId: subject.id, journeyId: journey.id, nodeKey: 'welcome', kind: 'enter' },
      nodeStates: [],
    });
    check(entered.ok, 'enter accepted');

    const afterEnter = await prisma.userNodeState.findUnique({
      where: { journeyId_nodeKey: { journeyId: journey.id, nodeKey: 'welcome' } },
    });
    check(afterEnter?.status === 'active', 'node-state projection written as active');

    const enterEvents = await prisma.journeyEvent.findMany({
      where: { journeyId: journey.id, userId: subject.id, type: ENGINE_EVENT_TYPE.nodeEntered },
    });
    check(enterEvents.length === 1, 'one node_entered event appended, keyed on the subject userId');

    // 2. complete — closes the once node and stamps the completion.
    const completed = await applyEvent({
      ...base,
      transition: {
        userId: subject.id,
        journeyId: journey.id,
        nodeKey: 'welcome',
        kind: 'complete',
      },
      // snapshot after the enter: the node is active.
      nodeStates: [
        {
          nodeKey: 'welcome',
          status: 'active',
          firstEnteredAt: new Date(),
          lastActiveAt: new Date(),
        },
      ],
    });
    check(completed.ok, 'complete accepted');

    const afterComplete = await prisma.userNodeState.findUnique({
      where: { journeyId_nodeKey: { journeyId: journey.id, nodeKey: 'welcome' } },
    });
    check(afterComplete?.status === 'completed', 'projection closed to completed');
    check(afterComplete?.timesCompleted === 1, 'timesCompleted incremented to 1');
    check(afterComplete?.completedAt !== null, 'completedAt stamped');

    const completeEvents = await prisma.journeyEvent.findMany({
      where: { journeyId: journey.id, type: ENGINE_EVENT_TYPE.nodeCompleted },
    });
    check(completeEvents.length === 1, 'one node_completed event appended');

    console.log('\n✓ smoke:engine passed');
  } finally {
    // Cascade children (node states, events) go with the journey/user hand-FKs;
    // explicit deletes keep the script self-contained on the non-erased path.
    if (journeyId) {
      await prisma.journeyEvent.deleteMany({ where: { journeyId } }).catch(() => undefined);
      await prisma.userNodeState.deleteMany({ where: { journeyId } }).catch(() => undefined);
      await prisma.userJourney.deleteMany({ where: { id: journeyId } }).catch(() => undefined);
    }
    if (subjectUserId) {
      await prisma.journeyEvent
        .deleteMany({ where: { userId: subjectUserId } })
        .catch(() => undefined);
      await prisma.user.deleteMany({ where: { id: subjectUserId } }).catch(() => undefined);
    }
    await prisma.$disconnect().catch(() => undefined);
  }
}

main().catch(async (err) => {
  console.error('\n✗ smoke:engine failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
