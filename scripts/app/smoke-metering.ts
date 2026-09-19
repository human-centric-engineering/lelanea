/**
 * Smoke: the meter's aggregates, on a fixture, against the dev database
 * (§08 t-56).
 *
 * **Why a smoke rather than a unit test.** Every property worth proving about a
 * breakdown — totals reconcile to the cost rows, a row with no user lands in
 * platform cost, an untagged row is seated by its conversation — is decided in
 * SQL. The unit harness has no database (`B9`), and a mock that returned the
 * sums would only echo what it was told. So the fixture goes into real Postgres,
 * in a window nothing else occupies (January 2001), and the module's own
 * functions are asked about it. No server and no model call needed.
 *
 * The fixture — two people, one facilitation conversation seated `onboarding`:
 *
 * | Row | Person | Conversation | Tags                             | $     |
 * | --- | ------ | ------------ | -------------------------------- | ----- |
 * | A   | ours   | C            | turnId T, seat `facilitator`     | 0.010 |
 * | B   | ours   | C            | none — written before tagging    | 0.020 |
 * | U   | ours   | C            | turnId T, seat `facilitator`, $0 | 0     |
 * | E   | ours   | C            | the embedding of T's reply       | 0.001 |
 * | P   | none   | none         | none — ingestion                 | 0.040 |
 * | O   | other  | none         | none                             | 0.080 |
 *
 * U used tokens and cost $0 on a non-local provider: unpriced.
 *
 * Safety: every row is created by this run and marked with the `smoke-test-meter`
 * prefix, and removed on every path, including a sweep at startup. Never touches
 * seed data.
 *
 * Run with: npm run smoke:app-metering
 */

import { prisma } from '@/lib/db/client';
import {
  getAdminBreakdown,
  getMemberBreakdown,
  getTurnMeter,
  type MeterBreakdown,
  type MeterGroup,
} from '@/lib/app/agent/metering';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

const PREFIX = 'smoke-test-meter';
const MARK = { smoke: PREFIX };
const WINDOW = { from: new Date('2001-01-01T00:00:00Z'), to: new Date('2001-02-01T00:00:00Z') };
const TURN_ID = `${PREFIX}-turn`;
const REPLY_MESSAGE_ID = `${PREFIX}-reply`;
const EPSILON = 1e-9;

