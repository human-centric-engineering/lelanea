// @vitest-environment happy-dom

/**
 * The conversation pane: live from §10 t-64, and the drag that sizes it.
 *
 * The stub's rules — nothing sends, no digit, no article — lived here until
 * the conversation arrived. What replaces them is the conversation's own
 * contract: Enter sends and Shift+Enter does not, the box clears on the
 * server's `start`, the thinking row shows until her first words, a person
 * who asked for less motion gets the reply whole, and the off-screen carousel
 * pane is `inert` now that it holds real controls. And when she can't answer
 * (t-65): each ending in her words, the crisis resource laid out, and the
 * quiet line above the composer.
 *
 * @see components/app/shell/conversation-pane.tsx
 * @see components/app/conversation/*
 */

import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { ceilingReachedFrame, ENDING_MESSAGES } from '@/lib/app/agent/endings';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({
  useReducedMotion: () => motion.reduced,
}));

/* ------------------------------------------------------------ a fake seat */

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

const transcriptResponse = (entries: unknown[] = []) =>
  new Response(
    JSON.stringify({
      success: true,
      data: { seat: 'facilitator', conversationId: entries.length ? 'c1' : null, entries },
    }),
    { status: 200 }
  );

/** Every request the pane makes, and the turn it is currently streaming. */
const seat = {
  turns: [] as ReturnType<typeof openTurn>[],
  bodies: [] as unknown[],
  transcript: [] as unknown[],
  generation: 'available',
  voiceInput: 'off',
};

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
  motion.reduced = false;
  seat.turns = [];
  seat.bodies = [];
  seat.transcript = [];
  seat.generation = 'available';
  seat.voiceInput = 'off';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/app/conversation')) return transcriptResponse(seat.transcript);
      if (url.startsWith('/api/v1/app/agent/status')) {
        return new Response(
          JSON.stringify({ success: true, data: { generation: seat.generation } }),
          { status: 200 }
        );
      }
      if (url.startsWith('/api/v1/app/agent/transcribe')) {
        return new Response(
          JSON.stringify({ success: true, data: { voiceInput: seat.voiceInput } }),
          { status: 200 }
        );
      }
      if (url.includes('/chat/stream')) {
        seat.bodies.push(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));
        const turn = openTurn();
        seat.turns.push(turn);
        return turn.response;
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The pane, with its transcript read back. */
async function renderLoaded(width: 'large' | 'small' | 'medium' = 'large') {
  const result = renderInShell(<ConversationPane />, width);
  await waitFor(() => expect(screen.queryByText(CONVERSATION_COPY.loading)).toBeNull());
  return result;
}

const box = () => screen.getByRole('textbox', { name: CONVERSATION_COPY.composerLabel });
/** Her words alone — the bubble, not the account row under it (t-66). */
const herWords = () =>
  screen.getByRole('article', { name: 'Lelañea said' }).querySelector('p')?.textContent;
const latestTurn = () => seat.turns[seat.turns.length - 1];

