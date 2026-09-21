// @vitest-environment happy-dom

/**
 * The notes panel: what a person reads, what a turn changes while they read
 * it, and the two ways of answering back (f-slots t-73).
 *
 * ## It is mounted beside the real conversation pane, on purpose
 *
 * "Ask her about this" crosses from one pane to the other through
 * `ShellLayoutProvider`, and the only assertion worth making about it is that
 * the words end up in the box a person would then press send on. Mounting a
 * spy on `setAsk` instead would prove the panel called a setter and nothing
 * about whether anything received it — the exact shape of defect the provider's
 * `modulePlace` docblock records from t-10, where a value was published on the
 * wrong ancestor and no test noticed.
 *
 * The refresh is driven the same way: a real turn on the real pane, streaming
 * a `fill_slot` result and a `done`, with the notes endpoint answering more
 * the second time. Nothing here pokes `slotsWritten` directly.
 *
 * @see components/app/notes/notes-panel.tsx
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { certaintyBand, confidenceWords } from '@/components/app/notes/note-card';
import { NotesPanel } from '@/components/app/notes/notes-panel';
import { ConversationPane } from '@/components/app/shell/conversation-pane';
import type { Note, NotesView } from '@/lib/app/slots/notes-view';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/notes' }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => true }));
vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function note(overrides: Partial<Note> = {}): Note {
  return {
    slotSlug: 'life_work',
    asking: 'How work stands for this person right now.',
    value: 'Work is going badly and they are thinking about leaving.',
    withheld: false,
    confidence: 6,
    sourceType: 'inferred',
    reasoningNote: 'She put this together from two things said in passing.',
    version: 1,
    capturedAt: '2026-09-21T09:15:00.000Z',
    conversationId: 'c1',
    sensitivity: 'standard',
    retired: false,
    correctable: true,
    previous: null,
    ...overrides,
  };
}

function view(notes: Note[], improvised: Note[] = []): NotesView {
  return {
    groups: notes.length ? [{ key: 'life_areas', title: 'Life areas', notes }] : [],
    improvised,
    total: notes.length + improvised.length,
  };
}

function sse(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

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

const world = {
  /** What `GET /api/v1/app/notes` answers next. Shift one off per read. */
  reads: [] as NotesView[],
  notesReads: 0,
  correctionRefusal: null as { status: number; message: string; reason: string } | null,
  /** How many of the next notes READS should fail — the conversation's own reads must not. */
  failNextReads: 0,
  corrections: [] as { slotSlug: string; value: string }[],
  turn: null as ReturnType<typeof openTurn> | null,
};

const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

  if (href.startsWith('/api/v1/app/notes')) {
    if (init?.method === 'POST') {
      // `init.body` is `BodyInit`; the client always sends a JSON string, and
      // asserting that here rather than stringifying a `Blob` into
      // "[object Object]" keeps a changed client from passing quietly.
      const raw = typeof init.body === 'string' ? init.body : '';
      const body = JSON.parse(raw) as { slotSlug: string; value: string };
      if (world.correctionRefusal) {
        const { status, message, reason } = world.correctionRefusal;
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: 'CONFLICT', message, details: { reason } },
          }),
          { status, headers: { 'content-type': 'application/json' } }
        );
      }
      world.corrections.push(body);
      return new Response(
        JSON.stringify({ success: true, data: { slotSlug: body.slotSlug, version: 2 } }),
        { status: 201 }
      );
    }
    world.notesReads += 1;
    if (world.failNextReads > 0) {
      world.failNextReads -= 1;
      return new Response('', { status: 500 });
    }
    const next = world.reads.length > 1 ? world.reads.shift()! : world.reads[0];
    return new Response(JSON.stringify({ success: true, data: next }), { status: 200 });
  }

  if (href.startsWith('/api/v1/app/conversation')) {
    return new Response(
      JSON.stringify({
        success: true,
        data: { seat: 'facilitator', conversationId: null, entries: [] },
      }),
      { status: 200 }
    );
  }
  if (href.startsWith('/api/v1/app/agent/status')) {
    return new Response(JSON.stringify({ success: true, data: { generation: 'available' } }), {
      status: 200,
    });
  }
  if (href.startsWith('/api/v1/app/agent/transcribe')) {
    return new Response(JSON.stringify({ success: true, data: { voiceInput: 'off' } }), {
      status: 200,
    });
  }

  world.turn = openTurn();
  return world.turn.response;
}) as unknown as typeof fetch;

/** The panel, and the conversation it talks to, under one provider. */
function renderBoth() {
  return renderInShell(
    <>
      <ConversationPane />
      <NotesPanel fetchImpl={fetchImpl} />
    </>
  );
}

const composer = () => screen.getByRole('textbox', { name: /message lela/i });

