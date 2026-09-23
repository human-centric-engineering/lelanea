// @vitest-environment happy-dom

/**
 * The admin cost view as an admin reads it (f-budget t-97).
 *
 * `cost-view.test.ts` decides the judgements; this proves the page says them —
 * and the three things it must not get wrong: platform cost is its own figure
 * and never a person; a short total says so; the headline is the API's total,
 * not a sum of whichever rows were listed.
 *
 * @see components/app/admin/cost-view.tsx
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  ConversationTurnsView,
  CostOverview,
  TurnCostView,
  type CostOverviewProps,
} from '@/components/app/admin/cost-view';
import type {
  ConversationGroup,
  CostBreakdown,
  CostGroup,
  PersonGroup,
  TurnReading,
} from '@/lib/app/agent/cost-view';

const WINDOW = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-23T14:30:00.000Z' };
const ADA = 'cmu0000000000000000000ada';

function totals(costUsd: number, platformCostUsd: number, unpricedRows = 0) {
  return { costUsd, inputTokens: 0, outputTokens: 0, costRows: 40, unpricedRows, platformCostUsd };
}

function group<G extends CostGroup>(key: string | null, costUsd: number, extra: object = {}): G {
  return {
    key,
    costUsd,
    inputTokens: 0,
    outputTokens: 0,
    costRows: 2,
    unpricedRows: 0,
    ...extra,
  } as G;
}

function breakdown<G extends CostGroup>(
  by: string,
  groups: G[],
  over: Partial<CostBreakdown<G>> = {}
): CostBreakdown<G> {
  return { by, window: WINDOW, totals: totals(30, 4), groups, truncated: false, ...over };
}

function props(over: Partial<CostOverviewProps> = {}): CostOverviewProps {
  return {
    byUser: breakdown<PersonGroup>('user', [
      group(ADA, 21, {
        user: { name: 'Ada', email: 'ada@example.com' },
        ceiling: { ceilingUsd: 20, source: 'override' },
      }),
      group('cmu000000000000000000bea', 5, {
        user: { name: 'Bea', email: 'bea@example.com' },
        ceiling: { ceilingUsd: 20, source: 'default' },
      }),
      group(null, 4, { user: null, ceiling: null }),
    ]),
    byConversation: breakdown<ConversationGroup>('conversation', [
      group('cmuconvbig00000000000000', 12, {
        conversation: { title: 'Loyalty', userId: ADA, user: { name: 'Ada', email: 'a@x' } },
      }),
      group('cmuconv100000000000000000', 1, { conversation: null }),
      group('cmuconv200000000000000000', 1.2, { conversation: null }),
      group('cmuconv300000000000000000', 0.9, { conversation: null }),
      group(null, 2, { conversation: null }),
    ]),
    bySeat: breakdown('seat', [group('conversation', 26)]),
    byModel: breakdown('model', [group('claude-sonnet-5', 26)]),
    byDay: breakdown('day', [group('2026-09-22', 10)]),
    ...over,
  };
}

const figureOf = (name: string) =>
  document.querySelector(`[data-figure="${name}"]`)?.textContent ?? '';

describe('CostOverview — the headline', () => {
  it("states the API's total, not a sum of the listed rows", () => {
    // The people listed come to $30 with platform, but the list is cut: the
    // API's total covers every row, and that is the one the page states.
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>(
            'user',
            [group(ADA, 3, { user: { name: 'Ada', email: 'a@x' }, ceiling: null })],
            { totals: totals(97.5, 4), truncated: true }
          ),
        })}
      />
    );
    expect(figureOf('total')).toBe('$97.50');
    expect(screen.getByText(/The 1 largest are listed/)).toBeTruthy();
  });

  it('names platform cost as its own figure', () => {
    render(<CostOverview {...props()} />);
    expect(figureOf('platform')).toBe('$4.00');
    expect(figureOf('people')).toBe('$26.00');
  });

  it('says "at least" wherever a total is short', () => {
    render(
      <CostOverview
        {...props({ byUser: breakdown<PersonGroup>('user', [], { totals: totals(30, 4, 2) }) })}
      />
    );
    expect(figureOf('total')).toBe('at least $30.00');
    expect(screen.getAllByText(/2 unpriced rows/).length).toBeGreaterThan(0);
  });
});

describe('CostOverview — who', () => {
  it('never lists the platform group as a person', () => {
    render(<CostOverview {...props()} />);
    const who = screen.getByRole('region', { name: 'Who' });
    expect(within(who).getAllByRole('row')).toHaveLength(3); // header + Ada + Bea
    expect(who.querySelector('[data-person=""]')).toBeNull();
  });

  it('flags a person past their limit, by how much, and not one under it', () => {
    render(<CostOverview {...props()} />);
    const ada = document.querySelector(`[data-person="${ADA}"]`) as HTMLElement;
    const bea = document.querySelector('[data-person="cmu000000000000000000bea"]') as HTMLElement;
    expect(within(ada).getByText('past limit by $1.00')).toBeTruthy();
    expect(within(ada).getByText(/their own/)).toBeTruthy();
    expect(within(bea).queryByText(/limit by|at limit/)).toBeNull();
  });
});

describe('CostOverview — which conversations', () => {
  it('links each conversation to its turns, and flags the one far above the rest', () => {
    render(<CostOverview {...props()} />);
    const big = document.querySelector(
      '[data-conversation="cmuconvbig00000000000000"]'
    ) as HTMLElement;
    expect(within(big).getByRole('link', { name: 'Loyalty' }).getAttribute('href')).toBe(
      '/admin/app/cost/conversations/cmuconvbig00000000000000'
    );
    expect(within(big).getByText('far above the rest')).toBeTruthy();
    expect(screen.getAllByText('far above the rest')).toHaveLength(1);
  });

  it('shows rows with no conversation as such, with nothing to open', () => {
    render(<CostOverview {...props()} />);
    const none = document.querySelector('[data-conversation=""]') as HTMLElement;
    expect(within(none).getByText('Not in a conversation')).toBeTruthy();
    expect(within(none).queryByRole('link')).toBeNull();
  });
});

describe('CostOverview — a read that failed', () => {
  it('says so where its table would be, and the rest of the page stands', () => {
    render(<CostOverview {...props({ byConversation: null })} />);
    const conversations = screen.getByRole('region', { name: 'Which conversations' });
    expect(within(conversations).getByRole('alert').textContent).toContain('did not load');
    expect(screen.getByRole('region', { name: 'Who' }).querySelector('[role="alert"]')).toBeNull();
    expect(figureOf('total')).toBe('$30.00');
  });

  it('says the month itself could not be read when nothing loaded', () => {
    render(
      <CostOverview byUser={null} byConversation={null} bySeat={null} byModel={null} byDay={null} />
    );
    expect(screen.getByText(/This month's figures did not load/)).toBeTruthy();
    expect(document.querySelector('[data-figure]')).toBeNull();
  });
});

describe('ConversationTurnsView', () => {
  it('links each turn by person and turn id, costliest first as handed', () => {
    render(
      <ConversationTurnsView
        reading={{
          conversationId: 'c',
          window: WINDOW,
          truncated: false,
          turns: [
            {
              turnId: 'turn-dear',
              userId: ADA,
              seat: 'conversation',
              status: 'completed',
              attempts: 2,
              errorCode: null,
              model: 'claude-sonnet-5',
              startedAt: '2026-09-22T10:00:00.000Z',
              completedAt: '2026-09-22T10:00:09.000Z',
              costUsd: 0.42,
              costRows: 5,
              unpricedRows: 1,
            },
          ],
        }}
      />
    );
    const row = document.querySelector('[data-turn="turn-dear"]') as HTMLElement;
    expect(within(row).getByRole('link').getAttribute('href')).toBe(
      `/admin/app/cost/turns/${ADA}/turn-dear`
    );
    expect(row.textContent).toContain('at least $0.42');
    expect(row.textContent).toContain('2 attempts');
  });

  it('says there were none rather than drawing an empty table', () => {
    render(
      <ConversationTurnsView
        reading={{ conversationId: 'c', window: WINDOW, truncated: false, turns: [] }}
      />
    );
    expect(screen.getByText(/No turns in this conversation started in/)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('TurnCostView', () => {
  const reading: TurnReading = {
    turnId: 't',
    seat: 'conversation',
    status: 'completed',
    attempts: 1,
    errorCode: null,
    model: 'claude-sonnet-5',
    provider: 'anthropic',
    conversationId: 'cmuconvbig00000000000000',
    startedAt: '2026-09-22T10:00:00.000Z',
    completedAt: '2026-09-22T10:00:09.000Z',
    costUsd: 0.3,
    inputTokens: 100,
    outputTokens: 50,
    costRows: 3,
    unpricedRows: 1,
    replyCostUsd: 0.25,
    sideCostUsd: 0.05,
    rows: [
      {
        id: 'r1',
        part: 'reply',
        operation: 'chat',
        model: 'claude-sonnet-5',
        provider: 'anthropic',
        inputTokens: 80,
        outputTokens: 50,
        costUsd: 0.25,
        unpriced: false,
        createdAt: '2026-09-22T10:00:08.000Z',
      },
      {
        id: 'r2',
        part: 'search',
        operation: 'embedding',
        model: 'text-embed',
        provider: 'voyage',
        inputTokens: 20,
        outputTokens: 0,
        costUsd: 0,
        unpriced: true,
        createdAt: '2026-09-22T10:00:02.000Z',
      },
    ],
  };

  it('splits the reply from what the turn spent on the side', () => {
    render(<TurnCostView reading={reading} />);
    expect(figureOf('turn')).toBe('at least $0.30');
    expect(figureOf('reply')).toBe('$0.25');
    expect(figureOf('side')).toBe('$0.05');
  });

  it('says a row has no price rather than printing $0.00 for it', () => {
    render(<TurnCostView reading={reading} />);
    expect(screen.getByText('no price on file')).toBeTruthy();
  });

  it('links back up to its conversation', () => {
    render(<TurnCostView reading={reading} />);
    expect(screen.getByRole('link', { name: 'its conversation' }).getAttribute('href')).toBe(
      '/admin/app/cost/conversations/cmuconvbig00000000000000'
    );
  });
});
