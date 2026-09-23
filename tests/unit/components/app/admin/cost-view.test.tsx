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

function totals(
  costUsd: number,
  platformCostUsd: number,
  unpricedRows = 0,
  platformUnpricedRows = 0
) {
  return {
    costUsd,
    inputTokens: 0,
    outputTokens: 0,
    costRows: 40,
    unpricedRows,
    platformCostUsd,
    platformUnpricedRows,
  };
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
    expect(screen.getByText(/No turns in this conversation had any cost in/)).toBeTruthy();
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

  it('splits the reply from the side, each a floor only for its own unpriced rows', () => {
    // The unpriced row is a search — a side cost — so the side is the floor
    // and the reply, fully priced, is stated exactly.
    render(<TurnCostView reading={reading} />);
    expect(figureOf('turn')).toBe('at least $0.30');
    expect(figureOf('reply')).toBe('$0.25');
    expect(figureOf('side')).toBe('at least $0.05');
  });

  it('calls the reply the reply — never "her" reply', () => {
    render(<TurnCostView reading={reading} />);
    expect(screen.getByText('The reply')).toBeTruthy();
    expect(screen.queryByText(/her reply/i)).toBeNull();
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

describe('CostOverview — the edges a table can meet', () => {
  it('names an erased account as such, and a person with no limit read as a dash', () => {
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>('user', [
            group('cmu00000000000000000gone', 2, { user: null, ceiling: null }),
          ]),
        })}
      />
    );
    const row = document.querySelector('[data-person="cmu00000000000000000gone"]') as HTMLElement;
    expect(row.textContent).toContain('An account that no longer exists');
    expect(row.textContent).toContain('—');
  });

  it('says there is nothing yet, rather than drawing empty tables', () => {
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>('user', [group(null, 4, { user: null, ceiling: null })]),
          byConversation: breakdown<ConversationGroup>('conversation', []),
          bySeat: breakdown('seat', []),
        })}
      />
    );
    expect(screen.getByText('No one has spent anything yet this month.')).toBeTruthy();
    expect(screen.getByText('No conversation has cost anything yet this month.')).toBeTruthy();
    expect(screen.getByText('Nothing yet this month.')).toBeTruthy();
  });

  it('flags spend against a limit of nothing, and a person exactly at their limit', () => {
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>('user', [
            group('cmu000000000000000000zer', 0.2, {
              user: { name: 'Zed', email: 'z@x' },
              ceiling: { ceilingUsd: 0, source: 'override' },
            }),
            group('cmu000000000000000000eql', 20, {
              user: { name: 'Eve', email: 'e@x' },
              ceiling: { ceilingUsd: 20, source: 'default' },
            }),
          ]),
        })}
      />
    );
    expect(screen.getByText('spent against a $0 limit')).toBeTruthy();
    expect(screen.getByText('at limit')).toBeTruthy();
  });

  it('calls an untitled conversation that, and says a cut conversation list is cut', () => {
    render(
      <CostOverview
        {...props({
          byConversation: breakdown<ConversationGroup>(
            'conversation',
            [
              group('cmuconvuntitled0000000000', 3, {
                conversation: { title: null, userId: null, user: null },
              }),
            ],
            { truncated: true }
          ),
          bySeat: breakdown('seat', [group(null, 1)], { truncated: true }),
        })}
      />
    );
    expect(screen.getByRole('link', { name: 'Untitled conversation' })).toBeTruthy();
    expect(screen.getAllByText(/largest are listed/).length).toBe(2);
    expect(screen.getByText('No seat')).toBeTruthy();
  });
});

