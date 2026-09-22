/**
 * The browser's two reads (f-budget t-94).
 *
 * The cases worth having: one window covers both charts, a refusal and a
 * malformed body both become the same shown sentence rather than a thrown
 * shape the panel would have to guess at, and nothing is cast.
 *
 * @see lib/app/usage/usage-client.ts
 */

import { describe, it, expect, vi } from 'vitest';

import {
  fetchUsage,
  UsageUnreadable,
  USAGE_BREAKDOWN_ENDPOINT,
  USAGE_ENDPOINT,
} from '@/lib/app/usage/usage-client';

const NOW = new Date('2026-03-21T14:30:00.000Z');

const SUMMARY = {
  userId: 'cmu8lt3aw0025o0sbw78xrnd6',
  window: { from: '2026-03-01T00:00:00.000Z', to: NOW.toISOString() },
  costUsd: 9.35,
  inputTokens: 1,
  outputTokens: 1,
  costRows: 4,
  unpricedRows: 0,
  ceiling: { ceilingUsd: 20, source: 'default' },
  remainingUsd: 10.65,
  fractionUsed: 0.4675,
};

const DAYS = {
  by: 'day',
  window: { from: '2026-03-01T00:00:00.000Z', to: NOW.toISOString() },
  totals: { costUsd: 9.35, costRows: 4, unpricedRows: 0 },
  groups: [{ key: '2026-03-21', costUsd: 9.35, costRows: 4, unpricedRows: 0 }],
  truncated: false,
};

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function fetcher(routes: { usage?: Response; breakdown?: Response }) {
  return vi.fn(async (url: string) =>
    url.startsWith(USAGE_BREAKDOWN_ENDPOINT)
      ? (routes.breakdown ?? json({ success: true, data: DAYS }))
      : (routes.usage ?? json({ success: true, data: SUMMARY }))
  ) as unknown as typeof fetch;
}

describe('reading the two', () => {
  it('asks for the day breakdown from the month start once the month is a week old', async () => {
    const fetchImpl = fetcher({});
    await fetchUsage({ fetchImpl, now: NOW });

    const urls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      (c) => c[0]
    );
    expect(urls).toContain(USAGE_ENDPOINT);
    const breakdown = urls.find((url) => url.startsWith(USAGE_BREAKDOWN_ENDPOINT))!;
    expect(breakdown).toContain('by=day');
    expect(decodeURIComponent(breakdown)).toContain('2026-03-01T00:00:00.000Z');
  });

  it('reaches back into last month early in a new one, so the week chart is whole', async () => {
    const fetchImpl = fetcher({});
    await fetchUsage({ fetchImpl, now: new Date('2026-03-03T10:00:00Z') });

    const urls = (fetchImpl as unknown as { mock: { calls: [string][] } }).mock.calls.map(
      (c) => c[0]
    );
    const breakdown = decodeURIComponent(urls.find((u) => u.startsWith(USAGE_BREAKDOWN_ENDPOINT))!);
    expect(breakdown).toContain('2026-02-25T00:00:00.000Z');
  });

  it('returns both readings', async () => {
    const reading = await fetchUsage({ fetchImpl: fetcher({}), now: NOW });
    expect(reading.summary.costUsd).toBe(9.35);
    expect(reading.days.groups).toHaveLength(1);
  });

  it('sends the session cookie, because every row read is keyed on it', async () => {
    const fetchImpl = fetcher({});
    await fetchUsage({ fetchImpl, now: NOW });
    const init = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0][1];
    expect(init.credentials).toBe('include');
  });
});

describe('when it cannot be read', () => {
  it('turns a refusal into a sentence meant to be shown', async () => {
    const failing = fetcher({ usage: json({ success: false }, 500) });
    await expect(fetchUsage({ fetchImpl: failing, now: NOW })).rejects.toBeInstanceOf(
      UsageUnreadable
    );
    await expect(fetchUsage({ fetchImpl: failing, now: NOW })).rejects.toThrow(
      'What you have spent could not be read.'
    );
  });

  it('refuses a body whose shape has moved rather than showing half of it', async () => {
    // A confident half-answer on a spend view is worse than saying so.
    const drifted = fetcher({
      usage: json({ success: true, data: { ...SUMMARY, costUsd: 'nine thirty-five' } }),
    });
    await expect(fetchUsage({ fetchImpl: drifted, now: NOW })).rejects.toBeInstanceOf(
      UsageUnreadable
    );
  });

  it('refuses a body that is not JSON at all', async () => {
    const notJson = fetcher({
      usage: {
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response,
    });
    await expect(fetchUsage({ fetchImpl: notJson, now: NOW })).rejects.toBeInstanceOf(
      UsageUnreadable
    );
  });
});
