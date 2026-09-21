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
import { notesQuerySchema, queryNotes } from '@/lib/app/slots/notes-query';
import type { Note } from '@/lib/app/slots/notes-view';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

/**
 * `next/navigation`, as a history the test can read and step back through.
 *
 * `push` adds an entry and `replace` rewrites the current one — the one
 * difference the panel's URL handling turns on — and `back()` steps the index,
 * which re-renders every `useSearchParams` reader the way the real router
 * does. Asserting against a spy's call list alone would prove the panel called
 * `push`, not that Back then lands where a reader expects.
 */
const nav = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const state = { entries: ['/app/notes'], index: 0 };
  const emit = () => listeners.forEach((listener) => listener());
  /**
   * When set, a navigation is parked here rather than committed — the way a
   * real one on a dynamic route lands a server round trip later. `settle()`
   * commits them in order; `settleLast()` commits only the newest, as the
   * router does when a newer navigation overtakes an older one.
   */
  const held: { on: boolean; moves: (() => void)[] } = { on: false, moves: [] };
  const commitPush = (href: string) => {
    state.entries = [...state.entries.slice(0, state.index + 1), href];
    state.index += 1;
    emit();
  };
  const commitReplace = (href: string) => {
    state.entries[state.index] = href;
    emit();
  };
  return {
    state,
    held,
    settle: () => {
      const pending = held.moves.splice(0);
      pending.forEach((commit) => commit());
    },
    settleLast: () => {
      const pending = held.moves.splice(0);
      pending.at(-1)?.();
    },
    push: (href: string) => {
      if (held.on) held.moves.push(() => commitPush(href));
      else commitPush(href);
    },
    replace: (href: string) => {
      if (held.on) held.moves.push(() => commitReplace(href));
      else commitReplace(href);
    },
    back: () => {
      if (state.index > 0) state.index -= 1;
      emit();
    },
    current: () => state.entries[state.index] ?? '/app/notes',
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    reset: (href = '/app/notes') => {
      state.entries = [href];
      state.index = 0;
      held.on = false;
      held.moves = [];
    },
  };
});

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { createMockRouter } = await import('@/tests/types/mocks');
  // Built once, so `useRouter()` is stable across renders as the real one is.
  // The factory supplies every member; the history-moving three are ours.
  const router = createMockRouter({
    push: vi.fn(nav.push),
    replace: vi.fn(nav.replace),
    back: vi.fn(nav.back),
  });
  return {
    usePathname: () => '/app/notes',
    useRouter: () => router,
    useSearchParams: () => {
      const href = useSyncExternalStore(nav.subscribe, nav.current);
      return new URLSearchParams(href.split('?')[1] ?? '');
    },
  };
});
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
    group: 'life_areas',
    ...overrides,
  };
}

/**
 * A person's whole record: `notes` under "Life areas", `own` under Lelañea's
 * own headings. The fake server answers each read by running the REAL
 * `queryNotes` over it with the query the panel sent, so a filter here behaves
 * as the route's does.
 */
function view(notes: Note[], own: Note[] = []): Note[] {
  return [...notes, ...own.map((mint) => ({ ...mint, group: null }))];
}

