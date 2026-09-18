/**
 * The meter's read module — what the TypeScript around the SQL decides (§08 t-56).
 *
 * **What this file does not prove, and where that is proved.** Every aggregate
 * is computed in SQL: totals reconciling to the cost rows, user-less rows
 * landing in platform cost, an untagged row seated by its conversation. The unit
 * harness has no database (`B9`), and a mock that returned those sums would only
 * echo them — so those properties are proved against real Postgres by
 * `npm run smoke:app-metering` (`scripts/app/smoke-metering.ts`), on a fixture
 * of tagged, pre-tagging and user-less rows.
 *
 * What IS decided here, and tested here: which person's id reaches the query
 * (the scoping every authorization answer rests on), truncation that leaves the
 * totals whole, coercion of Postgres aggregates, the names on a by-user
 * breakdown, month-to-date arithmetic against the ceiling, and how one turn's
 * cost rows are found, classified and summed.
 *
 * @see lib/app/agent/metering.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryRaw, findTurn, findCostRows, findUsers, getEffectiveMonthlyCeiling } = vi.hoisted(
  () => ({
    queryRaw: vi.fn(),
    findTurn: vi.fn(),
    findCostRows: vi.fn(),
    findUsers: vi.fn(),
    getEffectiveMonthlyCeiling: vi.fn(),
  })
);

vi.mock('@/lib/db/client', () => ({
  prisma: {
    $queryRaw: queryRaw,
    appTurn: { findUnique: findTurn },
    aiCostLog: { findMany: findCostRows },
    user: { findMany: findUsers },
  },
}));
vi.mock('@/lib/app/agent/settings', () => ({ getEffectiveMonthlyCeiling }));

import {
  classifyCostRow,
  getAdminBreakdown,
  getMemberBreakdown,
  getMonthToDate,
  getTurnMeter,
  monthToDateWindow,
  resolveWindow,
} from '@/lib/app/agent/metering';

const ME = 'cmu0000000000000000000me';
const WINDOW = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-09-18T12:00:00Z') };

/** The bound values of a tagged-template `$queryRaw` call — what reaches Postgres. */
function boundValues(call: unknown[]): unknown[] {
  return call.slice(1);
}

/** The SQL text of a `$queryRaw` call, placeholders elided. */
function sqlText(call: unknown[]): string {
  return (call[0] as TemplateStringsArray).join('?');
}

function rawTotals(overrides: Record<string, unknown> = {}) {
  return {
    cost_usd: 0,
    input_tokens: 0n,
    output_tokens: 0n,
    cost_rows: 0n,
    unpriced_rows: 0n,
    ...overrides,
  };
}

