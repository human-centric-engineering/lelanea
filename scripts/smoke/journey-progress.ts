/**
 * Module-owned journey-progress smoke (#168).
 *
 * Proves what the mocked unit tests cannot, and — deliberately — what a stateful
 * in-memory fake would only *assume*. `recordNodeProgress` merges
 * `UserNodeState.progress` with Postgres's own `jsonb ||`, so the contract that
 * matters ("a second beat does not clobber the first") lives in the database, not in
 * the TypeScript. A fake implementing `||` as `Object.assign` would pass whatever the
 * seam did, which is why the sibling seam's stateful-fake integration test
 * (`create-idempotence.test.ts`, #159) has no counterpart here: `createJourney`'s
 * idempotence is Prisma-level and a fake can model it honestly; this one is not.
 *
 * What it proves against real Postgres:
 *   - the first merge works against the `NULL` the column starts as (COALESCE);
 *   - a second merge PRESERVES the first key — the lost update this seam exists to
 *     prevent;
 *   - the same patch twice is a no-op (idempotent), which is what lets a leaf retry;
 *   - the right-hand side wins per key, and the merge is SHALLOW (a nested object
 *     replaces rather than merges) — the documented limitation;
 *   - the lifecycle fields `applyEvent` owns are untouched throughout;
 *   - both refusals are structured, and neither creates a row;
 *   - the statement is parameterised: a `nodeKey` carrying SQL is matched as data.
 *
 * Skips cleanly (exit 0) when no database is reachable, so it is safe to invoke
 * anywhere. Self-cleaning: creates only `smoke-test-progress-*` rows (+ the journey
 * rows they cascade to) and removes them on every path. Never unscoped deletes.
 *
 * Run with:
 *   npm run smoke:journey-progress
 *   npx tsx --env-file=.env.local scripts/smoke/journey-progress.ts
 */

import { prisma } from '@/lib/db/client';
import { createJourney } from '@/lib/framework/facilitation/journey/create';
import { recordNodeProgress } from '@/lib/framework/facilitation/journey/progress';
import { NODE_STATE_STATUS } from '@/lib/framework/facilitation/journey/vocabulary';
import { ForbiddenError } from '@/lib/api/errors';

const PREFIX = 'smoke-test-progress';
const stamp = Date.now();
const SLUG = `${PREFIX}-map-${stamp}`;
const NODE = 'week-chart';

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

/**
 * The `progress` payload as the database now holds it.
 *
 * Narrowed by a guard rather than an `as` cast: `progress` is `Prisma.JsonValue`,
 * so a scalar or an array is a shape the column genuinely permits. Asserting
 * through a cast would let a seam that wrote `5` there be read as an object and
 * quietly satisfy `Object.keys(...).length === 2`. `{}` for a non-object makes the
 * assertions below fail instead, which is the point of running them.
 */