function answer(record: Note[], href: string): Response {
  const params = new URLSearchParams(href.split('?')[1] ?? '');
  const query = notesQuerySchema.parse(Object.fromEntries(params));
  return new Response(JSON.stringify({ success: true, data: queryNotes(record, query) }), {
    status: 200,
  });
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
  /** The record `GET /api/v1/app/notes` answers from next. Shift one off per read. */
  reads: [] as Note[][],
  notesReads: 0,
  /** Every notes GET's URL, in order. */
  notesUrls: [] as string[],
  correctionRefusal: null as { status: number; message: string; reason: string } | null,
  /** How many of the next notes READS should fail — the conversation's own reads must not. */
  failNextReads: 0,
  corrections: [] as { slotSlug: string; value: string }[],
  turn: null as ReturnType<typeof openTurn> | null,
  /**
   * When set, notes GETs are NOT answered: each parks a resolver here instead,
   * and the test releases them in whatever order it is proving something about.
   */
  hold: null as null | ((record: Note[]) => void)[],
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
    world.notesUrls.push(href);
    if (world.hold) {
      const parked = world.hold;
      return new Promise<Response>((resolve) => {
        parked.push((record) => resolve(answer(record, href)));
      });
    }
    if (world.failNextReads > 0) {
      world.failNextReads -= 1;
      return new Response('', { status: 500 });
    }
    const next = world.reads.length > 1 ? world.reads.shift()! : (world.reads[0] ?? []);
    return answer(next, href);
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
  world.notesUrls = [];
  nav.reset();
  world.correctionRefusal = null;
  world.failNextReads = 0;
  world.corrections = [];
  world.turn = null;
  world.hold = null;
  vi.mocked(fetchImpl).mockClear();
  vi.stubGlobal('fetch', fetchImpl);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('how sure Lelañea is', () => {
  it('bands the stored 1-10 on HER bands, and clamps rather than throwing', () => {
    // 8 is where "said it plainly about themselves" starts in her instructions
    // (`.context/app/voice.md`), so an 8 must read as Confident. The first cut
    // put it at 9 and undersold exactly the readings a person was most direct
    // about. Each boundary is asserted from both sides.
    expect([10, 8, 7, 5, 4, 3, 2, 1].map(certaintyBand)).toEqual([
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
    expect(new Set([10, 6, 4, 1].map(confidenceWords)).size).toBe(4);
    expect(confidenceWords(4)).toBe('Not certain');
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
    // §3.19: how it was known, how sure, and when — the three facts that now
    // live in the aside, each on its own line rather than run together.
    expect(screen.getByText('Lelañea inferred it')).toBeTruthy();
    // A 6 is "clearly meant without saying it outright" in her own bands, so
    // it reads Fairly sure — not the Not certain the first cut of the bands
    // gave it.
    expect(screen.getByText('Fairly sure')).toBeTruthy();
    expect(screen.getByText(/6 of 10/)).toBeTruthy();
    expect(screen.getByText(/21 September/)).toBeTruthy();
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
    expect(screen.getByText(/Kept, not replaced/)).toBeTruthy();
    // Folded, the head still says whose reading it was and when — so a reader
    // can decide whether to open it without opening it.
    const fold = screen.getByText('Before this').closest('summary') as HTMLElement;
    expect(fold.textContent?.replace(/\s+/g, ' ')).toMatch(
      /Before this · Lelañea inferred it, 20 September/
    );
    // §3.12: a door, not a fault. Nothing on the card interrupts a reader.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts the readings it is not showing, rather than pretending there were two', async () => {
    // Version 4 means three earlier readings: one in the inset, two counted.
    // §3.12 wants the previous answer beside the new one, not a changelog —
    // but a card that said nothing about the other two would read as though
    // this had only ever changed once.
    world.reads = [
      view([
        note({
          version: 4,
          value: 'It is going fine now.',
          previous: {
            version: 3,
            value: 'It was going badly.',
            withheld: false,
            sourceType: 'inferred',
            confidence: 6,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        }),
      ]),
    ];
    renderBoth();

    expect(await screen.findByText('It was going badly.')).toBeTruthy();
    // On the head, where a reader sees it without opening the fold.
    const fold = screen.getByText('Before this').closest('summary') as HTMLElement;
    expect(fold.textContent).toMatch(/2 older readings as well/);
    expect(screen.getByText(/The readings before that are kept too/)).toBeTruthy();
  });

  it('says "one" rather than "1" when a single reading is uncounted', async () => {
    world.reads = [
      view([
        note({
          version: 3,
          previous: {
            version: 2,
            value: 'It was going badly.',
            withheld: false,
            sourceType: 'inferred',
            confidence: 6,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        }),
      ]),
    ];
    renderBoth();

    const fold = (await screen.findByText('Before this')).closest('summary') as HTMLElement;
    expect(fold.textContent).toMatch(/1 older reading as well/);
    expect(screen.getByText(/The reading before that is kept too/)).toBeTruthy();
  });

  it('counts nothing when the shown version is the only earlier one', async () => {
    world.reads = [
      view([
        note({
          version: 2,
          previous: {
            version: 1,
            value: 'It was going badly.',
            withheld: false,
            sourceType: 'inferred',
            confidence: 6,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        }),
      ]),
    ];
    renderBoth();

    // The population is non-empty — the inset is on screen — so the absence
    // below is the arithmetic working rather than a card that rendered nothing.
    expect(await screen.findByText('It was going badly.')).toBeTruthy();
    expect(screen.queryByText(/older reading/i)).toBeNull();
    expect(screen.queryByText(/before that/i)).toBeNull();
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

    // The heading now sits in a row beside the rule and the count, so the
    // section is two levels up rather than one.
    const section = (
      await screen.findByRole('heading', { level: 2, name: 'Lelañea’s own headings' })
    ).closest('section') as HTMLElement;
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

/**
 * The panel's reads are ordered, and a remount is a mount (/code-review round 1).
 *
 * The provider outlives the panel: navigating away from `/app/notes` and back
 * unmounts the panel and mounts a new one under the SAME provider, whose write
 * counter is by then above zero. Both cases are asserted against the shape of
 * the defect, not against a spy — the first counts real requests, the second
 * releases two real responses in the wrong order and reads the screen.
 */
describe('the reads are ordered', () => {
  const wroteNote = async () => {
    await userEvent.type(composer(), 'work is going badly');
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
  };

  it('reads once when it comes back, however many turns wrote while it was away', async () => {
    const { rerender } = renderBoth();
    await screen.findByText(/Work is going badly/);
    await wroteNote();
    await waitFor(() => expect(world.notesReads).toBe(2));

    // Away, and back — the provider lives on with its counter at 1.
    rerender(<ConversationPane />);
    const before = world.notesReads;
    rerender(
      <>
        <ConversationPane />
        <NotesPanel fetchImpl={fetchImpl} />
      </>
    );
    await screen.findByText(/Work is going badly/);

    // A mount is a mount. The counter effect used to fire alongside the mount
    // read because the counter was already non-zero — two requests for one
    // arrival.
    expect(world.notesReads - before).toBe(1);
  });

  it('keeps the newest answer when an older one lands after it', async () => {
    renderBoth();
    await screen.findByText(/Work is going badly/);

    // Two reads in flight at once: a correction's re-read, then a turn's.
    world.hold = [];
    await userEvent.click(screen.getByRole('button', { name: /not right/i }));
    await userEvent.clear(screen.getByRole('textbox', { name: /your correction/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /your correction/i }), 'older');
    await userEvent.click(screen.getByRole('button', { name: /save this instead/i }));
    await waitFor(() => expect(world.hold).toHaveLength(1));
    await wroteNote();
    await waitFor(() => expect(world.hold).toHaveLength(2));

    // A guard rather than `!`: if the setup ever parks fewer than two reads,
    // this says so, instead of the release below throwing on `undefined`.
    const [olderRead, newerRead] = world.hold;
    if (!olderRead || !newerRead) throw new Error('expected two reads in flight');
    // The NEWER request answers first, then the older one straggles in.
    await act(async () => newerRead(view([note({ value: 'The newest page.' })])));
    await screen.findByText('The newest page.');
    await act(async () => olderRead(view([note({ value: 'A page from before.' })])));

    // The straggler must not win. Before the fix, whichever response arrived
    // last was what `setNotes` kept — an older page on screen, missing the
    // newest note, until the next write.
    expect(screen.getByText('The newest page.')).toBeTruthy();
    expect(screen.queryByText('A page from before.')).toBeNull();
  });
});

/**
 * Finding your way around (t-79): every control in the URL, Back through the
 * choices, one fetch drawn two ways, and a list row that opens its card.
 *
 * The server here is the real `queryNotes` over a fixed record, so a filter
 * narrows the way the route narrows — these cases are about what the PAGE does
 * with that, not a second test of the query.
 */
describe('finding your way around', () => {
  const record = () =>
    view(
      [
        note({ slotSlug: 'life_work', capturedAt: '2026-09-21T09:00:00.000Z' }),
        note({
          slotSlug: 'life_money',
          value: 'Money is tight this month.',
          capturedAt: '2026-09-21T11:00:00.000Z',
        }),
        note({
          slotSlug: 'the_person_disposition',
          group: 'the_person',
          value: 'Quick to laugh, slow to decide.',
          capturedAt: '2026-09-21T10:00:00.000Z',
        }),
      ],
      [
        note({
          slotSlug: 'family_communication',
          asking: null,
          value: 'Has not spoken to his brother since the summer.',
          capturedAt: '2026-09-21T12:00:00.000Z',
        }),
      ]
    );

  /** The readings on screen, in the order they are drawn. */
  const readings = () =>
    screen
      .queryAllByText(/^(Work is going|Money is tight|Quick to laugh|Has not spoken)/)
      .map((element) => element.textContent);

  const search = () => screen.getByRole('searchbox', { name: /search lela/i });
  const groupPicker = () => screen.getByRole('combobox', { name: /show notes under/i });
  const sortPicker = () => screen.getByRole('combobox', { name: /order/i });
  const layoutChip = (name: 'Cards' | 'List') =>
    within(screen.getByRole('group', { name: /show as/i })).getByRole('button', { name });

  beforeEach(() => {
    world.reads = [record()];
  });

  it('types into the URL after a pause without adding history, and asks the server', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');

    await userEvent.type(search(), 'brother');

    await waitFor(() => expect(nav.current()).toBe('/app/notes?q=brother'));
    // Replaced, not pushed: Back from here leaves the search, not one letter.
    expect(nav.state.entries).toEqual(['/app/notes?q=brother']);
    await waitFor(() =>
      expect(readings()).toEqual(['Has not spoken to his brother since the summer.'])
    );
    expect(world.notesUrls.at(-1)).toBe('/api/v1/app/notes?q=brother');
    // "of", while narrowing: a bare "1 note" would read as everything held.
    expect(screen.getByText('1 of 4 notes')).toBeTruthy();
  });

  it('pushes a group, a sort and a view, so Back steps through each one', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');

    await userEvent.selectOptions(groupPicker(), 'life_areas');
    await waitFor(() => expect(readings()).toHaveLength(2));
    await userEvent.selectOptions(sortPicker(), 'recent');
    await userEvent.click(layoutChip('List'));

    expect(nav.state.entries).toEqual([
      '/app/notes',
      '/app/notes?group=life_areas',
      '/app/notes?group=life_areas&sort=recent',
      '/app/notes?group=life_areas&sort=recent&view=list',
    ]);
    expect(screen.getAllByRole('button', { expanded: false })).toHaveLength(2);

    await act(async () => nav.back());
    // Back to cards: the rows are gone and a card's own controls are back.
    expect(screen.queryAllByRole('button', { expanded: false })).toHaveLength(0);
    expect(screen.getAllByRole('button', { name: /ask lela.*about this/i })).toHaveLength(2);

    await act(async () => nav.back());
    expect((sortPicker() as HTMLSelectElement).value).toBe('grouped');

    await act(async () => nav.back());
    expect((groupPicker() as HTMLSelectElement).value).toBe('');
    await waitFor(() => expect(readings()).toHaveLength(4));
  });

  it('opens a linked view as the link says', async () => {
    nav.reset('/app/notes?q=tight&view=list');
    renderBoth();

    await screen.findByText('Money is tight this month.');
    expect(world.notesUrls[0]).toBe('/api/v1/app/notes?q=tight');
    expect((search() as HTMLInputElement).value).toBe('tight');
    expect(layoutChip('List').getAttribute('aria-pressed')).toBe('true');
    expect(readings()).toEqual(['Money is tight this month.']);
  });

  it('draws one fetch as cards and as a list: the same notes, in the same order', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');
    const asCards = readings();
    const reads = world.notesReads;

    await userEvent.click(layoutChip('List'));

    // In order, not just as a set: the list is the same page, drawn tighter.
    expect(readings()).toEqual(asCards);
    // A view switch is a drawing choice, not a question for the server.
    expect(world.notesReads).toBe(reads);
    expect(asCards).toHaveLength(4);
  });

  it('opens a list row as its full card, with both controls working, and folds back', async () => {
    nav.reset('/app/notes?view=list');
    renderBoth();
    const row = (await screen.findByText('Money is tight this month.')).closest(
      'button'
    ) as HTMLElement;
    // A row carries no buttons of its own.
    expect(within(row).queryByRole('button')).toBeNull();

    await userEvent.click(row);

    const ask = await screen.findByRole('button', { name: /ask lela.*about this/i });
    expect(screen.getByRole('button', { name: /not right/i })).toBeTruthy();
    await userEvent.click(ask);
    await waitFor(() =>
      expect((composer() as HTMLTextAreaElement).value).toContain('Money is tight this month.')
    );

    await userEvent.click(screen.getByRole('button', { name: /not right/i }));
    const box = screen.getByRole('textbox', { name: /your correction/i });
    await userEvent.clear(box);
    await userEvent.type(box, 'Money is fine.');
    await userEvent.click(screen.getByRole('button', { name: /save this instead/i }));
    await waitFor(() =>
      expect(world.corrections).toEqual([{ slotSlug: 'life_money', value: 'Money is fine.' }])
    );

    // Still open after the re-read the correction caused — then folded back
    // by the chevron, with focus on the row it became.
    const fold = await screen.findByRole('button', { name: /fold this note/i });
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(fold);
    const folded = screen.getByText('Money is tight this month.').closest('button');
    expect(folded?.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(folded);
  });

  it('folds a card to its row in cards view too, and opens it again', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');
    // Every note is open in cards view: four chevrons, no rows.
    expect(screen.getAllByRole('button', { name: /fold this note/i })).toHaveLength(4);
    expect(screen.queryAllByRole('button', { expanded: false })).toHaveLength(0);

    const card = screen.getByText('Money is tight this month.').closest('section') as HTMLElement;
    await userEvent.click(within(card).getAllByRole('button', { name: /fold this note/i })[0]);

    const row = screen.getByText('Money is tight this month.').closest('button') as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button', { name: /fold this note/i })).toHaveLength(3);

    await userEvent.click(row);
    expect(screen.getAllByRole('button', { name: /fold this note/i })).toHaveLength(4);
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Fold this note/);
  });

  it('folds a card from anywhere along its header, not only the chevron', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');

    // The tag is the header's own text; clicking it is clicking the header.
    await userEvent.click(screen.getByText('life money'));

    const row = screen.getByText('Money is tight this month.').closest('button');
    expect(row?.getAttribute('aria-expanded')).toBe('false');
    // One control, one name: the header announces what it does and what it is.
    expect(screen.getAllByRole('button', { name: /^Fold this note: life work$/ })).toHaveLength(1);
  });

  it('keeps typing that lands while the last search is still reaching the URL', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');
    nav.held.on = true;

    await userEvent.type(search(), 'mon');
    // The pause ends and the box sends "mon" — which has not committed yet.
    await waitFor(() => expect(nav.held.moves).toHaveLength(1));
    await userEvent.type(search(), 'ey');
    // Now "mon" lands, late. It is the box's own echo, not a Back.
    await act(async () => nav.settle());

    expect((search() as HTMLInputElement).value).toBe('money');
    nav.held.on = false;
    await waitFor(() => expect(nav.current()).toBe('/app/notes?q=money'));
  });

  it('keeps a group picked while a search is still waiting out its pause', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');
    nav.held.on = true;

    // Type, then pick a group inside the pause. The pick's push is parked, so
    // the page still holds the render before it — which is what the search's
    // timer was built from.
    await userEvent.type(search(), 'money');
    await userEvent.selectOptions(groupPicker(), 'life_areas');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await act(async () => nav.settle());

    // One entry for the pick, carrying the search — not a late replace that
    // put the old group back over it.
    expect(nav.current()).toBe('/app/notes?q=money&group=life_areas');
    expect(nav.state.entries).toEqual(['/app/notes', '/app/notes?q=money&group=life_areas']);
  });

  it('clears the box on Clear even after the router dropped an earlier search', async () => {
    nav.reset('/app/notes?q=money');
    renderBoth();
    await screen.findByText('Money is tight this month.');
    nav.held.on = true;

    await userEvent.clear(search());
    await waitFor(() => expect(nav.held.moves).toHaveLength(1));
    await userEvent.type(search(), 'q');
    await waitFor(() => expect(nav.held.moves).toHaveLength(2));
    // The router lands the newer search and abandons the older one, so the
    // empty search is never echoed back.
    await act(async () => nav.settleLast());

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await act(async () => nav.settle());

    expect((search() as HTMLInputElement).value).toBe('');
    expect(nav.current()).toBe('/app/notes');
  });

  it('does not bring back the filter Clear removed, however late Clear lands', async () => {
    nav.reset('/app/notes?q=money&group=life_areas');
    renderBoth();
    await screen.findByText('Money is tight this month.');
    nav.held.on = true;

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    // Longer than the search's pause, with Clear's push still in flight.
    await new Promise((resolve) => setTimeout(resolve, 400));
    await act(async () => nav.settle());

    expect(nav.current()).toBe('/app/notes');
    expect(nav.state.entries).toEqual(['/app/notes?q=money&group=life_areas', '/app/notes']);
    expect((search() as HTMLInputElement).value).toBe('');
  });

  it('keeps typing that follows a group pick still in flight, and keeps the pick', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');
    nav.held.on = true;

    await userEvent.type(search(), 'mon');
    await userEvent.selectOptions(groupPicker(), 'life_areas');
    await userEvent.type(search(), 'ey');
    await new Promise((resolve) => setTimeout(resolve, 400));
    await act(async () => nav.settle());

    // The pick's own echo ("mon") is not a Back: the box keeps "money".
    expect((search() as HTMLInputElement).value).toBe('money');
    expect(nav.current()).toBe('/app/notes?q=money&group=life_areas');
  });

  it('does not leave the page dimmed and busy after a read fails', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');
    world.failNextReads = 1;

    await userEvent.selectOptions(groupPicker(), 'the_person');

    expect(await screen.findByText(/as it stood a moment ago/)).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('does not take focus from the search box when a folded note comes back', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');

    // Fold one note, so it is the note that last took focus.
    const card = screen.getByText('Money is tight this month.').closest('section') as HTMLElement;
    await userEvent.click(within(card).getAllByRole('button', { name: /fold this note/i })[0]);

    // Narrow it away, then widen so it comes back — typing throughout.
    await userEvent.type(search(), 'brother');
    await waitFor(() => expect(readings()).toHaveLength(1));
    await userEvent.clear(search());
    await waitFor(() => expect(readings()).toHaveLength(4));

    expect(document.activeElement).toBe(search());
  });

  it('draws the page in the order it was answered in while a new sort is out', async () => {
    // The defect: the URL moved to `grouped` while the notes on screen were
    // still the `recent` answer, and grouping that list split each heading
    // into several runs — the same heading drawn twice, and duplicate keys.
    nav.reset('/app/notes?sort=recent');
    renderBoth();
    await screen.findByText('Money is tight this month.');

    world.hold = [];
    await userEvent.selectOptions(sortPicker(), 'grouped');
    await waitFor(() => expect(world.hold).toHaveLength(1));

    // Still the recent answer, so still drawn as one list with no headings.
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);

    const [pending] = world.hold;
    await act(async () => pending(record()));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Life areas', 'The person', 'Lelañea’s own headings']);
  });

  it('labels each note with its heading when sorted by recency, freshest first', async () => {
    nav.reset('/app/notes?sort=recent');
    renderBoth();
    await screen.findByText('Money is tight this month.');

    expect(readings()).toEqual([
      'Has not spoken to his brother since the summer.',
      'Money is tight this month.',
      'Quick to laugh, slow to decide.',
      'Work is going badly and they are thinking about leaving.',
    ]);
    // No group sections: the heading rides on each card instead.
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    expect(screen.getByText('Lelañea’s own headings · family communication')).toBeTruthy();
    expect(screen.getByText('The person · the person disposition')).toBeTruthy();
  });

  it('says nothing matched — not that nothing is held — and clears back to everything', async () => {
    renderBoth();
    await screen.findByText('Money is tight this month.');

    await userEvent.type(search(), 'zebra');

    expect(await screen.findByText(/Nothing in Lelañea’s notes matches that/)).toBeTruthy();
    expect(screen.queryByText(/Lelañea has written nothing down yet/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /clear the search/i }));

    await waitFor(() => expect(readings()).toHaveLength(4));
    expect((search() as HTMLInputElement).value).toBe('');
    expect(nav.current()).toBe('/app/notes');
  });

  it('re-reads with the filters on when a turn writes', async () => {
    nav.reset('/app/notes?group=the_person');
    renderBoth();
    await screen.findByText('Quick to laugh, slow to decide.');

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

    await waitFor(() => expect(world.notesReads).toBe(2));
    expect(world.notesUrls).toEqual([
      '/api/v1/app/notes?group=the_person',
      '/api/v1/app/notes?group=the_person',
    ]);
  });
});