beforeEach(() => {
  world.reads = [view([note()])];
  world.notesReads = 0;
  world.correctionRefusal = null;
  world.failNextReads = 0;
  world.corrections = [];
  world.turn = null;
  vi.mocked(fetchImpl).mockClear();
  vi.stubGlobal('fetch', fetchImpl);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('how sure Lelañea is', () => {
  it('bands the stored 1-10, and clamps rather than throwing at the edges', () => {
    expect([10, 9, 8, 7, 6, 4, 3, 1].map(certaintyBand)).toEqual([
      'high',
      'high',
      'fair',
      'fair',
      'low',
      'low',
      'guess',
      'guess',
    ]);
    // A free-form column upstream could hand us anything; the bar must not
    // decide there are eleven notches or minus one.
    expect(certaintyBand(99)).toBe('high');
    expect(certaintyBand(0)).toBe('guess');
  });

  it('says the same thing in words as the bar says in colour (WCAG 1.4.1)', () => {
    // The bar is `aria-hidden` precisely because this line carries the fact.
    // If the words ever stop tracking the bands, the colour becomes the only
    // channel — which is the failure the hidden attribute would then hide.
    expect(new Set([10, 8, 5, 2].map(confidenceWords)).size).toBe(4);
    expect(confidenceWords(6)).toBe('Not certain');
  });
});

describe('what the panel shows', () => {
  it('carries the reading, how Lelañea knows, and her wording behind the disclosure', async () => {
    renderBoth();

    expect(await screen.findByText(/Work is going badly/)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Life areas' })).toBeTruthy();
    // The slug is the card's tag; the taxonomy's own third-person wording is
    // quoted inside the disclosure, where it is plainly Lelañea's words rather
    // than the panel calling the reader "this person".
    expect(screen.getByText('life work')).toBeTruthy();
    expect(screen.getByText(/What Lelañea was looking for/)).toBeTruthy();
    expect(screen.getByText(/How work stands for this person right now/)).toBeTruthy();
    // §3.19: how it was known, and how sure — in words and in the number. The
    // meta line interpolates three fragments, so it is asserted whole rather
    // than by a text matcher that would not see across the element boundaries.
    const meta = screen.getByText(
      (_, element) =>
        element?.tagName === 'P' && /Lelañea inferred it/.test(element.textContent ?? '')
    );
    expect(meta.textContent?.replace(/\s+/g, ' ')).toMatch(
      /Lelañea inferred it · Not certain \(6 of 10\) · 21 September/
    );
    expect(screen.getByText(/two things said in passing/)).toBeTruthy();
  });

  it('shows the version before a contradiction beside it, not as an error', async () => {
    world.reads = [
      view([
        note({
          version: 2,
          value: 'Work is going fine.',
          sourceType: 'user_confirmed',
          previous: {
            version: 1,
            value: 'Work is going badly.',
            withheld: false,
            sourceType: 'inferred',
            confidence: 6,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        }),
      ]),
    ];
    renderBoth();

    expect(await screen.findByText('Work is going fine.')).toBeTruthy();
    expect(screen.getByText('Work is going badly.')).toBeTruthy();
    expect(screen.getByText(/kept, not replaced/)).toBeTruthy();
    // §3.12: a door, not a fault. Nothing on the card interrupts a reader.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says what a withheld note is instead of printing the sentinel', async () => {
    world.reads = [
      view([
        note({
          slotSlug: 'life_physical_health',
          value: '<redacted: special_category>',
          withheld: true,
          sensitivity: 'special_category',
          correctable: false,
        }),
      ]),
    ];
    renderBoth();

    expect(await screen.findByText(/deliberately kept no record/)).toBeTruthy();
    expect(screen.queryByText(/redacted/)).toBeNull();
    // The guard's remedy is still on the card (`HB10`).
    expect(screen.queryByRole('button', { name: /not right/i })).toBeNull();
    expect(screen.getByRole('button', { name: /ask lela.*about this/i })).toBeTruthy();
  });

  it('keeps a slug Lelañea invented under a heading of its own', async () => {
    world.reads = [
      view(
        [note()],
        [
          note({
            slotSlug: 'family_communication',
            asking: null,
            value: 'Has not called his brother.',
          }),
        ]
      ),
    ];
    renderBoth();

    const section = (
      await screen.findByRole('heading', { level: 2, name: 'Lelañea’s own headings' })
    ).parentElement as HTMLElement;
    expect(within(section).getByText('Has not called his brother.')).toBeTruthy();
    expect(within(section).queryByText(/Work is going badly/)).toBeNull();
  });

  it('says what will fill an empty page rather than that there is nothing', async () => {
    world.reads = [view([])];
    renderBoth();

    expect(await screen.findByText(/Lelañea has written nothing down yet/)).toBeTruthy();
  });
});

describe('a turn that captures moves the panel while you are looking at it', () => {
  async function takeTurn(push: () => void) {
    await userEvent.type(composer(), 'work is going badly');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(world.turn).not.toBeNull());
    await act(async () => {
      world.turn!.push('start', { conversationId: 'c1' });
      push();
      world.turn!.push('content', { delta: 'Noted.' });
      world.turn!.push('done', {});
      world.turn!.close();
    });
  }

  const wrote = () =>
    world.turn!.push('capability_result', {
      capabilitySlug: 'fill_slot',
      result: { success: true, data: { slotSlug: 'life_money', version: 1, minted: false } },
    });

  it('re-reads once and shows the new note', async () => {
    world.reads = [
      view([note()]),
      view([note({ slotSlug: 'life_money', value: 'Money is tight this month.' }), note()]),
    ];
    renderBoth();
    await screen.findByText(/Work is going badly/);
    expect(world.notesReads).toBe(1);

    await takeTurn(wrote);

    expect(await screen.findByText('Money is tight this month.')).toBeTruthy();
    expect(world.notesReads).toBe(2);
  });

  it('does not re-read when the turn wrote nothing', async () => {
    renderBoth();
    await screen.findByText(/Work is going badly/);
    expect(world.notesReads).toBe(1);

    // The turn runs and answers — the reply below is what makes "no second
    // read" an absence over a non-empty population rather than a turn that
    // never happened.
    await takeTurn(() => {});

    expect(await screen.findByText('Noted.')).toBeTruthy();
    expect(world.notesReads).toBe(1);
  });
});

describe('answering back', () => {
  it('hands a note to the composer without writing anything', async () => {
    renderBoth();
    await screen.findByText(/Work is going badly/);

    await userEvent.click(screen.getByRole('button', { name: /ask lela.*about this/i }));

    await waitFor(() =>
      expect((composer() as HTMLTextAreaElement).value).toContain('Work is going badly')
    );
    expect((composer() as HTMLTextAreaElement).value).toMatch(/Can we talk about that\?/);
    // Handing over is not sending, and it is not a correction either.
    expect(world.corrections).toEqual([]);
    expect(world.notesReads).toBe(1);
  });

  it('corrects in place, then re-reads so both versions are on screen', async () => {
    world.reads = [
      view([note()]),
      view([
        note({
          version: 2,
          value: 'It is going fine, actually.',
          sourceType: 'user_confirmed',
          previous: {
            version: 1,
            value: 'Work is going badly and they are thinking about leaving.',
            withheld: false,
            sourceType: 'inferred',
            confidence: 6,
            capturedAt: '2026-09-21T09:15:00.000Z',
          },
        }),
      ]),
    ];
    renderBoth();
    await screen.findByText(/Work is going badly/);

    await userEvent.click(screen.getByRole('button', { name: /not right/i }));
    const box = screen.getByRole('textbox', { name: /your correction/i });
    await userEvent.clear(box);
    await userEvent.type(box, 'It is going fine, actually.');
    await userEvent.click(screen.getByRole('button', { name: /save this instead/i }));

    await waitFor(() =>
      expect(world.corrections).toEqual([
        { slotSlug: 'life_work', value: 'It is going fine, actually.' },
      ])
    );
    expect(await screen.findByText('It is going fine, actually.')).toBeTruthy();
    // Never an overwrite: what she wrote is still there underneath.
    expect(
      screen.getByText(/Work is going badly and they are thinking about leaving\./)
    ).toBeTruthy();
  });

  it('shows a refusal in the words the route chose, because they name the remedy', async () => {
    world.correctionRefusal = {
      status: 409,
      reason: 'kept_out_of_the_record',
      message:
        'Lelañea deliberately keeps no record of what you said here. Ask her about it instead.',
    };
    renderBoth();
    await screen.findByText(/Work is going badly/);

    await userEvent.click(screen.getByRole('button', { name: /not right/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /your correction/i }), '!');
    await userEvent.click(screen.getByRole('button', { name: /save this instead/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Ask her about it instead.');
    // Still editable, with the words the person typed still in the box.
    expect(screen.getByRole('textbox', { name: /your correction/i })).toBeTruthy();
  });
});

describe('when the read does not get through', () => {
  it('says so on a first read, and keeps the notes on a later one', async () => {
    world.failNextReads = 1;
    const { unmount } = renderBoth();
    // Not `findByRole('status')`: the loading line carries that role too, and
    // it is the first match while the read is still in flight.
    expect(await screen.findByText(/could not be read just now/)).toBeTruthy();
    unmount();

    // And on a refresh, the page a person was reading is not replaced by an
    // error — the notes are still true, the read simply did not land.
    renderBoth();
    await screen.findByText(/Work is going badly/);
    world.failNextReads = 1;

    await userEvent.type(composer(), 'anything');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(world.turn).not.toBeNull());
    await act(async () => {
      world.turn!.push('start', { conversationId: 'c1' });
      world.turn!.push('capability_result', {
        capabilitySlug: 'fill_slot',
        result: { success: true, data: { slotSlug: 'life_money', version: 1, minted: false } },
      });
      world.turn!.push('done', {});
      world.turn!.close();
    });

    expect(await screen.findByText(/as it stood a moment ago/)).toBeTruthy();
    expect(screen.getByText(/Work is going badly/)).toBeTruthy();
  });
});