/** Answer the groups query first and the totals query second, as Promise.all sends them. */
function answerBreakdown(groups: unknown[], totals: Record<string, unknown>) {
  queryRaw.mockImplementation((strings: TemplateStringsArray) =>
    Promise.resolve(strings.join('').includes('GROUP BY key') ? groups : [totals])
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('windows', () => {
  it('month to date starts at the first UTC instant of the month', () => {
    const now = new Date('2026-09-18T12:34:56Z');
    expect(monthToDateWindow(now)).toEqual({ from: new Date('2026-09-01T00:00:00Z'), to: now });
  });

  it('fills whichever end is missing, anchoring the month on `to`', () => {
    const now = new Date('2026-09-18T00:00:00Z');
    expect(resolveWindow({}, now)).toEqual({ from: new Date('2026-09-01T00:00:00Z'), to: now });
    const to = new Date('2026-07-10T00:00:00Z');
    expect(resolveWindow({ to }, now)).toEqual({ from: new Date('2026-07-01T00:00:00Z'), to });
    const from = new Date('2026-01-01T00:00:00Z');
    expect(resolveWindow({ from }, now)).toEqual({ from, to: now });
  });
});

describe('breakdowns', () => {
  it("a member's breakdown binds their id into BOTH queries", async () => {
    answerBreakdown([], rawTotals());
    await getMemberBreakdown(ME, { by: 'seat', window: WINDOW, limit: 10 });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const call of queryRaw.mock.calls) {
      expect(sqlText(call)).toContain('IS NULL OR c."userId" = ');
      // The id is bound twice in each: the IS NULL test and the comparison.
      expect(boundValues(call).filter((value) => value === ME)).toHaveLength(2);
    }
  });

  it('an admin breakdown with no person binds null, so every row counts — platform included', async () => {
    answerBreakdown([], rawTotals());
    await getAdminBreakdown({ by: 'model', window: WINDOW, limit: 10 });

    for (const call of queryRaw.mock.calls) {
      expect(boundValues(call).filter((value) => value === null)).toHaveLength(2);
      expect(boundValues(call)).not.toContain(ME);
    }
  });

  it('binds the dimension and the window as parameters, never as SQL text', async () => {
    answerBreakdown([], rawTotals());
    await getAdminBreakdown({ by: 'day', window: WINDOW, limit: 10 });

    const groups = queryRaw.mock.calls.find((call) => sqlText(call).includes('GROUP BY key'))!;
    expect(boundValues(groups)).toEqual(expect.arrayContaining(['day', WINDOW.from, WINDOW.to]));
    expect(sqlText(groups)).not.toContain('2026-09');
    // limit + 1, so one more row than asked for says there were more.
    expect(boundValues(groups)).toContain(11);
  });

  it('coerces bigint and numeric-string aggregates, and reports platform cost', async () => {
    answerBreakdown(
      [
        {
          key: 'gpt-4o-mini',
          ...rawTotals({ cost_usd: '0.25', input_tokens: 1000n, cost_rows: 4n }),
        },
      ],
      rawTotals({
        cost_usd: '0.30',
        input_tokens: 1200n,
        output_tokens: 80n,
        cost_rows: 5n,
        unpriced_rows: 1n,
        platform_cost_usd: '0.05',
      })
    );

    const result = await getAdminBreakdown({ by: 'model', window: WINDOW, limit: 10 });

    expect(result.totals).toEqual({
      costUsd: 0.3,
      inputTokens: 1200,
      outputTokens: 80,
      costRows: 5,
      unpricedRows: 1,
      platformCostUsd: 0.05,
    });
    expect(result.groups).toEqual([
      {
        key: 'gpt-4o-mini',
        costUsd: 0.25,
        inputTokens: 1000,
        outputTokens: 0,
        costRows: 4,
        unpricedRows: 0,
      },
    ]);
  });

  it('an empty window is zeros, not NaN — SUM over no rows is NULL', async () => {
    answerBreakdown([], rawTotals({ cost_usd: null, input_tokens: null, platform_cost_usd: null }));
    const result = await getMemberBreakdown(ME, { by: 'day', window: WINDOW, limit: 10 });
    expect(result.totals.costUsd).toBe(0);
    expect(result.totals.inputTokens).toBe(0);
    expect(result.totals.platformCostUsd).toBe(0);
    expect(result.groups).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('drops the extra group and says so, leaving the totals as the query gave them', async () => {
    const groups = ['a', 'b', 'c'].map((key) => ({ key, ...rawTotals({ cost_usd: 1 }) }));
    answerBreakdown(groups, rawTotals({ cost_usd: 3, cost_rows: 3n }));

    const result = await getMemberBreakdown(ME, { by: 'conversation', window: WINDOW, limit: 2 });

    expect(result.groups.map((group) => group.key)).toEqual(['a', 'b']);
    expect(result.truncated).toBe(true);
    expect(result.totals.costUsd).toBe(3);
  });

  it('names each person on a by-user breakdown in one read, and leaves platform cost unnamed', async () => {
    answerBreakdown(
      [
        { key: ME, ...rawTotals({ cost_usd: 2 }) },
        { key: null, ...rawTotals({ cost_usd: 1 }) },
        { key: 'cmu-erased-or-unknown', ...rawTotals({ cost_usd: 0.5 }) },
      ],
      rawTotals({ cost_usd: 3.5 })
    );
    findUsers.mockResolvedValue([{ id: ME, name: 'Ada', email: 'ada@example.com' }]);

    const result = await getAdminBreakdown({ by: 'user', window: WINDOW, limit: 10 });

    expect(findUsers).toHaveBeenCalledTimes(1);
    expect(findUsers.mock.calls[0][0]).toMatchObject({
      where: { id: { in: [ME, 'cmu-erased-or-unknown'] } },
    });
    expect(result.groups.map((group) => ('user' in group ? group.user : undefined))).toEqual([
      { name: 'Ada', email: 'ada@example.com' },
      null,
      null,
    ]);
  });

  it('does not look anyone up for any other dimension', async () => {
    answerBreakdown([{ key: 'onboarding', ...rawTotals() }], rawTotals());
    const result = await getAdminBreakdown({ by: 'seat', window: WINDOW, limit: 10 });
    expect(findUsers).not.toHaveBeenCalled();
    expect(result.groups[0]).not.toHaveProperty('user');
  });
});

describe('month to date', () => {
  const NOW = new Date('2026-09-18T12:00:00Z');

  it("sums this person's month and sets it against their ceiling", async () => {
    queryRaw.mockResolvedValue([rawTotals({ cost_usd: 1.25, cost_rows: 12n, unpriced_rows: 1n })]);
    getEffectiveMonthlyCeiling.mockResolvedValue({ ceilingUsd: 5, source: 'default' });

    const usage = await getMonthToDate(ME, NOW);

    expect(boundValues(queryRaw.mock.calls[0])).toEqual([
      ME,
      new Date('2026-09-01T00:00:00Z'),
      NOW,
    ]);
    expect(getEffectiveMonthlyCeiling).toHaveBeenCalledWith(ME);
    expect(usage).toMatchObject({
      userId: ME,
      costUsd: 1.25,
      costRows: 12,
      unpricedRows: 1,
      ceiling: { ceilingUsd: 5, source: 'default' },
      remainingUsd: 3.75,
      fractionUsed: 0.25,
    });
  });

  it('over the ceiling: nothing remaining, and the fraction says by how much', async () => {
    queryRaw.mockResolvedValue([rawTotals({ cost_usd: 7.5 })]);
    getEffectiveMonthlyCeiling.mockResolvedValue({ ceilingUsd: 5, source: 'override' });
    const usage = await getMonthToDate(ME, NOW);
    expect(usage.remainingUsd).toBe(0);
    expect(usage.fractionUsed).toBe(1.5);
  });

  it('a zero ceiling has no fraction rather than Infinity', async () => {
    queryRaw.mockResolvedValue([rawTotals({ cost_usd: 0.1 })]);
    getEffectiveMonthlyCeiling.mockResolvedValue({ ceilingUsd: 0, source: 'override' });
    const usage = await getMonthToDate(ME, NOW);
    expect(usage.fractionUsed).toBeNull();
    expect(usage.remainingUsd).toBe(0);
  });
});

describe('classifying a turn cost row', () => {
  it.each([
    [{ operation: 'chat', kind: null }, 'reply'],
    [{ operation: 'chat', kind: 'conversation_summary' }, 'summary'],
    [{ operation: 'tool_call', kind: null }, 'tool'],
    [{ operation: 'embedding', kind: 'knowledge_search' }, 'knowledge_search'],
    [{ operation: 'embedding', kind: 'message_embedding' }, 'reply_embedding'],
    [{ operation: 'vision', kind: null }, 'attachment'],
    [{ operation: 'evaluation', kind: null }, 'other'],
  ])('%o is %s', (row, part) => {
    expect(classifyCostRow(row)).toBe(part);
  });
});

describe('one turn', () => {
  const TURN = {
    id: 'turn-row',
    userId: ME,
    turnId: 'client-turn-1',
    seat: 'onboarding',
    agentSlug: 'lelanea-guide',
    status: 'completed',
    attempts: 2,
    errorCode: null,
    fingerprintVersion: '3',
    modelId: 'gpt-4o-mini',
    providerSlug: 'openai',
    pricing: 'priced',
    conversationId: 'conv-1',
    assistantMessageId: 'msg-reply',
    startedAt: new Date('2026-09-18T10:00:00Z'),
    completedAt: new Date('2026-09-18T10:00:04Z'),
    costUsd: 0.004,
  };

  function costRow(overrides: Record<string, unknown>) {
    return {
      id: 'c',
      operation: 'chat',
      model: 'gpt-4o-mini',
      provider: 'openai',
      inputTokens: 100,
      outputTokens: 10,
      totalCostUsd: 0.001,
      isLocal: false,
      metadata: { turnId: TURN.turnId, seat: 'onboarding' },
      createdAt: new Date('2026-09-18T10:00:01Z'),
      ...overrides,
    };
  }

  it('is nothing when this person has no such turn — and no cost row is read', async () => {
    findTurn.mockResolvedValue(null);
    expect(await getTurnMeter(ME, 'someone-elses-turn')).toBeNull();
    expect(findTurn).toHaveBeenCalledWith({
      where: { userId_turnId: { userId: ME, turnId: 'someone-elses-turn' } },
    });
    expect(findCostRows).not.toHaveBeenCalled();
  });

  it("finds its rows by this person AND the turn's tag, or its reply's embedding", async () => {
    findTurn.mockResolvedValue(TURN);
    findCostRows.mockResolvedValue([]);
    await getTurnMeter(ME, TURN.turnId);

    const { where } = findCostRows.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(where.userId).toBe(ME);
    expect(where.OR).toEqual([
      { metadata: { path: ['turnId'], equals: TURN.turnId } },
      {
        AND: [
          { metadata: { path: ['kind'], equals: 'message_embedding' } },
          { metadata: { path: ['messageId'], equals: 'msg-reply' } },
        ],
      },
    ]);
  });

  it('with no linked reply, asks only for tagged rows', async () => {
    findTurn.mockResolvedValue({ ...TURN, assistantMessageId: null, status: 'failed' });
    findCostRows.mockResolvedValue([]);
    await getTurnMeter(ME, TURN.turnId);
    const { where } = findCostRows.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(where.OR).toHaveLength(1);
  });

  it('says what produced it and sums every row it caused, reply apart from side costs', async () => {
    findTurn.mockResolvedValue(TURN);
    findCostRows.mockResolvedValue([
      // Two attempts' replies — a failed first attempt was spent too.
      costRow({ id: 'r1', totalCostUsd: 0.002 }),
      costRow({ id: 'r2', totalCostUsd: 0.003 }),
      costRow({
        id: 's',
        totalCostUsd: 0,
        inputTokens: 40,
        outputTokens: 4,
        metadata: { turnId: TURN.turnId, kind: 'conversation_summary' },
      }),
      costRow({
        id: 't',
        operation: 'tool_call',
        model: 'n/a',
        provider: 'capability',
        inputTokens: 0,
        outputTokens: 0,
        totalCostUsd: 0,
        metadata: { turnId: TURN.turnId, slug: 'search_knowledge_base', success: true },
      }),
      costRow({
        id: 'e',
        operation: 'embedding',
        outputTokens: 0,
        inputTokens: 20,
        totalCostUsd: 0.0005,
        metadata: { kind: 'message_embedding', messageId: 'msg-reply' },
      }),
    ]);

    const meter = await getTurnMeter(ME, TURN.turnId);

    expect(meter).toMatchObject({
      turnId: TURN.turnId,
      seat: 'onboarding',
      fingerprintVersion: '3',
      model: 'gpt-4o-mini',
      provider: 'openai',
      pricing: 'priced',
      attempts: 2,
      costRows: 5,
      inputTokens: 260,
      outputTokens: 24,
      // The unpriced summary is the only $0 row with tokens; the tool row has none.
      unpricedRows: 1,
    });
    expect(meter!.costUsd).toBeCloseTo(0.0055, 10);
    expect(meter!.replyCostUsd).toBeCloseTo(0.005, 10);
    expect(meter!.sideCostUsd).toBeCloseTo(0.0005, 10);
    expect(meter!.rows.map((row) => [row.id, row.part, row.unpriced])).toEqual([
      ['r1', 'reply', false],
      ['r2', 'reply', false],
      ['s', 'summary', true],
      ['t', 'tool', false],
      ['e', 'reply_embedding', false],
    ]);
  });

  it("never reads dollars from the turn row's own costUsd", async () => {
    findTurn.mockResolvedValue({ ...TURN, costUsd: 99 });
    findCostRows.mockResolvedValue([costRow({ totalCostUsd: 0.001 })]);
    const meter = await getTurnMeter(ME, TURN.turnId);
    expect(meter!.costUsd).toBe(0.001);
  });

  it('a local provider at $0 is free, not unpriced', async () => {
    findTurn.mockResolvedValue(TURN);
    findCostRows.mockResolvedValue([costRow({ totalCostUsd: 0, isLocal: true })]);
    const meter = await getTurnMeter(ME, TURN.turnId);
    expect(meter!.unpricedRows).toBe(0);
  });
});
