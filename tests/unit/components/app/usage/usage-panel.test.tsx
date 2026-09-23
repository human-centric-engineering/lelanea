// @vitest-environment happy-dom

/**
 * The usage view as a person meets it (f-budget t-94).
 *
 * `usage-view.test.ts` decides the arithmetic and the wording; this file proves
 * the page actually says it — and that the four states that are not errors
 * (nothing spent, a total known to be short, a $0 ceiling, a month past its
 * limit) each render as something truthful rather than as a confident bar.
 *
 * It also holds the one claim the whole task rests on: the placeholder copy
 * that had become false is gone.
 *
 * @see components/app/usage/usage-panel.tsx
 */

import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { COST_SETTLE_MS, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { UsagePanel } from '@/components/app/usage/usage-panel';

import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

// The shell provider it reads `turnsSettled` from asks for the route.
vi.mock('next/navigation', () => ({ usePathname: () => '/app/usage' }));

const NOW = new Date('2026-03-21T14:30:00.000Z');

interface Fixture {
  costUsd?: number;
  ceilingUsd?: number;
  source?: 'override' | 'default';
  remainingUsd?: number;
  fractionUsed?: number | null;
  unpricedRows?: number;
  days?: { key: string; costUsd: number }[];
}

function fetcherFor(fixture: Fixture = {}) {
  const costUsd = fixture.costUsd ?? 9.35;
  const days = fixture.days ?? [
    { key: '2026-03-01', costUsd: 0.45 },
    { key: '2026-03-20', costUsd: 2.9 },
    { key: '2026-03-21', costUsd: 6.0 },
  ];
  const summary = {
    userId: 'cmu8lt3aw0025o0sbw78xrnd6',
    window: { from: '2026-03-01T00:00:00.000Z', to: NOW.toISOString() },
    costUsd,
    inputTokens: 10,
    outputTokens: 10,
    costRows: 9,
    unpricedRows: fixture.unpricedRows ?? 0,
    ceiling: { ceilingUsd: fixture.ceilingUsd ?? 20, source: fixture.source ?? 'default' },
    remainingUsd: fixture.remainingUsd ?? 10.65,
    fractionUsed: fixture.fractionUsed === undefined ? 0.4675 : fixture.fractionUsed,
  };
  const breakdown = {
    by: 'day',
    window: summary.window,
    totals: { costUsd, costRows: 9, unpricedRows: fixture.unpricedRows ?? 0 },
    groups: days.map((day) => ({ ...day, costRows: 3, unpricedRows: 0 })),
    truncated: false,
  };
  return vi.fn(
    async (url: string) =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: url.includes('/breakdown') ? breakdown : summary,
        }),
      }) as unknown as Response
  ) as unknown as typeof fetch;
}

function renderPanel(fixture: Fixture = {}) {
  return renderInShell(<UsagePanel fetchImpl={fetcherFor(fixture)} />);
}

describe('a month with spend', () => {
  it('shows what was used, what is left and the limit', async () => {
    renderPanel();

    // Scoped to the stat, because the month chart's own total says $9.35 too
    // — the two agreeing is the point, so neither can be matched on its own.
    const spent = await screen.findByText('used this month');
    expect(spent.parentElement).toHaveTextContent('$9.35');
    expect(screen.getByText('left').parentElement).toHaveTextContent('$10.65');
    expect(screen.getByText('monthly limit').parentElement).toHaveTextContent('$20.00');
  });

  it('draws a bar for every day of the month so far, quiet ones included', async () => {
    renderPanel();

    const plot = await screen.findByRole('img', { name: /Daily spend, 1 March to 21 March/ });
    expect(plot.querySelectorAll('[data-tip]')).toHaveLength(21);
    // The eighteen days with no spend are drawn as idle rather than skipped;
    // closing the gaps would put every bar on the wrong date.
    expect(plot.querySelectorAll('[data-idle]')).toHaveLength(18);
  });

  it('names the total and the peak for a reader who cannot see the bars', async () => {
    renderPanel();
    expect(
      await screen.findByRole('img', {
        name: 'Daily spend, 1 March to 21 March. $9.35 in total, highest day $6.00.',
      })
    ).toBeInTheDocument();
  });

  it('prints the last seven days with a figure over each bar', async () => {
    renderPanel();

    const week = await screen.findByRole('img', { name: /last seven days/ });
    expect(week).toBeInTheDocument();
    expect(screen.getByText('$6.00')).toBeInTheDocument();
    expect(screen.getByText('$2.90')).toBeInTheDocument();
    // A day with nothing gets a dash, not "$0.00" repeated five times.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('says whose limit it is when the person has their own', async () => {
    renderPanel({ source: 'override', ceilingUsd: 50 });
    expect(await screen.findByText('your monthly limit')).toBeInTheDocument();
  });
});