describe('sending', () => {
  it('Enter sends the seam\u2019s shape — the words and a minted turn id — and Shift+Enter does not', async () => {
    const user = userEvent.setup();
    await renderLoaded();

    await user.type(box(), 'first line{Shift>}{Enter}{/Shift}second line');
    expect(seat.bodies).toHaveLength(0);
    expect(box()).toHaveValue('first line\nsecond line');

    await user.keyboard('{Enter}');
    expect(seat.bodies).toHaveLength(1);
    expect(seat.bodies[0]).toMatchObject({ message: 'first line\nsecond line' });
    expect(seat.bodies[0]).toHaveProperty('turnId', expect.stringMatching(/^[0-9a-f-]{36}$/));
  });

  it('keeps the words in the box until the server says it has them, then clears it', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');

    // Sent, but not yet acknowledged: the words are still in the box (§8.1).
    expect(box()).toHaveValue('hello');
    await act(async () => latestTurn().push('start', { conversationId: 'c1' }));
    await waitFor(() => expect(box()).toHaveValue(''));
  });

  it('shows the person\u2019s words as a turn at once, and the thinking row until her first words', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'Are you there?{Enter}');

    expect(screen.getByRole('article', { name: 'You said' }).textContent).toBe('Are you there?');
    const thinking = screen.getByRole('status');
    expect(thinking.textContent).toContain(CONVERSATION_COPY.thinking);

    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('content', { delta: 'I am. ' });
    });
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(screen.getByRole('article', { name: 'Lelañea said' })).toBeTruthy();
  });

  it('changes the thinking row\u2019s label at the first-words deadline rather than adding a frame', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('warning', { code: 'still_thinking', message: 'operator text' });
    });

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(CONVERSATION_COPY.stillThinking)
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(document.body.textContent).not.toContain('operator text');
  });

  it('never shows the platform\u2019s status strings', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('status', { message: 'Executing search_knowledge_base' });
    });
    expect(document.body.textContent).not.toContain('Executing');
  });

  it('the send disc submits the form too', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'by mouse');
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.send }));
    expect(seat.bodies).toHaveLength(1);
    expect(seat.bodies[0]).toMatchObject({ message: 'by mouse' });
  });

  it('disables send, and says why, while a turn is running; typing is still allowed', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');

    expect(screen.getByRole('button', { name: CONVERSATION_COPY.sendBusy })).toBeDisabled();
    expect(box()).not.toBeDisabled();
    await user.keyboard('{Enter}');
    expect(seat.bodies).toHaveLength(1);
  });

  it('renders her reply whole, not paced, for a reader who asked for less motion', async () => {
    motion.reduced = true;
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('content', { delta: 'Every word at once, as it arrives.' });
    });
    await waitFor(() => expect(herWords()).toBe('Every word at once, as it arrives.'));
  });

  it('folds a finished turn into the transcript, and the send control comes back', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('content', { delta: 'Hello.' });
      latestTurn().push('done', { costUsd: 0.0006, model: 'm' });
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONVERSATION_COPY.send })).toBeTruthy()
    );
    expect(screen.getByRole('article', { name: 'Lelañea said' })).toBeTruthy();
  });

  it('tells the person when a turn ends without her, in her words, and the words are back in the box', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    // `start` came first, so the box was cleared before the ending arrived —
    // the shape a provider outage takes on the real route.
    await act(async () => latestTurn().push('start', { conversationId: 'c1' }));
    await waitFor(() => expect(box()).toHaveValue(''));
    await act(async () => {
      latestTurn().push('error', { code: 'unavailable', message: ENDING_MESSAGES.unavailable });
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('article', { name: CONVERSATION_COPY.endingLabel }).textContent).toBe(
        CONVERSATION_COPY.endings.unavailable
      )
    );
    expect(box()).toHaveValue('hello');
    // In the box, not in the transcript as well.
    expect(screen.queryByRole('article', { name: 'You said' })).toBeNull();
  });

  it('does not overwrite a new draft with the failed one', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'first{Enter}');
    await act(async () => latestTurn().push('start', { conversationId: 'c1' }));
    await waitFor(() => expect(box()).toHaveValue(''));
    await user.type(box(), 'a new thought');
    await act(async () => {
      latestTurn().push('error', { code: 'unavailable', message: 'kept' });
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('article', { name: CONVERSATION_COPY.endingLabel })).toBeTruthy()
    );
    expect(box()).toHaveValue('a new thought');
    // The failed words are not nowhere: they stay as their bubble.
    expect(screen.getByRole('article', { name: 'You said' }).textContent).toBe('first');
  });
});

