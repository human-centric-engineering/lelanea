// @vitest-environment happy-dom

/**
 * A turn taken in the conversation moves the spend pill and the usage page
 * (f-budget t-95, proved end to end at t-98).
 *
 * ## The real pane, not a button that calls the signal
 *
 * `spend-meter.test.tsx` and `usage-panel.test.tsx` each prove their reader
 * re-reads when `noteTurnSettled` is called — by a test button. Neither proves
 * anything CALLS it: the conversation pane hands it to `useConversation` as
 * `onTurnSettled`, and deleting that one line left both files green. So here a
 * real turn runs on the real pane, streaming to `done`, while the fake server's
 * month-to-date spend moves underneath it, and the assertion is what a person
 * reads in both places afterwards — the shape `notes-panel.test.tsx` uses for
 * the notes' own signal.
 *
 * The settle window runs on fake timers, switched on just before the message
 * is sent, so "not yet" and "now" are each one exact instant rather than a race
 * against wall clock. Only `setTimeout`/`clearTimeout` are faked: the stream's
 * reads are promise chains, and `flush()` lets them run.
 *
 * @see components/app/shell/conversation-pane.tsx — `onTurnSettled`
 * @see components/app/shell/use-shell-layout.tsx — `noteTurnSettled`
 */

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { SpendMeter } from '@/components/app/shell/spend-meter';
import { COST_SETTLE_MS } from '@/components/app/shell/use-shell-layout';
import { UsagePanel } from '@/components/app/usage/usage-panel';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/usage' }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => true }));
vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const LIMIT_USD = 20;
const WINDOW = { from: '2026-03-01T00:00:00.000Z', to: '2026-03-21T14:30:00.000Z' };

function sse(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A turn whose frames the test pushes, when it chooses. */
function openTurn() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }),
    push: (type: string, data: unknown = {}) => controller.enqueue(encoder.encode(sse(type, data))),
    close: () => controller.close(),
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The server: this month's spend so far, and the turn being streamed. */
const world = {
  costUsd: 9.35,
  summaryReads: 0,
  turn: null as ReturnType<typeof openTurn> | null,
  /** When set, the next turn is refused before any frame, with this status. */
  refuse: null as number | null,
};

function summary() {
  return {
    userId: 'cmu8lt3aw0025o0sbw78xrnd6',
    window: WINDOW,
    costUsd: world.costUsd,
    inputTokens: 10,
    outputTokens: 10,
    costRows: 9,
    unpricedRows: 0,
    ceiling: { ceilingUsd: LIMIT_USD, source: 'default' },
    remainingUsd: LIMIT_USD - world.costUsd,
    fractionUsed: world.costUsd / LIMIT_USD,
  };
}

function breakdown() {
  return {
    by: 'day',
    window: WINDOW,
    totals: { costUsd: world.costUsd, costRows: 9, unpricedRows: 0 },
    groups: [{ key: '2026-03-21', costUsd: world.costUsd, costRows: 9, unpricedRows: 0 }],
    truncated: false,
  };
}

