// @vitest-environment happy-dom

/**
 * The topbar's spend meter (f-budget t-95).
 *
 * Two properties carry this file. **No state draws a bar it cannot stand
 * behind** — a $0 ceiling, a month past the ceiling, a read still in flight and
 * a read that failed each render words and no fill. And **it reads on mount and
 * once per finished turn**, never because the shell re-rendered for some other
 * reason: the month-to-date aggregate behind it is the watch item in
 * `agent.md`, and a meter that re-read on every provider change would call it
 * on every pane switch and every streamed frame's knock-on render.
 *
 * `happy-dom` does no layout, so the fill's rendered width in pixels is checked
 * on the real page, not here; this file pins the width the fill is given.
 *
 * @see components/app/shell/spend-meter.tsx
 * @see lib/app/usage/usage-view.ts — `meterReading`, which decides the states
 */

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SpendMeter } from '@/components/app/shell/spend-meter';
import { COST_SETTLE_MS, useShellLayout } from '@/components/app/shell/use-shell-layout';

import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

beforeEach(() => {
  mockPathname.current = '/app';
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Wait out the provider's settle window, on real timers — the counter moves
 * `COST_SETTLE_MS` after a turn, because the turn's cost row is written without
 * the platform waiting for it.
 */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, COST_SETTLE_MS + 50));
  });
}

interface Fixture {
  window?: { from: string; to: string };
  costUsd?: number;
  ceilingUsd?: number;
  remainingUsd?: number;
  fractionUsed?: number | null;
  unpricedRows?: number;
}

function summaryOf(fixture: Fixture = {}) {
  return {
    userId: 'cmu8lt3aw0025o0sbw78xrnd6',
    window: fixture.window ?? {
      from: '2026-03-01T00:00:00.000Z',
      to: '2026-03-21T14:30:00.000Z',
    },
    costUsd: fixture.costUsd ?? 7.6,
    inputTokens: 10,
    outputTokens: 10,
    costRows: 9,
    unpricedRows: fixture.unpricedRows ?? 0,
    ceiling: { ceilingUsd: fixture.ceilingUsd ?? 20, source: 'default' },
    remainingUsd: fixture.remainingUsd ?? 12.4,
    fractionUsed: fixture.fractionUsed === undefined ? 0.38 : fixture.fractionUsed,
  };
}

function ok(data: unknown): Response {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) } as Response;
}

function fetcherFor(...answers: Response[]) {
  const queue = [...answers];
  return vi.fn(async () => queue.shift() ?? answers[answers.length - 1]) as unknown as typeof fetch;
}

function callsTo(fetchImpl: typeof fetch): string[] {
  return (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => c[0]);
}

/** Something in the shell that can finish a turn, or change it some other way. */
function Controls() {
  const { noteTurnSettled, noteSlotsWritten, setPane } = useShellLayout();
  return (
    <>
      <button type="button" onClick={noteTurnSettled}>
        finish a turn
      </button>
      <button type="button" onClick={noteSlotsWritten}>
        write a note
      </button>
      <button type="button" onClick={() => setPane('ws')}>
        switch pane
      </button>
    </>
  );
}

function renderMeter(fetchImpl: typeof fetch) {
  return renderInShell(
    <>
      <SpendMeter fetchImpl={fetchImpl} />
      <Controls />
    </>
  );
}

const meter = () => screen.getByRole('link', { name: /^Usage and billing/ });
const fill = () => document.querySelector<HTMLElement>('[data-meter-fill]');

describe('SpendMeter — an ordinary month', () => {
  it('shows what is left beside a bar filled to the fraction used', async () => {
    renderMeter(fetcherFor(ok(summaryOf())));

    await waitFor(() => expect(meter().textContent).toBe('$12.40 left'));
    expect(fill()?.style.width).toBe('38%');
  });

  it('opens the usage page, and nothing else', async () => {
    renderMeter(fetcherFor(ok(summaryOf())));
    await waitFor(() => expect(meter().textContent).toBe('$12.40 left'));

    expect(meter().getAttribute('href')).toBe('/app/usage');
  });

  it('names itself with the figure and the limit', async () => {
    renderMeter(fetcherFor(ok(summaryOf())));
    await waitFor(() =>
      expect(
        screen.getByRole('link', {
          name: 'Usage and billing: $12.40 left of $20.00 this month',
        })
      ).toBeTruthy()
    );
  });

  it('is reached from the keyboard', async () => {
    renderMeter(fetcherFor(ok(summaryOf())));
    await waitFor(() => expect(meter().textContent).toBe('$12.40 left'));

    await userEvent.tab();
    expect(document.activeElement).toBe(meter());
  });

  it('marks itself current on the usage page', async () => {
    mockPathname.current = '/app/usage';
    renderMeter(fetcherFor(ok(summaryOf())));
    await waitFor(() => expect(meter().getAttribute('aria-current')).toBe('page'));
  });
});