describe('when she can\u2019t answer (t-65)', () => {
  const endingRow = () => screen.getByRole('article', { name: CONVERSATION_COPY.endingLabel });

  async function endOn(code: string, message: string, extra: Record<string, unknown> = {}) {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'a hard week{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('error', { code, message, ...extra });
      latestTurn().close();
    });
    await waitFor(() => expect(endingRow()).toBeTruthy());
    return user;
  }

  it.each(['unavailable', 'timed_out', 'paused', 'not_sent'] as const)(
    'renders %s in her words, never the frame\u2019s',
    async (code) => {
      await endOn(code, ENDING_MESSAGES[code]);
      expect(endingRow().textContent).toBe(CONVERSATION_COPY.endings[code]);
      expect(screen.queryByText(ENDING_MESSAGES[code])).toBeNull();
      expect(box()).toHaveValue('a hard week');
    }
  );

  it('sends the same words again as the same turn, and the ending row goes', async () => {
    const user = await endOn('unavailable', ENDING_MESSAGES.unavailable);
    const first = seat.bodies[0] as { turnId: string };
    await user.keyboard('{Enter}');
    await waitFor(() => expect(seat.bodies).toHaveLength(2));
    expect((seat.bodies[1] as { turnId: string }).turnId).toBe(first.turnId);
    expect(screen.queryByRole('article', { name: CONVERSATION_COPY.endingLabel })).toBeNull();
    expect(screen.getByRole('article', { name: 'You said' }).textContent).toBe('a hard week');
  });

  it('says she is still on it when the earlier request is still being answered', async () => {
    const user = await endOn('unavailable', ENDING_MESSAGES.unavailable);
    vi.mocked(fetch).mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'CONFLICT', message: 'x', details: { reason: 'TURN_IN_FLIGHT' } },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(endingRow().textContent).toBe(CONVERSATION_COPY.stillWorking));
    expect(box()).toHaveValue('a hard week');
  });

  /**
   * The monthly limit (t-96). Built with the seam's own `ceilingReachedFrame`,
   * so a change to the frame's shape fails here rather than in someone's pane.
   */
  describe('the monthly limit', () => {
    const frame = ceilingReachedFrame({
      spentUsd: 4.07,
      ceilingUsd: 4,
      resetsAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    it('says it in her words, with the figures and the date, never the frame\u2019s', async () => {
      await endOn(frame.code, frame.message, { ceiling: frame.ceiling });
      const words = endingRow().textContent ?? '';

      expect(words).toContain('$4.07 of your $4.00 limit');
      expect(words).toContain('I can reply again from 1 October.');
      expect(words).toContain('everything you can read and write here still works');
      expect(screen.queryByText(frame.message)).toBeNull();
      expect(box()).toHaveValue('a hard week');
    });

    it('draws no control beside it — there is nothing to ask for', async () => {
      await endOn(frame.code, frame.message, { ceiling: frame.ceiling });
      expect(within(endingRow()).queryAllByRole('button')).toHaveLength(0);
      expect(within(endingRow()).queryAllByRole('link')).toHaveLength(0);
    });

    it('keeps the date when only an amount did not parse', async () => {
      await endOn(frame.code, frame.message, {
        ceiling: { ...frame.ceiling, spentUsd: 'lots' },
      });
      const words = endingRow().textContent ?? '';

      expect(words).toContain("That's this month's conversations used up.");
      expect(words).toContain('I can reply again from 1 October.');
      expect(words).not.toMatch(/undefined|NaN|Invalid Date|\$/);
    });

    it('shows the frame\u2019s own true words when the limit did not parse', async () => {
      // Without the limit her words could not tell a limit of nothing from a
      // month used up; the server's message was built from figures it knew.
      await endOn(frame.code, frame.message, { ceiling: 'x' });
      expect(endingRow().textContent).toBe(frame.message);
    });
  });

  const resource = (tier: 'hard' | 'soft') => ({
    tier,
    region: 'GB',
    intro:
      tier === 'hard' ? 'It sounds like you might be in real danger.' : 'If things feel heavy.',
    services: [
      { name: 'Samaritans', contact: 'Call 116 123', hours: 'Free, 24 hours a day' },
      { name: 'Shout', contact: 'Text SHOUT to 85258', hours: 'Free, 24 hours a day' },
      {
        name: 'Find A Helpline',
        contact: 'findahelpline.com',
        hours: 'A free directory',
        url: 'https://findahelpline.com',
      },
    ],
    emergency: 'If you are in immediate danger, call your local emergency number now. (999)',
    keptMessage: tier === 'hard' ? 'What you wrote is still in the box.' : null,
    status: 'draft',
    version: '0.1',
  });

  it('a hard crisis frame lays out every service and keeps the words in the box', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'I want to end it{Enter}');
    const hard = resource('hard');
    await act(async () => {
      // Before `start`: the crisis check comes before everything else.
      latestTurn().push('error', { code: 'crisis', message: 'as text', resource: hard });
      latestTurn().close();
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(hard.intro);
    for (const service of hard.services) {
      expect(alert.textContent).toContain(service.name);
      expect(alert.textContent).toContain(service.contact);
      expect(alert.textContent).toContain(service.hours);
    }
    expect(screen.getByRole('link', { name: 'findahelpline.com' })).toHaveAttribute(
      'href',
      'https://findahelpline.com'
    );
    expect(alert.textContent).toContain(hard.emergency);
    expect(alert.textContent).toContain(hard.keptMessage);
    // Only an https:// address becomes a link; anything else stays as text.
    expect(screen.queryByRole('link', { name: 'Call 116 123' })).toBeNull();
    // Verbatim: nothing of hers is said under it, and the text form is not shown twice.
    expect(screen.queryByRole('article', { name: CONVERSATION_COPY.endingLabel })).toBeNull();
    expect(alert.textContent).not.toContain('as text');
    expect(box()).toHaveValue('I want to end it');
  });

  it('never links a service address that is not https://', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'I want to end it{Enter}');
    const hard = resource('hard');
    hard.services[2].url = 'javascript:alert(1)';
    await act(async () => {
      latestTurn().push('error', { code: 'crisis', message: 'as text', resource: hard });
      latestTurn().close();
    });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('findahelpline.com');
    expect(within(alert).queryByRole('link')).toBeNull();
  });

  it('a soft crisis frame lays out the resource, then her turn', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'a hard week{Enter}');
    const soft = resource('soft');
    await act(async () => {
      latestTurn().push('warning', { code: 'crisis', message: 'as text', resource: soft });
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('content', { delta: 'I am here.' });
      latestTurn().push('done', {});
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONVERSATION_COPY.send })).toBeTruthy()
    );
    const alert = screen.getByRole('alert');
    for (const service of soft.services) expect(alert.textContent).toContain(service.contact);
    expect(alert.textContent).not.toContain('still in the box');
    const reply = screen.getByRole('article', { name: 'Lelañea said' });
    expect(alert.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  describe('the line above the composer', () => {
    it.each(['paused', 'unavailable'] as const)('shows one line for %s', async (generation) => {
      seat.generation = generation;
      await renderLoaded();
      const line = await screen.findByRole('status');
      expect(line.textContent).toBe(CONVERSATION_COPY.banner[generation]);
      // Above the composer, below the transcript.
      const log = screen.getByRole('log');
      expect(log.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(line.compareDocumentPosition(box()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('shows nothing when she is available, and clears once a read says so', async () => {
      seat.generation = 'paused';
      const user = userEvent.setup();
      await renderLoaded();
      await screen.findByRole('status');

      // Asked again after an ending: the switch is off now.
      seat.generation = 'available';
      await user.type(box(), 'hello{Enter}');
      await act(async () => {
        latestTurn().push('start', { conversationId: 'c1' });
        latestTurn().push('error', { code: 'unavailable', message: 'x' });
        latestTurn().close();
      });
      await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    });
  });
});

describe('folding the pane mid-conversation', () => {
  it('shows a reply already revealed whole on unfold, rather than typing it again', async () => {
    // Reduced motion here so the reveal is immediate and the test is about the
    // remount, not the pacing: with motion, the same path would re-type the
    // whole reply from nothing on every unfold (review round 2).
    motion.reduced = true;
    const user = userEvent.setup();
    await renderLoaded('large');
    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('content', { delta: 'Every word of this reply.' });
      latestTurn().push('done', {});
      latestTurn().close();
    });
    await waitFor(() => expect(herWords()).toBe('Every word of this reply.'));

    // Now with motion back on, fold and unfold. A reply still flagged as
    // streamed would remount `useTypedText` from '' and start typing.
    motion.reduced = false;
    await user.click(screen.getByRole('button', { name: 'Collapse the conversation' }));
    await user.click(screen.getByRole('button', { name: 'Open the conversation' }));

    expect(herWords()).toBe('Every word of this reply.');
    expect(screen.getByRole('article', { name: 'You said' }).textContent).toBe('hello');
  });
});

describe('a soft crisis frame whose resource did not parse', () => {
  it('shows the text form ahead of her reply, and keeps it there once the turn is done', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'a hard week{Enter}');
    await act(async () => {
      latestTurn().push('warning', {
        code: 'crisis',
        message: 'If things feel heavy: Samaritans, 116 123, 24/7.',
      });
      latestTurn().push('start', { conversationId: 'c1' });
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Samaritans, 116 123')
    );

    await act(async () => {
      latestTurn().push('content', { delta: 'I am here.' });
      latestTurn().push('done', {});
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONVERSATION_COPY.send })).toBeTruthy()
    );
    const alert = screen.getByRole('alert');
    const reply = screen.getByRole('article', { name: 'Lelañea said' });
    expect(alert.textContent).toContain('Samaritans, 116 123');
    // The resource comes first, whatever she then says.
    expect(alert.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the account under a reply (t-66)', () => {
  const citation = {
    marker: 1,
    chunkId: 'ch1',
    documentId: 'd1',
    documentName: 'On boundaries',
    contentHash: null,
    documentVersion: null,
    section: null,
    patternNumber: null,
    patternName: null,
    excerpt: 'A boundary is…',
    similarity: 0.9,
  };
  const reloadedReply = {
    kind: 'reply',
    id: 'a1',
    text: 'She says…',
    at: '2026-09-19T12:00:05.000Z',
    turnId: 't1',
    citations: [citation],
    capabilities: ['search_knowledge_base'],
    turn: {
      turnId: 't1',
      seat: 'facilitator',
      status: 'completed',
      attempts: 1,
      modelId: 'gpt-4o-mini-2024-07-18',
      providerSlug: 'openai',
      fingerprintVersion: 'v1',
      inputTokens: 3812,
      outputTokens: 240,
      costUsd: 0.0123,
      pricing: 'priced',
      errorCode: null,
      startedAt: '2026-09-19T12:00:00.000Z',
      completedAt: '2026-09-19T12:00:05.000Z',
    },
  };
  const row = () => screen.getByRole('button', { expanded: false });
  const account = () => {
    const button = screen.getByRole('button', { name: /Looked something up|Nothing was written/ });
    const detail = document.getElementById(button.getAttribute('aria-controls') ?? '');
    return { button, detail };
  };

  /** The same turn, arriving live. */
  async function liveTurn() {
    motion.reduced = true;
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'What does she say about boundaries?{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('capability_result', {
        capabilitySlug: 'search_knowledge_base',
        result: { success: true, data: {} },
      });
      latestTurn().push('content', { delta: 'She says…' });
      latestTurn().push('citations', { citations: [citation] });
      latestTurn().push('done', {
        tokenUsage: { inputTokens: 3812, outputTokens: 240, totalTokens: 4052 },
        costUsd: 0.0123,
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
      });
      latestTurn().close();
    });
    await waitFor(() => expect(herWords()).toBe('She says…'));
    return user;
  }

  it('sits under a completed reply, collapsed, and reads as a sentence — not a status line', async () => {
    seat.transcript = [
      { kind: 'user', id: 'u1', text: 'Boundaries?', at: '2026-09-19T12:00:00.000Z', turnId: 't1' },
      reloadedReply,
    ];
    await renderLoaded();
    const { button, detail } = account();
    expect(button.textContent).toMatch(/^\d{2}:\d{2}·Looked something up in her material$/);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(detail).toBeTruthy();
    expect(detail?.hidden).toBe(true);
    // Words, not system language.
    for (const text of [button.textContent, detail?.textContent]) {
      expect(text).not.toContain('gpt-4o');
      expect(text).not.toContain('facilitator');
      expect(text).not.toContain('search_knowledge_base');
    }
  });

  it('opens on the chevron with aria-expanded, and closes again', async () => {
    seat.transcript = [reloadedReply];
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(row());
    const { button, detail } = account();
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(detail?.hidden).toBe(false);
    expect(detail?.textContent).toBe(
      'Looked something up in her material and drew on 1 passage of it.\n' +
        'This turn used about 4,100 tokens and cost $0.01.'
    );
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(detail?.hidden).toBe(true);
  });

  it('shows the same account for the same turn, live and read back', async () => {
    const user = await liveTurn();
    const live = account();
    await user.click(live.button);
    const liveLine = live.button.textContent;
    const liveDetail = live.detail?.textContent;

    // Reload: the same turn from the read route.
    seat.transcript = [
      {
        kind: 'user',
        id: 'u1',
        text: 'What does she say about boundaries?',
        at: '2026-09-19T12:00:00.000Z',
        turnId: 't1',
      },
      reloadedReply,
    ];
    document.body.innerHTML = '';
    await renderLoaded();
    const back = account();
    // The clock reading is the reply's own time on each path; the words are the same.
    expect(liveLine?.slice(5)).toBe(back.button.textContent?.slice(5));
    expect(back.detail?.textContent).toBe(liveDetail);
    expect(liveDetail).toContain('drew on 1 passage');
    expect(liveDetail).toContain('cost $0.01');
  });

  it('appears only once the reply has been shown to its end', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('content', { delta: 'A reply of several words, paced.' });
      latestTurn().push('done', {});
      latestTurn().close();
    });
    // Folded into the transcript, still typing: no row yet.
    await waitFor(() => expect(screen.getByRole('article', { name: 'Lelañea said' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Nothing was written/ })).toBeNull();
    await waitFor(() => expect(herWords()).toBe('A reply of several words, paced.'), {
      timeout: 4000,
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Nothing was written/ })).toBeTruthy()
    );
  });

  it('has no row under a turn that ended without her, nor under a reply from before the seam', async () => {
    seat.transcript = [{ ...reloadedReply, turn: null, capabilities: [] }];
    const user = userEvent.setup();
    await renderLoaded();
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();

    await user.type(box(), 'hello{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('error', { code: 'unavailable', message: 'x' });
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('article', { name: CONVERSATION_COPY.endingLabel })).toBeTruthy()
    );
    expect(screen.queryByRole('button', { expanded: false })).toBeNull();
  });
});