describe('a month with nothing spent', () => {
  it('renders an honest empty state rather than a broken chart', async () => {
    renderPanel({ costUsd: 0, remainingUsd: 20, fractionUsed: 0, days: [] });

    expect(
      await screen.findByRole('img', { name: /Nothing spent yet this month/ })
    ).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /last seven days. Nothing spent/ })).toBeInTheDocument();
    // No average line: a line at zero sits on the axis pretending to be data.
    expect(screen.queryByText(/average/)).not.toBeInTheDocument();
  });
});

describe('a total that is known to be short', () => {
  it('says it is at least that much, and why', async () => {
    renderPanel({ unpricedRows: 4 });

    expect(await screen.findByText('used this month, at least')).toBeInTheDocument();
    expect(screen.getByText(/no price on file/)).toBeInTheDocument();
  });

  it('qualifies the chart totals too, not just the headline', async () => {
    // The By-day panel printed the same number bare, directly under a stat
    // that had just called it approximate.
    renderPanel({ unpricedRows: 4 });

    await screen.findByText('used this month, at least');
    expect(screen.getByText('at least $9.35')).toBeInTheDocument();
    expect(screen.getByText('at least $8.90')).toBeInTheDocument();
  });

  it('says nothing of the sort when every row was priced', async () => {
    renderPanel();
    expect(await screen.findByText('used this month')).toBeInTheDocument();
    expect(screen.queryByText(/no price on file/)).not.toBeInTheDocument();
  });
});

describe('a $0 limit', () => {
  it('is explained in words, because no meter can be drawn for it', async () => {
    renderPanel({ ceilingUsd: 0, remainingUsd: 0, fractionUsed: null });

    expect(await screen.findByText(/limit is set to nothing/)).toBeInTheDocument();
    expect(screen.getByText(/Everything you can read and write still works/)).toBeInTheDocument();
    expect(screen.queryByText(/past your limit/)).not.toBeInTheDocument();
  });
});

describe('a month past its limit', () => {
  it('says so, and says when replies come back', async () => {
    renderPanel({ costUsd: 21.4, remainingUsd: 0, fractionUsed: 1.07 });

    expect(await screen.findByText(/past your limit for this month/)).toBeInTheDocument();
    expect(screen.getByText(/come back at the start of next month/)).toBeInTheDocument();
    // Not a full bar, which would read as "exactly used up".
    expect(screen.queryByText(/limit is set to nothing/)).not.toBeInTheDocument();
  });
});

describe('when the read fails', () => {
  it('says so, and says nothing else depends on it', async () => {
    const failing = vi.fn(
      async () => ({ ok: false, status: 500 }) as Response
    ) as unknown as typeof fetch;
    renderInShell(<UsagePanel fetchImpl={failing} />);

    expect(await screen.findByText('This could not be read.')).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been charged/)).toBeInTheDocument();
  });

  it('announces the wait while it is reading', async () => {
    let release: (value: Response) => void = () => {};
    const slow = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    ) as unknown as typeof fetch;
    renderInShell(<UsagePanel fetchImpl={slow} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/Reading what this month cost/);
    release({ ok: false, status: 500 } as Response);
    await waitFor(() => expect(screen.getByText('This could not be read.')).toBeInTheDocument());
  });
});

describe('what this page no longer claims', () => {
  it('has dropped the placeholder copy that had become false', async () => {
    renderPanel();
    await screen.findByText('used this month');

    // "Lelañea is not calling a model for you yet" — she is, since §10.
    expect(screen.queryByText(/not calling a model for you yet/)).not.toBeInTheDocument();
    // "a budget you set" — the commercial phase's, and not being built.
    expect(screen.queryByText(/budget you set/)).not.toBeInTheDocument();
    expect(screen.queryByText(/card on file/)).not.toBeInTheDocument();
  });
});

/**
 * The page and the topbar pill above it read the same thing, so they re-read on
 * the same signal (t-95) — or a turn sent from this page moves the pill while
 * the page it links to keeps the old figure.
 */
describe('after a turn', () => {
  function FinishTurn() {
    const { noteTurnSettled } = useShellLayout();
    return (
      <button type="button" onClick={noteTurnSettled}>
        finish a turn
      </button>
    );
  }

  it('re-reads once the turn has settled, keeping the old figures up meanwhile', async () => {
    const fetchImpl = fetcherFor();
    renderInShell(
      <>
        <UsagePanel fetchImpl={fetchImpl} />
        <FinishTurn />
      </>
    );
    await waitFor(() => expect(screen.getAllByText('$9.35').length).toBeGreaterThan(0));
    const calls = () => vi.mocked(fetchImpl).mock.calls.length;
    const afterMount = calls();

    fireEvent.click(screen.getByRole('button', { name: 'finish a turn' }));
    // Nothing yet: the turn's cost row may still be being written.
    expect(calls()).toBe(afterMount);
    expect(screen.getAllByText('$9.35').length).toBeGreaterThan(0);

    await waitFor(() => expect(calls()).toBe(afterMount * 2), { timeout: COST_SETTLE_MS + 1500 });
    // No skeleton on a refresh — the figures stayed on screen.
    expect(screen.queryByText('Reading what this month cost.')).toBeNull();
  });
});