describe('SpendMeter — the edges draw no bar', () => {
  it('says nothing may be spent on a $0 ceiling', async () => {
    renderMeter(
      fetcherFor(ok(summaryOf({ costUsd: 0, ceilingUsd: 0, remainingUsd: 0, fractionUsed: null })))
    );

    await waitFor(() => expect(meter().textContent).toBe('nothing to spend'));
    expect(fill()).toBeNull();
    expect(document.querySelector('[data-meter-track]')).toBeNull();
  });

  it('says it is past the limit rather than drawing a full bar', async () => {
    renderMeter(fetcherFor(ok(summaryOf({ costUsd: 21.4, remainingUsd: 0, fractionUsed: 1.07 }))));

    await waitFor(() => expect(meter().textContent).toBe('past your limit'));
    expect(fill()).toBeNull();
  });

  it('draws nothing and states no figure while it is still reading', () => {
    // A read that never answers: the state a person sees on every first paint.
    renderMeter(vi.fn(() => new Promise<Response>(() => {})));

    expect(meter().textContent).toBe('usage');
    expect(meter().textContent).not.toMatch(/\d/);
    expect(fill()).toBeNull();
  });

  it('says it could not read, with no bar, when the read fails', async () => {
    renderMeter(
      fetcherFor({ ok: false, status: 500, json: async () => ({}) } as unknown as Response)
    );

    await waitFor(() => expect(meter().textContent).toBe('usage unreadable'));
    expect(fill()).toBeNull();
    expect(meter().getAttribute('aria-label')).toContain('could not be read');
    // Still a way to the page, which has its own, fuller account of the failure.
    expect(meter().getAttribute('href')).toBe('/app/usage');
  });

  it('says it could not read when the answer is not a shape it trusts', async () => {
    renderMeter(fetcherFor(ok({ costUsd: 'lots' })));
    await waitFor(() => expect(meter().textContent).toBe('usage unreadable'));
    expect(fill()).toBeNull();
  });

  it('drops a bar it can no longer vouch for when a later read fails', async () => {
    const fetchImpl = fetcherFor(ok(summaryOf()), {
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    renderMeter(fetchImpl);
    await waitFor(() => expect(fill()).not.toBeNull());

    await userEvent.click(screen.getByRole('button', { name: 'finish a turn' }));
    await settle();

    await waitFor(() => expect(meter().textContent).toBe('usage unreadable'));
    expect(fill()).toBeNull();
  });
});

describe('SpendMeter — when it reads', () => {
  it('reads once on mount', async () => {
    const fetchImpl = fetcherFor(ok(summaryOf()));
    renderMeter(fetchImpl);
    await waitFor(() => expect(meter().textContent).toBe('$12.40 left'));

    expect(callsTo(fetchImpl)).toEqual(['/api/v1/app/usage']);
  });

  it('reads again once for each finished turn, and shows the newer answer', async () => {
    const fetchImpl = fetcherFor(
      ok(summaryOf()),
      ok(summaryOf({ costUsd: 8.1, remainingUsd: 11.9, fractionUsed: 0.405 }))
    );
    renderMeter(fetchImpl);
    await waitFor(() => expect(meter().textContent).toBe('$12.40 left'));

    await userEvent.click(screen.getByRole('button', { name: 'finish a turn' }));
    // Not at the turn: its cost row may not be written yet, and a read now
    // could sum the month without it.
    expect(callsTo(fetchImpl)).toHaveLength(1);
    await settle();

    await waitFor(() => expect(meter().textContent).toBe('$11.90 left'));
    expect(fill()?.style.width).toBe('40.5%');
    expect(callsTo(fetchImpl)).toHaveLength(2);
  });

  it('does not read when the shell changes for any other reason', async () => {
    // A note written, a pane switched: both re-render every consumer of the
    // provider, the meter included. Neither is spend.
    const fetchImpl = fetcherFor(ok(summaryOf()));
    renderMeter(fetchImpl);
    await waitFor(() => expect(meter().textContent).toBe('$12.40 left'));

    await userEvent.click(screen.getByRole('button', { name: 'write a note' }));
    await userEvent.click(screen.getByRole('button', { name: 'switch pane' }));
    await act(async () => {});

    expect(callsTo(fetchImpl)).toHaveLength(1);
  });

  it('abandons a read overtaken by a newer turn, so the older answer never lands', async () => {
    let answerFirst: (response: Response) => void = () => {};
    const first = new Promise<Response>((resolve) => {
      answerFirst = resolve;
    });
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async () =>
        ok(summaryOf({ costUsd: 9, remainingUsd: 11, fractionUsed: 0.45 }))
      ) as unknown as typeof fetch;
    renderMeter(fetchImpl);

    await userEvent.click(screen.getByRole('button', { name: 'finish a turn' }));
    await settle();
    await waitFor(() => expect(meter().textContent).toBe('$11.00 left'));

    // The mount's read answers late, with the older figure.
    await act(async () => answerFirst(ok(summaryOf())));
    expect(meter().textContent).toBe('$11.00 left');
  });

  it("reads once more when the month turns, timed on the server's clock", async () => {
    // Past the limit, two seconds before the month ends. Left open, the pill
    // would say so all through the 1st, and a person believing it would not send.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fetchImpl = fetcherFor(
      ok(
        summaryOf({
          window: { from: '2026-03-01T00:00:00.000Z', to: '2026-03-31T23:59:58.000Z' },
          costUsd: 21,
          remainingUsd: 0,
          fractionUsed: 1.05,
        })
      ),
      ok(
        summaryOf({
          window: { from: '2026-04-01T00:00:00.000Z', to: '2026-04-01T00:00:05.000Z' },
          costUsd: 0,
          remainingUsd: 20,
          fractionUsed: 0,
        })
      )
    );
    renderMeter(fetchImpl);
    await act(async () => {});
    expect(meter().textContent).toBe('past your limit');

    // Two seconds to midnight plus the margin; one millisecond short is not yet.
    await act(async () => {
      vi.advanceTimersByTime(6_999);
    });
    expect(callsTo(fetchImpl)).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await act(async () => {});

    expect(callsTo(fetchImpl)).toHaveLength(2);
    expect(meter().textContent).toBe('$20.00 left');
  });
});