describe('reading back', () => {
  it('shows the transcript on load, whole', async () => {
    seat.transcript = [
      { kind: 'user', id: 'u1', text: 'Earlier', at: '2026-09-19T12:00:00.000Z', turnId: 't1' },
      {
        kind: 'reply',
        id: 'a1',
        text: 'Yes, earlier.',
        at: '2026-09-19T12:00:05.000Z',
        turnId: 't1',
        citations: [],
        capabilities: [],
        turn: null,
      },
    ];
    await renderLoaded();
    expect(screen.getByRole('article', { name: 'You said' }).textContent).toBe('Earlier');
    expect(screen.getByRole('article', { name: 'Lelañea said' }).textContent).toBe('Yes, earlier.');
  });

  it('says so, inside the transcript, when there is nothing yet', async () => {
    const { container } = await renderLoaded();
    const transcript = container.querySelector('[role="log"]');
    expect(transcript?.textContent).toContain(CONVERSATION_COPY.empty);
    expect(container.querySelectorAll('article')).toHaveLength(0);
  });

  it('still lets a person talk when the transcript could not be read', async () => {
    vi.mocked(fetch).mockImplementationOnce(async () => new Response('', { status: 500 }));
    const user = userEvent.setup();
    await renderLoaded();
    expect(screen.getByText(CONVERSATION_COPY.unreadable)).toBeTruthy();
    await user.type(box(), 'hello{Enter}');
    expect(seat.bodies).toHaveLength(1);
  });
});

