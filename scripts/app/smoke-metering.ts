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
 * The admin drill-down (sections 6–8, t-98) has a fixture of its own in March —
 * a conversation of three turns, one of them retried across the month's start,
 * and another person's turn under the same id — tabled where it is built, so
 * January's figures above stay as they are.
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
  getConversationTurns,
  getMemberBreakdown,
  getMonthToDate,
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
/** The drill-down's month: March, so January's totals above are untouched. */
const MARCH = { from: new Date('2001-03-01T00:00:00Z'), to: new Date('2001-04-01T00:00:00Z') };

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

/** A day in the drill-down fixture: `month` is 1 for February, 2 for March. */
function inMonth(month: number, day: number): Date {
  return new Date(Date.UTC(2001, month, day, 12));
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
        'split into the reply and what it caused'
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

    // ── The drill-down (f-budget t-97, proved here at t-98) ──────────────────
    //
    // March: one conversation D, three turns of ours in it, and a decoy.
    //
    // | Turn  | Whose | How it is tied to D                         | Rows                                   | $     |
    // | ----- | ----- | ------------------------------------------- | -------------------------------------- | ----- |
    // | BIG   | ours  | turn table                                  | reply 0.05 + tool 0.002                | 0.052 |
    // | RETRY | ours  | only its tagged row in D — the retry reset  | 27 Feb attempt 0.02 + 1 Mar attempt    | 0.05  |
    // |       |       | `conversationId` to null on 5 Mar           | 0.03                                   |       |
    // | SMALL | ours  | turn table                                  | reply 0.01                             | 0.01  |
    // | RETRY | other | none — the same turn id, another person     | 0.07, no conversation                  | 0.07  |
    //
    // Costliest first is BIG, RETRY, SMALL: the order the turn rows were made
    // in is neither that nor its reverse, so a missing sort cannot pass.
    const turnIds = {
      big: `${PREFIX}-big`,
      retry: `${PREFIX}-retry`,
      small: `${PREFIX}-small`,
    };
    const d = await prisma.aiConversation.create({
      data: {
        agentId: agent.id,
        userId: ours.id,
        contextType: 'facilitation',
        contextId: 'onboarding',
        title: `${PREFIX} conversation D`,
      },
      select: { id: true },
    });
    const turnRow = (
      userId: string,
      turnId: string,
      extra: {
        conversationId: string | null;
        startedAt: Date;
        status: 'completed' | 'running';
        attempts?: number;
      }
    ) => ({
      userId,
      turnId,
      clientSupplied: true,
      requestHash: PREFIX,
      seat: 'facilitator',
      agentSlug: VOICE_AGENT_SLUG,
      fingerprintVersion: '1',
      modelId: 'gpt-4o-mini',
      providerSlug: 'openai',
      completedAt: extra.status === 'completed' ? extra.startedAt : null,
      ...extra,
    });
    await prisma.appTurn.createMany({
      data: [
        turnRow(ours.id, turnIds.small, {
          conversationId: d.id,
          startedAt: inMonth(2, 4),
          status: 'completed',
        }),
        turnRow(ours.id, turnIds.retry, {
          conversationId: null,
          startedAt: inMonth(2, 5),
          status: 'running',
          attempts: 3,
        }),
        turnRow(ours.id, turnIds.big, {
          conversationId: d.id,
          startedAt: inMonth(2, 3),
          status: 'completed',
        }),
        turnRow(other.id, turnIds.retry, {
          conversationId: null,
          startedAt: inMonth(2, 2),
          status: 'completed',
        }),
      ],
    });
    const tag = (turnId: string) => ({ ...MARK, turnId, seat: 'facilitator' });
    const row = (
      userId: string,
      conversationId: string | null,
      turnId: string,
      operation: string,
      costUsd: number,
      createdAt: Date
    ) => ({
      ...base,
      userId,
      conversationId,
      operation,
      inputTokens: 10,
      outputTokens: 1,
      totalCostUsd: costUsd,
      metadata: tag(turnId),
      createdAt,
    });
    await prisma.aiCostLog.createMany({
      data: [
        row(ours.id, d.id, turnIds.big, 'tool_call', 0.002, inMonth(2, 3)),
        row(ours.id, d.id, turnIds.big, 'chat', 0.05, new Date(inMonth(2, 3).getTime() - 60_000)),
        row(ours.id, d.id, turnIds.retry, 'chat', 0.02, inMonth(1, 27)),
        row(ours.id, d.id, turnIds.retry, 'chat', 0.03, inMonth(2, 1)),
        row(ours.id, d.id, turnIds.small, 'chat', 0.01, inMonth(2, 4)),
        row(other.id, null, turnIds.retry, 'chat', 0.07, inMonth(2, 2)),
      ],
    });
    const OURS_MARCH = 0.092; // 0.05 + 0.002 + 0.03 + 0.01 — the 27 Feb attempt is February's

    console.log('\n6. A conversation opens to its turns, costliest first, each at its whole cost');
    const listed = await getConversationTurns({ conversationId: d.id, window: MARCH, limit: 100 });
    const order = listed.turns.map((entry) => entry.turnId);
    check(
      order.join(',') === [turnIds.big, turnIds.retry, turnIds.small].join(','),
      `in order of cost (${order.map((id) => id.replace(`${PREFIX}-`, '')).join(', ')})`
    );
    check(
      listed.turns.every((entry) => entry.userId === ours.id),
      'every turn listed is ours — the other person’s turn of the same id is not among them'
    );
    check(!listed.truncated, 'and nothing was cut');
    const retried = listed.turns.find((entry) => entry.turnId === turnIds.retry);
    check(
      retried !== undefined && near(retried.costUsd, 0.05) && retried.costRows === 2,
      `the retried turn is still listed, though the retry cleared its link — $${retried?.costUsd} over ${retried?.costRows} rows, both attempts, February's included`
    );
    for (const entry of listed.turns) {
      const detail = await getTurnMeter(entry.userId, entry.turnId);
      check(
        detail !== null &&
          near(detail.costUsd, entry.costUsd) &&
          detail.costRows === entry.costRows,
        `${entry.turnId.replace(`${PREFIX}-`, '')}: the figure listed is the figure its own page shows ($${detail?.costUsd.toFixed(3)})`
      );
    }
    const cut = await getConversationTurns({ conversationId: d.id, window: MARCH, limit: 2 });
    check(
      cut.truncated &&
        cut.turns.map((entry) => entry.turnId).join(',') === [turnIds.big, turnIds.retry].join(','),
      'cut to two, it keeps the two costliest and says it was cut'
    );

    console.log('\n7. A turn opens to its rows, the reply apart from what it caused');
    const big = await getTurnMeter(ours.id, turnIds.big);
    check(
      big !== null && near(big.replyCostUsd, 0.05) && near(big.sideCostUsd, 0.002),
      `reply $${big?.replyCostUsd.toFixed(3)}, on the side $${big?.sideCostUsd.toFixed(3)}`
    );
    check(
      big?.rows.map((entry) => entry.part).join(',') === 'reply,tool',
      `its rows in the order they were written (${big?.rows.map((entry) => entry.part).join(', ')})`
    );

    console.log(
      '\n8. One person can say what their month cost, and the admin page who and what cost most'
    );
    const month = await getMonthToDate(ours.id, new Date('2001-03-20T00:00:00Z'));
    const theirMarch = await getMemberBreakdown(ours.id, { by: 'day', window: MARCH, limit: 100 });
    const people = await getAdminBreakdown({ by: 'user', window: MARCH, limit: 100 });
    const oursMarch = people.groups.find((entry) => entry.key === ours.id);
    check(
      near(month.costUsd, OURS_MARCH),
      `their month to date is $${month.costUsd}, from the rows themselves`
    );
    check(
      near(theirMarch.totals.costUsd, month.costUsd) &&
        near(oursMarch?.costUsd ?? -1, month.costUsd),
      'and the usage page, the admin page and the limit all read the same figure'
    );
    check(
      people.groups.map((entry) => entry.key).join(',') === [ours.id, other.id].join(','),
      'people are listed costliest first'
    );
    const conversations = await getAdminBreakdown({
      by: 'conversation',
      window: MARCH,
      limit: 100,
    });
    const top = conversations.groups[0];
    check(
      top?.key === d.id && near(top.costUsd, OURS_MARCH),
      `the costliest conversation leads, at $${top?.costUsd}`
    );
    check(
      top !== undefined &&
        'conversation' in top &&
        top.conversation?.title === `${PREFIX} conversation D` &&
        top.conversation.userId === ours.id,
      'with its title and its owner, so the view needs no second fetch'
    );
    const january = await getAdminBreakdown({ by: 'user', window: WINDOW, limit: 1 });
    check(january.groups[0]?.key === other.id, 'and a list cut to one keeps the costliest person');

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