const fetchImpl = vi.fn(async (url: string | URL | Request) => {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

  if (href.startsWith('/api/v1/app/usage/breakdown')) {
    return json({ success: true, data: breakdown() });
  }
  if (href.startsWith('/api/v1/app/usage')) {
    world.summaryReads += 1;
    return json({ success: true, data: summary() });
  }
  if (href.startsWith('/api/v1/app/conversation')) {
    return json({
      success: true,
      data: { seat: 'facilitator', conversationId: null, entries: [] },
    });
  }
  if (href.startsWith('/api/v1/app/agent/status')) {
    return json({ success: true, data: { generation: 'available' } });
  }
  if (href.startsWith('/api/v1/app/agent/transcribe')) {
    return json({ success: true, data: { voiceInput: 'off' } });
  }
  if (href.includes('/chat/stream')) {
    if (world.refuse !== null) {
      return json(
        { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests' } },
        world.refuse
      );
    }
    world.turn = openTurn();
    return world.turn.response;
  }
  throw new Error(`unexpected fetch ${href}`);
}) as unknown as typeof fetch;

beforeEach(() => {
  world.costUsd = 9.35;
  world.summaryReads = 0;
  world.turn = null;
  world.refuse = null;
  vi.mocked(fetchImpl).mockClear();
  vi.stubGlobal('fetch', fetchImpl);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The conversation, the pill and the page, under one provider — as on `/app/usage`. */
async function renderAll() {
  renderInShell(
    <>
      <ConversationPane />
      <SpendMeter fetchImpl={fetchImpl} />
      <UsagePanel fetchImpl={fetchImpl} />
    </>
  );
  await waitFor(() => expect(screen.queryByText(CONVERSATION_COPY.loading)).toBeNull());
  await waitFor(() => expect(pill().textContent).toBe('$10.65 left'));
  await waitFor(() => expect(usedThisMonth()).toContain('$9.35'));
}

const pill = () => screen.getByRole('link', { name: /^Usage and billing/ });
const usedThisMonth = () => screen.getByText('used this month').parentElement?.textContent ?? '';
const composer = () => screen.getByRole('textbox', { name: CONVERSATION_COPY.composerLabel });

/**
 * Type on real timers, then fake the clock and press send, so the settle
 * timer the turn starts is one the test controls.
 */
async function send(words: string) {
  await userEvent.type(composer(), words);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // `fireEvent`, not user-event: user-event waits on timers between key
  // events, and the clock is no longer running on its own.
  await act(async () => {
    fireEvent.keyDown(composer(), { key: 'Enter' });
  });
}

/** Let the stream's promise chains and React's updates run, without moving the clock. */
async function flush() {
  for (let pass = 0; pass < 10; pass += 1) {
    await act(async () => {});
  }
}

/** Move the clock to one millisecond short of the settle window, then through it. */
async function throughTheWindow(beforeIt: () => void) {
  await act(async () => {
    vi.advanceTimersByTime(COST_SETTLE_MS - 1);
  });
  await flush();
  beforeIt();
  await act(async () => {
    vi.advanceTimersByTime(1);
  });
  await flush();
  vi.useRealTimers();
}

describe('a turn taken in the conversation', () => {
  it('moves the pill and the usage page to the month with its cost in', async () => {
    await renderAll();
    const readsBefore = world.summaryReads;
    // The population: both readers read on mount, so a count that stays put
    // afterwards means something, not that nothing was listening.
    expect(readsBefore).toBe(2);

    await send('a hard week');
    await flush();
    expect(world.turn).not.toBeNull();
    await act(async () => {
      world.turn!.push('start', { conversationId: 'c1' });
      world.turn!.push('content', { delta: 'That sounds like a lot.' });
      // The turn's cost row, written as the reply finishes.
      world.costUsd = 9.8;
      world.turn!.push('done', {});
      world.turn!.close();
    });
    await flush();
    expect(screen.getByText('That sounds like a lot.')).toBeInTheDocument();

    await throughTheWindow(() => {
      // Not yet: the readers wait for the cost row to have been written.
      expect(world.summaryReads).toBe(readsBefore);
      expect(pill().textContent).toBe('$10.65 left');
    });

    await waitFor(() => expect(pill().textContent).toBe('$10.20 left'));
    await waitFor(() => expect(usedThisMonth()).toContain('$9.80'));
    expect(screen.getByText('left').parentElement).toHaveTextContent('$10.20');
    // Once each — the pill and the page — not once per streamed frame.
    expect(world.summaryReads).toBe(readsBefore + 2);
  });

  it('moves them after a turn the server refused before any frame', async () => {
    // A refusal still settles: the request reached the server, and the docs
    // promise the meter reads after "a reply, an ending, a refusal".
    await renderAll();
    const readsBefore = world.summaryReads;
    world.refuse = 429;

    await send('a hard week');
    await flush();
    expect(
      screen.getByRole('article', { name: CONVERSATION_COPY.endingLabel })
    ).toBeInTheDocument();

    await throughTheWindow(() => expect(world.summaryReads).toBe(readsBefore));

    await waitFor(() => expect(world.summaryReads).toBe(readsBefore + 2));
  });
});
