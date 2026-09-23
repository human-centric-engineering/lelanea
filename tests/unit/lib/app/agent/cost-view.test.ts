/**
 * What the admin cost view decides about its figures (f-budget t-97).
 *
 * Each case is a way the page could misstate a person or a total without any
 * test of the rendering noticing: a short total stated as exact, the platform
 * group read as a person, a runaway hidden by the mean it drags up, "everyone
 * is a runaway" on a month with three conversations.
 *
 * @see lib/app/agent/cost-view.ts
 */

import { describe, expect, it } from 'vitest';

import {
  figure,
  limitStanding,
  people,
  runawayConversations,
  windowLabel,
  type ConversationGroup,
  type CostBreakdown,
  type PersonGroup,
} from '@/lib/app/agent/cost-view';

const WINDOW = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-23T14:30:00.000Z' };
const TOTALS = {
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  costRows: 0,
  unpricedRows: 0,
  platformCostUsd: 0,
  platformUnpricedRows: 0,
};

function person(
  costUsd: number,
  ceilingUsd: number | null,
  key: string | null = 'p1'
): PersonGroup {
  return {
    key,
    costUsd,
    inputTokens: 0,
    outputTokens: 0,
    costRows: 1,
    unpricedRows: 0,
    user: key ? { name: 'Ada', email: 'ada@example.com' } : null,
    ceiling: ceilingUsd === null ? null : { ceilingUsd, source: 'default' },
  };
}

function conversations(costs: Array<[string | null, number]>): CostBreakdown<ConversationGroup> {
  return {
    by: 'conversation',
    window: WINDOW,
    totals: TOTALS,
    truncated: false,
    groups: costs.map(([key, costUsd]) => ({
      key,
      costUsd,
      inputTokens: 0,
      outputTokens: 0,
      costRows: 1,
      unpricedRows: 0,
      conversation: null,
    })),
  };
}

describe('figure', () => {
  it('states a total as it is when every row is priced', () => {
    expect(figure({ costUsd: 12.4, unpricedRows: 0 })).toBe('$12.40');
  });

  it('says "at least" when an unpriced row makes it short', () => {
    expect(figure({ costUsd: 12.4, unpricedRows: 3 })).toBe('at least $12.40');
  });

  it('never prints $0.00 for spend that exists — a cheap turn is <$0.01', () => {
    expect(figure({ costUsd: 0.0031, unpricedRows: 0 })).toBe('<$0.01');
    // And exact zero is still a fact.
    expect(figure({ costUsd: 0, unpricedRows: 0 })).toBe('$0.00');
  });
});

describe('limitStanding', () => {
  it('is nothing to say for someone under their limit', () => {
    expect(limitStanding(person(4, 20))).toEqual({ kind: 'under' });
  });

  it('is "at" on the limit exactly — the gate refuses the next turn there', () => {
    expect(limitStanding(person(20, 20))).toEqual({ kind: 'at' });
  });

  it('is "past", by how much, when the crossing turn completed', () => {
    const standing = limitStanding(person(21.5, 20));
    expect(standing?.kind).toBe('past');
    expect(standing?.kind === 'past' && standing.byUsd).toBeCloseTo(1.5);
  });

  it('names spend against a limit of nothing', () => {
    expect(limitStanding(person(0.3, 0))).toEqual({ kind: 'nothing-allowed' });
  });

  it('has no standing for the platform group, which has no limit', () => {
    expect(limitStanding(person(3, null, null))).toBeNull();
  });
});

describe('people', () => {
  it('leaves the platform group out, so it is never read as a person', () => {
    const breakdown: CostBreakdown<PersonGroup> = {
      by: 'user',
      window: WINDOW,
      totals: TOTALS,
      truncated: false,
      groups: [person(5, 20, 'p1'), person(9, null, null), person(2, 20, 'p2')],
    };
    expect(people(breakdown).map((group) => group.key)).toEqual(['p1', 'p2']);
  });
});

describe('runawayConversations', () => {
  it('flags one far above the typical conversation', () => {
    const flagged = runawayConversations(
      conversations([
        ['c1', 1],
        ['c2', 1.2],
        ['c3', 0.9],
        ['c4', 1.1],
        ['big', 9],
      ])
    );
    expect([...flagged]).toEqual(['big']);
  });

  it('measures against the median, which one runaway cannot drag up to hide itself', () => {
    // Mean here is (1+1+1+1+12)/5 = 3.2, so 3× the mean is 9.6 and 12 would
    // barely clear it; with two runaways the mean would hide both. The median
    // stays at 1.
    const flagged = runawayConversations(
      conversations([
        ['c1', 1],
        ['c2', 1],
        ['c3', 1],
        ['r1', 12],
        ['r2', 12],
      ])
    );
    expect([...flagged].sort()).toEqual(['r1', 'r2']);
  });

  it('flags nothing when there are too few conversations to have a typical one', () => {
    expect(
      runawayConversations(
        conversations([
          ['c1', 0.1],
          ['c2', 0.1],
          ['big', 50],
        ])
      ).size
    ).toBe(0);
  });

  it('neither measures nor flags the rows with no conversation', () => {
    const flagged = runawayConversations(
      conversations([
        ['c1', 1],
        ['c2', 1],
        ['c3', 1],
        ['c4', 1],
        [null, 40],
      ])
    );
    expect(flagged.size).toBe(0);
  });

  it('still flags a runaway when most conversations cost nothing', () => {
    // The median is $0; a multiple of nothing would flag nothing, and the $48
    // conversation would go unseen in the month it matters most.
    const flagged = runawayConversations(
      conversations([
        ['c1', 0],
        ['c2', 0],
        ['c3', 0],
        ['small', 0.02],
        ['big', 48],
      ])
    );
    expect([...flagged]).toEqual(['big']);
  });

  it('does not flag a cent or two among free conversations', () => {
    expect(
      runawayConversations(
        conversations([
          ['c1', 0],
          ['c2', 0],
          ['c3', 0],
          ['c4', 0.02],
        ])
      ).size
    ).toBe(0);
  });
});

describe('windowLabel', () => {
  it('reads in UTC, with the year', () => {
    expect(windowLabel(WINDOW)).toBe('1 September 2026 – 23 September 2026 (UTC)');
  });
});