async function progressOf(journeyId: string): Promise<Record<string, unknown>> {
  const row = await prisma.userNodeState.findUniqueOrThrow({
    where: { journeyId_nodeKey: { journeyId, nodeKey: NODE } },
  });
  const value = row.progress;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

async function main(): Promise<void> {
  if (!(await dbReachable())) {
    console.log(
      'smoke:journey-progress skipped — no database reachable (DATABASE_URL unset or DB down).'
    );
    return;
  }

  let subjectUserId: string | null = null;
  let journeyId: string | null = null;

  try {
    const subject = await prisma.user.create({
      data: { name: `${PREFIX} subject`, email: `${PREFIX}-subject-${stamp}@example.com` },
    });
    subjectUserId = subject.id;
    const viewer = { userId: subject.id };
    const key = { userId: subject.id, graphSlug: SLUG, contextKey: `run-${stamp}` };

    console.log('\nrefusals (before anything exists)');
    const noJourney = await recordNodeProgress(viewer, key, NODE, { chartShown: true });
    check(
      !noJourney.ok && noJourney.rejection.code === 'journey_not_started',
      'an unstarted journey is refused as journey_not_started'
    );

    const journey = await createJourney(viewer, key);
    journeyId = journey.id;

    const noNode = await recordNodeProgress(viewer, key, NODE, { chartShown: true });
    check(
      !noNode.ok && noNode.rejection.code === 'node_not_entered',
      'a node with no state is refused as node_not_entered'
    );
    check(
      (await prisma.userNodeState.count({ where: { journeyId } })) === 0,
      'the refusal created no UserNodeState row (status stays applyEvent’s to write)'
    );

    // Enter the node the way the engine would, so there is a lifecycle projection to
    // record against — and a set of fields this seam must leave alone.
    const entered = new Date();
    await prisma.userNodeState.create({
      data: {
        journeyId,
        nodeKey: NODE,
        status: NODE_STATE_STATUS.active,
        timesCompleted: 0,
        firstEnteredAt: entered,
        lastActiveAt: entered,
      },
    });

    console.log('\nthe merge');
    const first = await recordNodeProgress(viewer, key, NODE, { chartShown: true });
    check(first.ok, 'the first write succeeds against the NULL the column starts as');
    check(
      JSON.stringify(await progressOf(journeyId)) === JSON.stringify({ chartShown: true }),
      'first merge stored { chartShown: true }'
    );

    await recordNodeProgress(viewer, key, NODE, { gapAnalysisShown: true });
    const both = await progressOf(journeyId);
    check(
      both.chartShown === true && both.gapAnalysisShown === true,
      'the SECOND merge preserved the first key — no lost update'
    );

    await recordNodeProgress(viewer, key, NODE, { chartShown: true });
    const again = await progressOf(journeyId);
    check(
      Object.keys(again).length === 2 && again.chartShown === true,
      'merging the same patch twice is a no-op — a leaf can safely retry'
    );

    await recordNodeProgress(viewer, key, NODE, { chartShown: false });
    check(
      (await progressOf(journeyId)).chartShown === false,
      'the right-hand side wins per key, so a beat can be corrected'
    );

    await recordNodeProgress(viewer, key, NODE, { beats: { a: 1, b: 2 } });
    await recordNodeProgress(viewer, key, NODE, { beats: { c: 3 } });
    check(
      JSON.stringify((await progressOf(journeyId)).beats) === JSON.stringify({ c: 3 }),
      'the merge is SHALLOW — a nested object replaces rather than merges (documented)'
    );

    console.log('\nwhat it must not touch');
    const row = await prisma.userNodeState.findUniqueOrThrow({
      where: { journeyId_nodeKey: { journeyId, nodeKey: NODE } },
    });
    check(
      row.status === NODE_STATE_STATUS.active &&
        row.timesCompleted === 0 &&
        row.completedAt === null &&
        row.firstEnteredAt?.getTime() === entered.getTime() &&
        row.lastActiveAt?.getTime() === entered.getTime(),
      'six merges later, every lifecycle field applyEvent owns is unchanged'
    );

    console.log('\naccess and injection');
    let forbidden = false;
    try {
      await recordNodeProgress({ userId: `${subject.id}-nope` }, key, NODE, { pwned: true });
    } catch (err) {
      forbidden = err instanceof ForbiddenError;
    }
    check(forbidden, 'another subject without the admin-support override is refused');

    const injected = await recordNodeProgress(viewer, key, `${NODE}' OR '1'='1`, { pwned: true });
    check(
      !injected.ok && injected.rejection.code === 'node_not_entered',
      'a nodeKey carrying SQL is matched as DATA — no row, no error'
    );
    check(
      (await progressOf(journeyId)).pwned === undefined,
      'and the real node was not written through it'
    );

    console.log('\n✓ smoke:journey-progress passed');
  } finally {
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
  console.error('\n✗ smoke:journey-progress failed:', err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