describe('the off-screen carousel pane', () => {
  it('is inert, now that it holds real controls', async () => {
    // `aria-hidden` does not remove focusability. With the composer live the
    // pane behind the workspace holds a real textarea, and a swipe must not
    // leave focus in a box nobody can see.
    mockPathname.current = '/app/journey';
    const { container } = await renderLoaded('small');
    const pane = container.querySelector('[data-pane="chat"]');
    expect(pane?.getAttribute('aria-hidden')).toBe('true');
    expect(pane?.hasAttribute('inert')).toBe(true);
  });
});

describe('the head', () => {
  it('names the column on the clean view, where the collapse control is hidden', () => {
    // The title was nested inside the collapse control's own condition, so the
    // one view every signed-in visitor lands on had no title on it at all. The
    // prototype hides `#chat-collapse` there (`#app.no-ws`) and keeps
    // `#chat-label` exactly where it always is.
    mockPathname.current = '/app';
    const { container } = renderInShell(<ConversationPane />, 'large');

    expect(container.textContent).toContain('the conversation');
    expect(screen.queryByRole('button', { name: 'Collapse the conversation' })).toBeNull();
  });

  it('names the column on a phone too', () => {
    mockPathname.current = '/app';
    const { container } = renderInShell(<ConversationPane />, 'small');
    expect(container.textContent).toContain('the conversation');
  });

  it('turns the title into the way back once there is a workspace open', () => {
    // t-36: with the workspace open the head is a LINK — a back arrow and `the
    // main conversation` in the secondary ink, with where you are beside it in
    // muted text. It was a small outlined panel glyph followed by `the
    // conversation` in grey, so the one way back out of a module read as a
    // caption. On `/app` there is nowhere to go back to, so the eyebrow stays.
    mockPathname.current = '/app/journey';
    renderInShell(<ConversationPane />, 'large');

    const back = screen.getByRole('link', { name: /the main conversation/ });
    expect(back.getAttribute('href')).toBe('/app');
    expect(back.className).toContain('text-[var(--color-secondary-ink)]');
    expect(screen.getByText('on Your journey')).toBeTruthy();
  });
});