describe('ConversationTurnsView and TurnCostView — what went wrong, said plainly', () => {
  it('names a turn that ended on an error, and a cut turn list', () => {
    render(
      <ConversationTurnsView
        reading={{
          conversationId: 'c',
          window: WINDOW,
          truncated: true,
          turns: [
            {
              turnId: 'failed',
              userId: ADA,
              seat: 'conversation',
              status: 'failed',
              attempts: 1,
              errorCode: 'timed_out',
              model: null,
              startedAt: '2026-09-22T10:00:00.000Z',
              completedAt: null,
              costUsd: 0.02,
              costRows: 1,
              unpricedRows: 0,
            },
          ],
        }}
      />
    );
    const row = document.querySelector('[data-turn="failed"]') as HTMLElement;
    expect(row.textContent).toContain('timed_out');
    expect(row.textContent).toContain('—');
    expect(screen.getByText(/costliest turns are listed/)).toBeTruthy();
  });

  it('says how a turn ended and offers no conversation link when it had none', () => {
    render(
      <TurnCostView
        reading={{
          turnId: 't',
          seat: 'onboarding',
          status: 'failed',
          attempts: 3,
          errorCode: 'unavailable',
          model: null,
          provider: null,
          conversationId: null,
          startedAt: '2026-09-22T10:00:00.000Z',
          completedAt: null,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          costRows: 0,
          unpricedRows: 0,
          replyCostUsd: 0,
          sideCostUsd: 0,
          rows: [],
        }}
      />
    );
    expect(
      screen.getByText(/no model recorded · failed · 3 attempts · ended unavailable/)
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'its conversation' })).toBeNull();
  });
});

describe('CostOverview — round 1 of review (t-97)', () => {
  it('puts each unpriced row on its own half of the headline', () => {
    // Two unpriced rows, both the platform's: the platform figure is the floor,
    // and the people's — every row priced — is stated exactly.
    render(
      <CostOverview
        {...props({ byUser: breakdown<PersonGroup>('user', [], { totals: totals(30, 4, 2, 2) }) })}
      />
    );
    expect(figureOf('platform')).toBe('at least $4.00');
    expect(figureOf('people')).toBe('$26.00');
  });

  it('counts the people shown when it says the list was cut, not the groups returned', () => {
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>(
            'user',
            [
              group(ADA, 3, { user: { name: 'Ada', email: 'a@x' }, ceiling: null }),
              group(null, 9, { user: null, ceiling: null }),
            ],
            { truncated: true }
          ),
        })}
      />
    );
    expect(screen.getByText(/The 1 largest are listed/)).toBeTruthy();
  });

  it('never says a person is past their limit by $0.00', () => {
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>('user', [
            group(ADA, 5.0004, {
              user: { name: 'Ada', email: 'a@x' },
              ceiling: { ceilingUsd: 5, source: 'default' },
            }),
          ]),
        })}
      />
    );
    expect(screen.getByText('past limit by <$0.01')).toBeTruthy();
  });
});

describe('round 3 of review (t-97)', () => {
  it('holds the people half at zero against float noise from the subtraction', () => {
    render(
      <CostOverview
        {...props({
          byUser: breakdown<PersonGroup>('user', [], {
            totals: totals(0.1 + 0.2, 0.30000000000000004 + 1e-17),
          }),
        })}
      />
    );
    expect(figureOf('people')).toBe('$0.00');
  });

  it('keys turn rows by person and id, so two people\u2019s same id are two rows', () => {
    const turn = {
      turnId: 'turn-1',
      seat: 'conversation',
      status: 'completed',
      attempts: 1,
      errorCode: null,
      model: null,
      startedAt: '2026-09-22T10:00:00.000Z',
      completedAt: null,
      costUsd: 0.1,
      costRows: 1,
      unpricedRows: 0,
    };
    render(
      <ConversationTurnsView
        reading={{
          conversationId: 'c',
          window: WINDOW,
          truncated: false,
          turns: [
            { ...turn, userId: ADA },
            { ...turn, userId: 'cmu000000000000000000bea' },
          ],
        }}
      />
    );
    const links = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links).toEqual([
      `/admin/app/cost/turns/${ADA}/turn-1`,
      '/admin/app/cost/turns/cmu000000000000000000bea/turn-1',
    ]);
  });
});
