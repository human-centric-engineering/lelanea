/**
 * The browser's side of the usage view (f-budget t-94).
 *
 * Two reads, one window. Kept apart from `usage-view.ts` for the reason
 * `notes-client.ts` gives: the wire *shape* stays importable by the server and
 * by a test without dragging a `fetch` wrapper along with it.
 *
 * ## Why one breakdown call serves two charts, and why it goes second
 *
 * The month chart wants this UTC month and the week chart wants the last seven
 * days, which early in a month reaches back into the previous one. Asking for
 * whichever is earlier ({@link readingWindowFrom}) covers both in about
 * thirty-seven days at most — inside the API's 366-day bound and well inside
 * its 100-group default, so neither chart can be quietly truncated.
 *
 * The two reads used to go out together. They no longer can: the breakdown's
 * start has to come from **the server's** month, not the device's. A clock an
 * hour fast at the turn of a month asked for six days while the month chart
 * still drew thirty-one, so twenty-five days of real spend rendered as idle
 * zeros beneath a headline that counted them (/code-review). The summary
 * carries both instants, so it goes first and the breakdown is asked for the
 * window it names. That costs one round trip and buys the two halves of the
 * page agreeing about what month it is.
 *
 * ## The envelope is parsed, never cast
 *
 * Same discipline as `notes-client.ts` and `conversation/client.ts`. A shape
 * this cannot read means the contract moved, and a usage view is exactly the
 * surface where showing a confident half-answer is worse than saying it could
 * not be read.
 */

import { z } from 'zod';

import {
  readingWindowFrom,
  type UsageBreakdown,
  type UsageSummary,
} from '@/lib/app/usage/usage-view';

/** This month against the reader's own ceiling. */
export const USAGE_ENDPOINT = '/api/v1/app/usage';

/** The reader's own spend, grouped. */
export const USAGE_BREAKDOWN_ENDPOINT = '/api/v1/app/usage/breakdown';

/**
 * Where a person reads it.
 *
 * **Three other places still hardcode this path** — the account menu's link
 * (`components/app/shell/account-menu.tsx`), the shell's tone map
 * (`view-tone.ts`) and the nav roster. This constant is not yet the single
 * source it ought to be, and saying otherwise would send the next reader
 * looking for imports that do not exist (/code-review). The page below uses
 * it, and t-95's topbar meter — which links here — is the change that can
 * reasonably unify the rest.
 */
export const USAGE_PAGE = '/app/usage';

/** The read failed, or answered something this cannot trust. */
export class UsageUnreadable extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'UsageUnreadable';
    this.status = status;
  }
}

/**
 * Both bounds are parsed as dates downstream, so "a string" is not enough.
 *
 * An unparseable bound used to produce a confident wrong answer rather than the
 * banner this module promises: `new Date('nonsense')` is `Invalid Date`, the
 * day loop's `at <= to` is `NaN <= n` → false, and the chart rendered zero bars
 * under "Daily spend, Invalid Date to 21 March" with a total of `$0.00`
 * (/code-review).
 */
const windowSchema = z.object({ from: z.iso.datetime(), to: z.iso.datetime() });

const summarySchema = z.object({
  userId: z.string(),
  window: windowSchema,
  costUsd: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  costRows: z.number(),
  unpricedRows: z.number(),
  ceiling: z.object({
    ceilingUsd: z.number(),
    source: z.enum(['override', 'default']),
  }),
  remainingUsd: z.number(),
  fractionUsed: z.number().nullable(),
});

const breakdownSchema = z.object({
  by: z.string(),
  window: windowSchema,
  totals: z.object({
    costUsd: z.number(),
    costRows: z.number(),
    unpricedRows: z.number(),
  }),
  groups: z.array(
    z.object({
      key: z.string().nullable(),
      costUsd: z.number(),
      costRows: z.number(),
      unpricedRows: z.number(),
    })
  ),
  truncated: z.boolean(),
});

function envelopeOf<T extends z.ZodType>(data: T) {
  return z.object({ success: z.literal(true), data });
}

/**
 * `fetch` detached from `window` is not callable as a method.
 *
 * `options.fetchImpl(url)` is a METHOD call: `this` is the options object, and
 * the browser answers `Failed to execute 'fetch' on 'Window': Illegal
 * invocation`. It cost a whole pass of the local look to find, because every
 * unit test injects a `fetchImpl` and so never takes the default path — the
 * defect existed only where no test looks. Binding it here means the call site
 * cannot reintroduce it.
 */
function boundFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? globalThis.fetch.bind(globalThis);
}

async function read<T>(
  url: string,
  schema: z.ZodType<T>,
  options: { signal?: AbortSignal; fetchImpl: typeof fetch }
): Promise<T> {
  const send = options.fetchImpl;
  const response = await send(url, {
    credentials: 'include',
    signal: options.signal,
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new UsageUnreadable(response.status, 'What you have spent could not be read.');
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new UsageUnreadable(response.status, 'What you have spent could not be read.');
  }
  const parsed = envelopeOf(schema).safeParse(body);
  if (!parsed.success) {
    throw new UsageUnreadable(response.status, 'What you have spent could not be read.');
  }
  return parsed.data.data;
}

export interface UsageFetchOptions {
  signal?: AbortSignal;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Both readings — the summary first, because it says which window to ask for.
 *
 * Nothing is drawn until both have landed (the panel shows one skeleton for the
 * pair), so the extra round trip costs latency rather than a second render.
 */
export async function fetchUsage(
  options: UsageFetchOptions = {}
): Promise<{ summary: UsageSummary; days: UsageBreakdown }> {
  const fetchImpl = boundFetch(options.fetchImpl);
  const summary = await read(USAGE_ENDPOINT, summarySchema, {
    signal: options.signal,
    fetchImpl,
  });

  const from = readingWindowFrom(
    new Date(summary.window.to),
    new Date(summary.window.from)
  ).toISOString();
  const days = await read(
    `${USAGE_BREAKDOWN_ENDPOINT}?by=day&from=${encodeURIComponent(from)}`,
    breakdownSchema,
    { signal: options.signal, fetchImpl }
  );

  return { summary, days };
}