describe('the split view keeps a conversation beside the work', () => {
  // t-36's third and fourth complaints. They were satisfied by t-31 rather than
  // re-solved here — the column's three parts and the shared composer card —
  // but nothing asserted either WITH THE WORKSPACE OPEN, which is the state
  // they are about. Every other case in this file renders the full-width view.

  it('keeps the title row, the transcript and the composer, rather than a centred sentence', async () => {
    mockPathname.current = '/app/modules/values';
    const { container } = await renderLoaded('large');

    // The way back is the title row in this state.
    expect(screen.getByRole('link', { name: /the main conversation/ })).toBeTruthy();
    // A real scroll container, with the honest note INSIDE it where a turn goes.
    const transcript = container.querySelector('.overflow-y-auto');
    expect(transcript).not.toBeNull();
    expect(transcript?.textContent).toContain(CONVERSATION_COPY.empty);
    // And the composer is still there.
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
  });

  it('uses the same composer card, just narrower', () => {
    // The card is centred on one 604px measure shared with the transcript, so
    // it narrows with its pane and needs no second styling. A split view that
    // collapsed it to a thin single-line input with a bare send glyph is the
    // defect.
    mockPathname.current = '/app/modules/values';
    const { container } = renderInShell(<ConversationPane />, 'large');

    const measured = container.querySelectorAll('.max-w-\\[604px\\]');
    expect(measured).toHaveLength(2);

    // The filled circular send disc, not a bare glyph.
    const send = screen.getByRole('button', { name: /^Send/ });
    expect(send.className).toContain('rounded-full');
    expect(send.className).toContain('bg-[var(--color-primary)]');
    // Multi-line, not a single-line input.
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' }).className).toContain(
      'min-h-[60px]'
    );
  });
});

