// @vitest-environment happy-dom

/**
 * The conversation pane: live from §10 t-64, and the drag that sizes it.
 *
 * The stub's rules — nothing sends, no digit, no article — lived here until
 * the conversation arrived. What replaces them is the conversation's own
 * contract: Enter sends and Shift+Enter does not, the box clears on the
 * server's `start`, the thinking row shows until her first words, a person
 * who asked for less motion gets the reply whole, and the off-screen carousel
 * pane is `inert` now that it holds real controls.
 *
 * @see components/app/shell/conversation-pane.tsx
 * @see components/app/conversation/*
 */

import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
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
};

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
  motion.reduced = false;
  seat.turns = [];
  seat.bodies = [];
  seat.transcript = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/app/conversation')) return transcriptResponse(seat.transcript);
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
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Lelañea said' }).textContent).toBe(
        'Every word at once, as it arrives.'
      )
    );
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

  it('tells the person when a turn ends without her, with the frame\u2019s words, and the words are back in the box', async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(box(), 'hello{Enter}');
    // `start` came first, so the box was cleared before the ending arrived —
    // the shape a provider outage takes on the real route.
    await act(async () => latestTurn().push('start', { conversationId: 'c1' }));
    await waitFor(() => expect(box()).toHaveValue(''));
    await act(async () => {
      latestTurn().push('error', { code: 'unavailable', message: 'Your message is kept.' });
      latestTurn().close();
    });
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'The turn ended' }).textContent).toBe(
        'Your message is kept.'
      )
    );
    expect(box()).toHaveValue('hello');
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
      expect(screen.getByRole('article', { name: 'The turn ended' })).toBeTruthy()
    );
    expect(box()).toHaveValue('a new thought');
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
    await waitFor(() =>
      expect(screen.getByRole('article', { name: 'Lelañea said' }).textContent).toBe(
        'Every word of this reply.'
      )
    );

    // Now with motion back on, fold and unfold. A reply still flagged as
    // streamed would remount `useTypedText` from '' and start typing.
    motion.reduced = false;
    await user.click(screen.getByRole('button', { name: 'Collapse the conversation' }));
    await user.click(screen.getByRole('button', { name: 'Open the conversation' }));

    expect(screen.getByRole('article', { name: 'Lelañea said' }).textContent).toBe(
      'Every word of this reply.'
    );
    expect(screen.getByRole('article', { name: 'You said' }).textContent).toBe('hello');
  });
});

describe('a soft crisis frame', () => {
  it('shows the resource ahead of her reply, and keeps it there once the turn is done', async () => {
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