let failures = 0;
function check(cond: boolean, msg: string): void {
  console.log(`  ${cond ? '✓' : '✗'} ${msg}`);
  if (!cond) failures++;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON;
const groupSum = (result: MeterBreakdown<MeterGroup>): number =>
  result.groups.reduce((total, group) => total + group.costUsd, 0);
const group = (result: MeterBreakdown<MeterGroup>, key: string | null) =>
  result.groups.find((entry) => entry.key === key);

async function sweep(): Promise<void> {
  await prisma.aiCostLog.deleteMany({ where: { metadata: { path: ['smoke'], equals: PREFIX } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
}

function at(day: number): Date {
  return new Date(Date.UTC(2001, 0, day, 12));
}

async function main(): Promise<void> {
  console.log('\nsmoke:app-metering\n');

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    console.log('skipped — no database reachable (DATABASE_URL unset or DB down).');
    return;
  }

  await sweep();

  try {
    const agent = await prisma.aiAgent.findFirst({
      where: { slug: VOICE_AGENT_SLUG },
      select: { id: true },
    });
    if (!agent) throw new Error(`no ${VOICE_AGENT_SLUG} agent — run npm run db:seed first`);

    const [ours, other] = await Promise.all(
      ['ours', 'other'].map((who) =>
        prisma.user.create({
          data: { email: `${PREFIX}-${who}@example.com`, name: `Meter smoke (${who})` },
          select: { id: true },
        })
      )
    );
    const conversation = await prisma.aiConversation.create({
      data: {
        agentId: agent.id,
        userId: ours.id,
        contextType: 'facilitation',
        contextId: 'onboarding',
      },
      select: { id: true },
    });
    await prisma.appTurn.create({
      data: {
        userId: ours.id,
        turnId: TURN_ID,
        clientSupplied: true,
        requestHash: PREFIX,
        seat: 'facilitator',
        agentSlug: VOICE_AGENT_SLUG,
        status: 'completed',
        fingerprintVersion: '1',
        conversationId: conversation.id,
        assistantMessageId: REPLY_MESSAGE_ID,
        modelId: 'gpt-4o-mini',
        providerSlug: 'openai',
        startedAt: at(3),
        completedAt: at(3),
      },
    });

    const base = { model: 'gpt-4o-mini', provider: 'openai', inputCostUsd: 0, outputCostUsd: 0 };
    const tagged = { ...MARK, turnId: TURN_ID, seat: 'facilitator' };
    await prisma.aiCostLog.createMany({
      data: [
        // A — tagged
        {
          ...base,
          userId: ours.id,
          conversationId: conversation.id,
          operation: 'chat',
          inputTokens: 100,
          outputTokens: 10,
          totalCostUsd: 0.01,
          metadata: tagged,
          createdAt: at(3),
        },
        // B — before tagging existed
        {
          ...base,
          userId: ours.id,
          conversationId: conversation.id,
          operation: 'chat',
          inputTokens: 200,
          outputTokens: 20,
          totalCostUsd: 0.02,
          metadata: MARK,
          createdAt: at(2),
        },
        // U — tagged, used tokens, costed at nothing
        {
          ...base,
          userId: ours.id,
          conversationId: conversation.id,
          operation: 'chat',
          inputTokens: 50,
          outputTokens: 5,
          totalCostUsd: 0,
          metadata: { ...tagged, kind: 'conversation_summary' },
          createdAt: at(3),
        },
        // E — the embedding of T's reply, untagged, joined by message id
        {
          ...base,
          model: 'text-embedding-3-small',
          userId: ours.id,
          conversationId: conversation.id,
          operation: 'embedding',
          inputTokens: 30,
          outputTokens: 0,
          totalCostUsd: 0.001,
          metadata: { ...MARK, kind: 'message_embedding', messageId: REPLY_MESSAGE_ID },
          createdAt: at(3),
        },
        // P — no person: platform cost
        {
          ...base,
          model: 'text-embedding-3-small',
          operation: 'embedding',
          inputTokens: 400,
          outputTokens: 0,
          totalCostUsd: 0.04,
          metadata: MARK,
          createdAt: at(4),
        },
        // O — somebody else
        {
          ...base,
          userId: other.id,
          operation: 'chat',
          inputTokens: 800,
          outputTokens: 80,
          totalCostUsd: 0.08,
          metadata: MARK,
          createdAt: at(4),
        },
      ],
    });
    const ALL = 0.151;
    const OURS = 0.031;

    console.log('1. Totals reconcile to the cost rows, whatever the grouping');
    for (const by of ['user', 'conversation', 'seat', 'model', 'day'] as const) {
      const result = await getAdminBreakdown({ by, window: WINDOW, limit: 100 });
      check(
        near(result.totals.costUsd, ALL) && result.totals.costRows === 6,
        `by ${by}: totals $${result.totals.costUsd.toFixed(3)} over ${result.totals.costRows} rows`
      );
      check(near(groupSum(result), ALL), `by ${by}: the groups sum to the totals`);
    }
    const truncated = await getAdminBreakdown({ by: 'user', window: WINDOW, limit: 1 });
    check(
      truncated.truncated && truncated.groups.length === 1 && near(truncated.totals.costUsd, ALL),
      'truncating the groups never truncates the totals'
    );

    console.log('\n2. A row with no person is platform cost — reported, not dropped or attributed');
    const byUser = await getAdminBreakdown({ by: 'user', window: WINDOW, limit: 100 });
    check(
      near(byUser.totals.platformCostUsd, 0.04),
      `platformCostUsd is $${byUser.totals.platformCostUsd}`
    );
    check(
      near(group(byUser, null)?.costUsd ?? -1, 0.04),
      'the null-user group is exactly the platform row'
    );
    const oursGroup = byUser.groups.find((entry) => entry.key === ours.id);
    check(
      near(oursGroup?.costUsd ?? -1, OURS),
      `our person is $${oursGroup?.costUsd} — not a cent of platform cost`
    );
    check(
      oursGroup !== undefined &&
        'user' in oursGroup &&
        oursGroup.user?.name === 'Meter smoke (ours)',
      'and is named, so the view needs no second fetch'
    );

    console.log('\n3. Seat comes from the tag, else from the conversation');
    const bySeat = await getAdminBreakdown({
      by: 'seat',
      window: WINDOW,
      limit: 100,
      userId: ours.id,
    });
    check(
      near(group(bySeat, 'facilitator')?.costUsd ?? -1, 0.01),
      'tagged rows keep their own seat, even where the conversation says otherwise'
    );
    check(
      near(group(bySeat, 'onboarding')?.costUsd ?? -1, 0.021),
      'the pre-tagging row and the untagged embedding take the conversation’s seat'
    );
    check(
      group(bySeat, 'facilitator')?.unpricedRows === 1,
      'the $0 row with tokens is counted as unpriced'
    );
    const allSeats = await getAdminBreakdown({ by: 'seat', window: WINDOW, limit: 100 });
    check(
      near(group(allSeats, null)?.costUsd ?? -1, 0.12),
      'rows with no conversation and no tag are unseated, not dropped'
    );

    console.log('\n4. A member reads only their own');
    const own = await getMemberBreakdown(ours.id, { by: 'day', window: WINDOW, limit: 100 });
    check(
      near(own.totals.costUsd, OURS) && own.totals.costRows === 4,
      `their totals are $${own.totals.costUsd} over ${own.totals.costRows} rows`
    );
    check(own.totals.platformCostUsd === 0, 'with no platform cost in them');
    check(
      own.groups.map((entry) => entry.key).join(',') === '2001-01-02,2001-01-03',
      `grouped by UTC day, in order (${own.groups.map((entry) => entry.key).join(', ')})`
    );
    const theirs = await getMemberBreakdown(other.id, { by: 'day', window: WINDOW, limit: 100 });
    check(near(theirs.totals.costUsd, 0.08), 'the other person has rows of their own…');
    check(theirs.totals.costRows === 1, '…and sees only that one, none of ours');

    console.log('\n5. One turn, with its side costs');
    const turn = await getTurnMeter(ours.id, TURN_ID);
    check(turn !== null, 'the turn is found by its person and id');
    if (turn) {
      check(
        turn.costRows === 3,
        `three cost rows: two tagged, one reply embedding (${turn.rows.map((row) => row.part).join(', ')})`
      );
      check(near(turn.costUsd, 0.011), `$${turn.costUsd} in all`);
      check(
        near(turn.replyCostUsd, 0.01) && near(turn.sideCostUsd, 0.001),
        'split into her reply and what it caused'
      );
      check(turn.unpricedRows === 1, 'with the unpriced summary said so');
      check(
        turn.model === 'gpt-4o-mini' &&
          turn.fingerprintVersion === '1' &&
          turn.seat === 'facilitator',
        'model, fingerprint version and seat from the turn record'
      );
      check(
        !turn.rows.some((row) => near(row.costUsd, 0.02)),
        'the untagged pre-tagging row is not claimed by the turn'
      );
    }
    check(
      (await getTurnMeter(other.id, TURN_ID)) === null,
      'another person asking for the same turn id gets nothing'
    );

    if (failures > 0) throw new Error(`${failures} check(s) failed`);
    console.log('\n✓ smoke:app-metering passed\n');
  } finally {
    await sweep().catch((err: unknown) => console.error('sweep failed:', err));
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('\n✗ smoke:app-metering failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