describe('the composer card', () => {
  it('keeps the transcript and the composer on one measure', () => {
    // The card is centred on the prototype's 604px measure and the transcript
    // above it shares that measure, so the two read as one column at any pane
    // width — which is also what makes the split view (t-36) need no second
    // styling. A full-bleed bar ruled off with a border-top was neither.
    const { container } = renderInShell(<ConversationPane />, 'large');
    const measured = container.querySelectorAll('.max-w-\\[604px\\]');

    expect(measured).toHaveLength(2);
    measured.forEach((el) => expect(el.className).toContain('mx-auto'));
  });

  it('gives the box room to be more than one line before anyone types', () => {
    const { container } = renderInShell(<ConversationPane />, 'large');
    const box = container.querySelector('#shell-composer');

    expect(box?.getAttribute('rows')).toBe('2');
    expect(box?.className).toContain('min-h-[60px]');
  });
});

describe('dragging the pane', () => {
  it('tracks the pointer', () => {
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe('500');

    fireEvent.pointerUp(handle, { clientX: 560, pointerId: 1 });
  });

  it('stops tracking once the pointer is released', () => {
    // A drag that keeps listening after `pointerup` follows the cursor around
    // the page — the classic resize bug, and invisible until you let go.
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 540, pointerId: 1 });

    const settled = handle.getAttribute('aria-valuenow');
    fireEvent.pointerMove(handle, { clientX: 640, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe(settled);
  });

  it('folds to the strip when dragged past the fold', () => {
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });

    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });
});

describe('the strip', () => {
  it('is the whole button, not a disabled pane with a control on it', () => {
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });

    const strip = screen.getByRole('button', { name: 'Open the conversation' });
    expect(strip.textContent).toContain('Ask Lelañea');
  });
});

describe('collapsing the conversation', () => {
  it('offers a control to do it, not only the Escape key', () => {
    // There was NO affordance at all: the surface click is a fallback, and
    // nothing on screen said the pane could collapse. Escape was the only way,
    // which is not a thing anyone discovers.
    renderInShell(<ConversationPane />, 'large');
    expect(screen.getByRole('button', { name: 'Collapse the conversation' })).toBeTruthy();
  });

  it('collapses to the strip when it is pressed', async () => {
    renderInShell(<ConversationPane />, 'large');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the conversation' }));

    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });

  it('offers none on the clean view, where there is nothing to give the width to', () => {
    mockPathname.current = '/app';
    renderInShell(<ConversationPane />, 'large');
    expect(screen.queryByRole('button', { name: 'Collapse the conversation' })).toBeNull();
  });

  it('offers none on a phone, where the pane switch does this job', () => {
    renderInShell(<ConversationPane />, 'small');
    expect(screen.queryByRole('button', { name: 'Collapse the conversation' })).toBeNull();
  });
});

/**
 * What the turn offered (f-resources t-77): a chip under the reply, the
 * library's words, that opens the resources drawer pinned to it — live and
 * read back alike, because both paths carry the same shape.
 */
describe('a resource offered with a reply', () => {
  const onStalling = {
    id: 'on-stalling',
    kind: 'film' as const,
    title: 'On stalling',
    subtitle: 'why the words you avoid are the work',
    length: '5:04',
  };
  const offeredReply = {
    kind: 'reply',
    id: 'a1',
    text: 'There is a piece on exactly this.',
    at: '2026-09-19T12:00:05.000Z',
    turnId: 't1',
    citations: [],
    capabilities: ['suggest_resource'],
    suggestions: [onStalling],
    turn: {
      turnId: 't1',
      seat: 'facilitator',
      status: 'completed',
      attempts: 1,
      modelId: 'gpt-4o-mini-2024-07-18',
      providerSlug: 'openai',
      fingerprintVersion: 'v1',
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.001,
      pricing: 'priced',
      errorCode: null,
      startedAt: '2026-09-19T12:00:00.000Z',
      completedAt: '2026-09-19T12:00:05.000Z',
    },
  };

  /** What the shell was asked to open, read off the provider. */
  function Probe() {
    const { drawer, drawerPin } = useShellLayout();
    return <output data-testid="drawer">{`${drawer ?? '-'}:${drawerPin ?? '-'}`}</output>;
  }
  async function renderWithProbe() {
    const result = renderInShell(
      <>
        <ConversationPane />
        <Probe />
      </>
    );
    await waitFor(() => expect(screen.queryByText(CONVERSATION_COPY.loading)).toBeNull());
    return result;
  }
  // The account row's button names it too ("Pointed you to “On stalling”"),
  // so the chip is found inside its own list.
  const chip = () =>
    within(screen.getByRole('list', { name: 'Offered with this reply' })).getByRole('button', {
      name: /On stalling/,
    });

  it('is read back as a chip with the library’s title, and the account says so', async () => {
    seat.transcript = [offeredReply];
    await renderWithProbe();

    const offered = screen.getByRole('list', { name: 'Offered with this reply' });
    expect(within(offered).getByRole('button', { name: /On stalling/ })).toHaveTextContent(
      'Watch · 5:04'
    );
    expect(screen.getByRole('button', { name: /Pointed you to “On stalling”/ })).toBeTruthy();
  });

  it('opens the resources drawer pinned to it', async () => {
    seat.transcript = [offeredReply];
    const user = userEvent.setup();
    await renderWithProbe();
    expect(screen.getByTestId('drawer').textContent).toBe('-:-');

    await user.click(chip());

    expect(screen.getByTestId('drawer').textContent).toBe('resources:on-stalling');
  });

  it('arrives live off the capability frame, the same chip as on reload', async () => {
    motion.reduced = true;
    const user = userEvent.setup();
    await renderWithProbe();
    await user.type(box(), 'I keep putting it off.{Enter}');
    await act(async () => {
      latestTurn().push('start', { conversationId: 'c1' });
      latestTurn().push('capability_result', {
        capabilitySlug: 'suggest_resource',
        result: { success: true, data: onStalling },
      });
      // A refused one — the model invented an id — is no chip.
      latestTurn().push('capability_result', {
        capabilitySlug: 'suggest_resource',
        result: { success: false, error: { code: 'unknown_resource', message: 'no' } },
      });
      // And the same offer twice is one chip, not two with one key.
      latestTurn().push('capability_result', {
        capabilitySlug: 'suggest_resource',
        result: { success: true, data: onStalling },
      });
      latestTurn().push('content', { delta: 'There is a piece on exactly this.' });
      latestTurn().push('done', {});
      latestTurn().close();
    });
    await waitFor(() => expect(herWords()).toBe('There is a piece on exactly this.'));

    const offered = screen.getByRole('list', { name: 'Offered with this reply' });
    expect(within(offered).getAllByRole('button')).toHaveLength(1);
    expect(within(offered).getByRole('button', { name: /On stalling/ })).toBeTruthy();
    await user.click(chip());
    expect(screen.getByTestId('drawer').textContent).toBe('resources:on-stalling');
  });

  it('shows no chip and no such line on a reply that offered nothing', async () => {
    seat.transcript = [{ ...offeredReply, capabilities: [], suggestions: [] }];
    await renderWithProbe();
    expect(screen.queryByRole('list', { name: 'Offered with this reply' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Pointed you to/ })).toBeNull();
  });
});
