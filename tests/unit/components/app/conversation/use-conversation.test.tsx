// @vitest-environment happy-dom

/**
 * The conversation's state, frame by frame — the paths the pane test does
 * not reach by typing: what rides on the live turn, how a turn folds into an
 * entry, a refusal, a dropped stream, and the busy guard (§10 t-64); and when
 * she can't answer, that the words go back and the second try is the same
 * turn — the id asserted sent, then asserted equal (t-65).
 *
 * @see components/app/conversation/use-conversation.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversation } from '@/components/app/conversation/use-conversation';

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    response: new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    push: (type: string, data: unknown = {}) => controller.enqueue(encoder.encode(sse(type, data))),
    close: () => controller.close(),
  };
}

const emptyTranscript = () =>
  new Response(
    JSON.stringify({
      success: true,
      data: { seat: 'facilitator', conversationId: null, entries: [] },
    }),
    { status: 200 }
  );

const statusResponse = (generation: string) =>
  new Response(JSON.stringify({ success: true, data: { generation } }), { status: 200 });

const turns: ReturnType<typeof openTurn>[] = [];
/** The `turnId` each turn request carried, in order. */
const sentIds: string[] = [];
let refuse: Response | null = null;
let generation = 'available';
let statusReads = 0;
let statusDown = false;
let voiceInput = 'off';
let voiceDown = false;

const fetchImpl = vi.fn(
  async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (href.startsWith('/api/v1/app/conversation')) return emptyTranscript();
    if (href.startsWith('/api/v1/app/agent/status')) {
      statusReads += 1;
      return statusDown ? new Response('', { status: 500 }) : statusResponse(generation);
    }
    if (href.startsWith('/api/v1/app/agent/transcribe')) {
      if (voiceDown) return new Response('', { status: 500 });
      return new Response(JSON.stringify({ success: true, data: { voiceInput } }), { status: 200 });
    }
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    if (body && typeof body === 'object' && 'turnId' in body) sentIds.push(String(body.turnId));
    if (refuse) return refuse;
    const turn = openTurn();
    turns.push(turn);
    return turn.response;
  }
) as unknown as typeof fetch;

const latest = () => turns[turns.length - 1];

const refusal = (status: number, reason: string) =>
  new Response(
    JSON.stringify({
      success: false,
      error: { code: 'CONFLICT', message: 'x', details: { reason } },
    }),
    { status, headers: { 'content-type': 'application/json' } }
  );

async function loaded() {
  const hook = renderHook(() => useConversation({ fetchImpl }));
  await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
  return hook;
}

beforeEach(() => {
  turns.length = 0;
  sentIds.length = 0;
  refuse = null;
  generation = 'available';
  statusReads = 0;
  statusDown = false;
  voiceInput = 'off';
  voiceDown = false;
  vi.mocked(fetchImpl).mockClear();
});

/** A turn that the server started and then could not answer. */
async function failTurn(code: string) {
  await act(async () => {
    latest().push('start', { conversationId: 'c1' });
    latest().push('error', { code, message: `frame words for ${code}` });
    latest().close();
  });
}

describe('useConversation', () => {
  it('carries what the turn called and what it cited onto the finished reply', async () => {
    const { result } = await loaded();
    act(() => result.current.send('what does she say about boundaries?'));

    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      latest().push('status', { message: 'Executing search_knowledge_base' });
      latest().push('capability_result', {
        capabilitySlug: 'search_knowledge_base',
        result: { success: true, data: {} },
      });
      // A call the platform refused is a frame too, and not something the turn did.
      latest().push('capability_result', {
        capabilitySlug: 'delete_everything',
        result: { success: false, error: { code: 'tool_not_advertised' } },
      });
      latest().push('capability_results', {
        results: [
          { capabilitySlug: 'get_state', result: { success: true } },
          { capabilitySlug: 'get_state', result: { success: false } },
        ],
      });
    });
    await waitFor(() =>
      expect(result.current.live?.capabilities).toEqual(['search_knowledge_base', 'get_state'])
    );

    await act(async () => {
      latest().push('content', { delta: 'She says ' });
      latest().push('content_reset', { reason: 'request_fault' });
      latest().push('content', { delta: 'Boundaries are…' });
      latest().push('citations', { citations: [] });
      latest().push('done', {
        tokenUsage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
        costUsd: 0.00063,
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
      });
      latest().close();
    });

    await waitFor(() => expect(result.current.phase).toBe('idle'));
    const reply = result.current.entries[1];
    expect(reply).toMatchObject({
      kind: 'reply',
      streamed: true,
      // The reset threw away the first pass.
      text: 'Boundaries are…',
      citations: [],
      capabilities: ['search_knowledge_base', 'get_state'],
      turn: {
        status: 'completed',
        modelId: 'gpt-4o-mini-2024-07-18',
        providerSlug: 'openai',
        inputTokens: 120,
        outputTokens: 40,
        costUsd: 0.00063,
        // Not on the wire; the read route has them on reload.
        fingerprintVersion: null,
        pricing: null,
      },
    });
    expect(result.current.live).toBeNull();
  });

  it('keeps a soft crisis resource on the live turn and the finished reply', async () => {
    const resource = {
      tier: 'soft',
      region: null,
      intro: 'If things feel heavy',
      services: [],
      emergency: 'Call your local emergency number.',
      keptMessage: null,
      status: 'draft',
      version: '1',
    };
    const { result } = await loaded();
    act(() => result.current.send('a hard week'));
    await act(async () => {
      latest().push('warning', { code: 'crisis', message: 'text', resource });
      latest().push('start', { conversationId: 'c1' });
    });
    await waitFor(() => expect(result.current.live?.resource?.tier).toBe('soft'));
    await act(async () => {
      latest().push('content', { delta: 'I am here.' });
      latest().push('done', {});
      latest().close();
    });
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.entries[1]).toMatchObject({
      kind: 'reply',
      resource: { tier: 'soft' },
      crisisText: 'text',
    });
  });

  it('keeps a soft crisis frame\u2019s words even when its resource does not parse', async () => {
    // `message` is the whole resource as text (safety.md); a shape mismatch
    // in `resource` must never cost the person the names and numbers.
    const { result } = await loaded();
    act(() => result.current.send('a hard week'));
    await act(async () => {
      latest().push('warning', {
        code: 'crisis',
        message: 'Samaritans 116 123',
        resource: { tier: 'nonsense' },
      });
      latest().push('start', { conversationId: 'c1' });
    });
    await waitFor(() => expect(result.current.live?.crisisText).toBe('Samaritans 116 123'));
    expect(result.current.live?.resource).toBeUndefined();
  });

  it('never records a $0 reply cost from the frame — unknown until the row says', async () => {
    const { result } = await loaded();
    act(() => result.current.send('again'));
    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      latest().push('content', { delta: 'replayed' });
      // What a replay's `done` says for an unpriced turn.
      latest().push('done', { costUsd: 0 });
      latest().close();
    });
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.entries[1]).toMatchObject({ kind: 'reply', turn: { costUsd: null } });
  });

  it('turns a refusal into an ending carrying the route’s reason, before any frame', async () => {
    refuse = refusal(409, 'TURN_IN_FLIGHT');
    const { result } = await loaded();
    act(() => result.current.send('again'));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.entries).toEqual([
      expect.objectContaining({ kind: 'ending', code: 'TURN_IN_FLIGHT' }),
    ]);
    // The words were never cleared — no `start` came — and are still there.
    expect(result.current.draft).toBe('again');
  });

  it('treats a stream that closes with no terminal frame as unavailable', async () => {
    const { result } = await loaded();
    act(() => result.current.send('hello'));
    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      latest().push('content', { delta: 'Hel' });
      latest().close();
    });
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.entries).toEqual([
      expect.objectContaining({ kind: 'ending', code: 'unavailable' }),
    ]);
    // And the words are back in the box — not in the transcript as well.
    expect(result.current.draft).toBe('hello');
  });

  it('sends one turn at a time, and nothing empty', async () => {
    const { result } = await loaded();
    act(() => result.current.send('   '));
    expect(turns).toHaveLength(0);

    act(() => result.current.send('first'));
    act(() => result.current.send('second'));
    await waitFor(() => expect(turns).toHaveLength(1));
    expect(result.current.live?.userText).toBe('first');
  });

  describe('when she can\u2019t answer (t-65)', () => {
    /** The ending, then the same words sent again: one id across both requests. */
    async function endThenRetry(code: string) {
      const { result } = await loaded();
      act(() => result.current.send('a hard week'));
      await waitFor(() => expect(sentIds).toHaveLength(1));
      const first = sentIds[0];
      expect(first).toMatch(/^[0-9a-f-]{36}$/);
      await failTurn(code);
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      return { result, first };
    }

    it.each(['unavailable', 'timed_out', 'paused'])(
      'on %s the words are back in the box, and sending them again is the same turn',
      async (code) => {
        const { result, first } = await endThenRetry(code);
        // The frame's own words are on the entry; the row swaps them for hers.
        expect(result.current.entries).toEqual([
          expect.objectContaining({ kind: 'ending', code, message: `frame words for ${code}` }),
        ]);
        expect(result.current.draft).toBe('a hard week');

        act(() => result.current.send());
        await waitFor(() => expect(sentIds).toHaveLength(2));
        expect(sentIds[1]).toBe(first);
        // The retry supersedes the earlier attempt's row.
        expect(result.current.entries).toEqual([]);
        expect(result.current.live?.turnId).toBe(first);
      }
    );

    it('on not_sent the words are back in the box, and nothing offers the same id again', async () => {
      const { result, first } = await endThenRetry('not_sent');
      expect(result.current.entries).toEqual([
        expect.objectContaining({ kind: 'ending', code: 'not_sent' }),
      ]);
      expect(result.current.draft).toBe('a hard week');

      // Sent again as they are, the words are a new turn: the refused id is
      // not kept, so nothing about this client can retry the refusal.
      act(() => result.current.send());
      await waitFor(() => expect(sentIds).toHaveLength(2));
      expect(sentIds[1]).not.toBe(first);
    });

    it('different words are a different turn — a new id, never TURN_ID_REUSED', async () => {
      const { result, first } = await endThenRetry('unavailable');
      act(() => result.current.send('a hard week, and a long one'));
      await waitFor(() => expect(sentIds).toHaveLength(2));
      expect(sentIds[1]).not.toBe(first);
    });

    it('on TURN_IN_FLIGHT no new id is minted: the next send is the same id', async () => {
      const { result, first } = await endThenRetry('unavailable');
      refuse = refusal(409, 'TURN_IN_FLIGHT');
      act(() => result.current.send());
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(sentIds).toEqual([first, first]);
      expect(result.current.entries).toEqual([
        expect.objectContaining({ kind: 'ending', code: 'TURN_IN_FLIGHT' }),
      ]);
      expect(result.current.draft).toBe('a hard week');

      // Once the earlier request has finished, the same id gets the reply.
      refuse = null;
      act(() => result.current.send());
      await waitFor(() => expect(sentIds).toHaveLength(3));
      expect(sentIds[2]).toBe(first);
    });

    it('reads TURN_ID_REUSED as unavailable and drops the id', async () => {
      const { result, first } = await endThenRetry('unavailable');
      refuse = refusal(409, 'TURN_ID_REUSED');
      act(() => result.current.send());
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.entries).toEqual([
        expect.objectContaining({ kind: 'ending', code: 'unavailable' }),
      ]);
      refuse = null;
      act(() => result.current.send());
      await waitFor(() => expect(sentIds).toHaveLength(3));
      expect(sentIds[2]).not.toBe(first);
    });

    it('a network failure before any frame is the unavailable path, id kept', async () => {
      const { result } = await loaded();
      vi.mocked(fetchImpl).mockImplementationOnce(async () => {
        throw new TypeError('Failed to fetch');
      });
      act(() => result.current.send('hello'));
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.entries).toEqual([
        expect.objectContaining({ kind: 'ending', code: 'unavailable' }),
      ]);
      expect(result.current.draft).toBe('hello');
    });

    it('keeps a newer draft, and the failed words in the transcript instead', async () => {
      const { result } = await loaded();
      act(() => result.current.send('first'));
      await act(async () => latest().push('start', { conversationId: 'c1' }));
      await waitFor(() => expect(result.current.draft).toBe(''));
      act(() => result.current.setDraft('a new thought'));
      await failTurn('unavailable');
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.draft).toBe('a new thought');
      expect(result.current.entries).toEqual([
        expect.objectContaining({ kind: 'user', text: 'first' }),
        expect.objectContaining({ kind: 'ending', code: 'unavailable' }),
      ]);
    });

    it('a hard crisis frame ends the turn with the resource, the words still in the box', async () => {
      const resource = {
        tier: 'hard',
        region: 'GB',
        intro: 'It sounds like you might be in real danger right now.',
        services: [{ name: 'Samaritans', contact: 'Call 116 123', hours: 'Free, 24 hours a day' }],
        emergency: 'If you are in immediate danger, call 999.',
        keptMessage: 'What you wrote is still in the box.',
        status: 'draft',
        version: '0.1',
      };
      const { result } = await loaded();
      act(() => result.current.send('I want to end it'));
      await act(async () => {
        // No `start`: the crisis check comes before anything else.
        latest().push('error', { code: 'crisis', message: 'text', resource });
        latest().close();
      });
      await waitFor(() => expect(result.current.phase).toBe('idle'));
      expect(result.current.entries).toEqual([
        expect.objectContaining({ kind: 'ending', code: 'crisis', resource }),
      ]);
      expect(result.current.draft).toBe('I want to end it');
    });

    describe('the status read', () => {
      it('is asked on mount and after an ending, never on a timer', async () => {
        generation = 'paused';
        const { result } = await loaded();
        await waitFor(() => expect(result.current.status).toBe('paused'));
        expect(statusReads).toBe(1);

        act(() => result.current.send('hello'));
        await failTurn('paused');
        await waitFor(() => expect(statusReads).toBe(2));
        // Nothing polls: the hook owns no timer at all. (`waitFor` above uses
        // one itself, so this is read from the source rather than spied.)
        const source = readFileSync(
          path.join(process.cwd(), 'components/app/conversation/use-conversation.ts'),
          'utf8'
        );
        expect(source).not.toMatch(/setInterval|setTimeout/);
      });

      it('clears on an available read, and on a turn that completes', async () => {
        generation = 'unavailable';
        const { result } = await loaded();
        await waitFor(() => expect(result.current.status).toBe('unavailable'));

        generation = 'available';
        act(() => result.current.send('hello'));
        await failTurn('unavailable');
        await waitFor(() => expect(result.current.status).toBe('available'));

        generation = 'unavailable';
        const again = await loaded();
        await waitFor(() => expect(again.result.current.status).toBe('unavailable'));
        act(() => again.result.current.send('hello'));
        await act(async () => {
          latest().push('start', { conversationId: 'c1' });
          latest().push('content', { delta: 'Here.' });
          latest().push('done', {});
          latest().close();
        });
        await waitFor(() => expect(again.result.current.phase).toBe('idle'));
        expect(again.result.current.status).toBe('available');
      });

      it('is no news when it cannot be read', async () => {
        statusDown = true;
        const { result } = await loaded();
        await waitFor(() => expect(statusReads).toBe(1));
        expect(result.current.status).toBeNull();
      });
    });
  });

  it('asks once whether the microphone is offered, and reads no answer as not offered (t-67)', async () => {
    voiceInput = 'available';
    const { result } = await loaded();
    await waitFor(() => expect(result.current.voiceInput).toBe('available'));

    voiceDown = true;
    const again = renderHook(() => useConversation({ fetchImpl }));
    await waitFor(() => expect(again.result.current.phase).toBe('idle'));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetchImpl)
          .mock.calls.filter(([u]) => typeof u === 'string' && u.includes('transcribe'))
      ).toHaveLength(2)
    );
    expect(again.result.current.voiceInput).toBeNull();
  });

  it('marks the turn unreadable, not broken, when the transcript cannot be read', async () => {
    vi.mocked(fetchImpl).mockImplementationOnce(async () => new Response('', { status: 500 }));
    const { result } = renderHook(() => useConversation({ fetchImpl }));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.unreadable).toBe(true);
    expect(result.current.entries).toEqual([]);
  });

  it('aborts the request on unmount; the turn itself is the server’s to finish', async () => {
    const hook = await loaded();
    act(() => hook.result.current.send('hello'));
    await waitFor(() => expect(turns).toHaveLength(1));
    // The transcript read, the status read, the voice-input read, then the turn.
    const [, init] = vi.mocked(fetchImpl).mock.calls[3] as unknown as [string, RequestInit];
    hook.unmount();
    expect(init.signal?.aborted).toBe(true);
  });
});

/**
 * The signal the notes panel refreshes on (t-73).
 *
 * The panel re-reads the whole page, so the only thing that matters is that it
 * is told **once per turn that wrote**, and not told at all otherwise. Each
 * absence below is asserted on a turn that ran to `done` with frames in it, so
 * "was not called" cannot pass against a turn that never happened.
 */
describe('a turn that writes a note tells the panel, once', () => {
  const wrote = () =>
    latest().push('capability_result', {
      capabilitySlug: 'fill_slot',
      result: { success: true, data: { slotSlug: 'life_work', version: 1, minted: false } },
    });

  async function turnWith(push: () => void, onSlotsWritten: () => void) {
    const hook = renderHook(() => useConversation({ fetchImpl, onSlotsWritten }));
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.send('my work is going badly'));
    await waitFor(() => expect(turns).toHaveLength(1));
    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      push();
      latest().push('content', { delta: 'I have noted that.' });
      latest().push('done', {});
      latest().close();
    });
    return hook;
  }

  it('tells it exactly once when the turn captured', async () => {
    const onSlotsWritten = vi.fn();
    await turnWith(wrote, onSlotsWritten);
    expect(onSlotsWritten).toHaveBeenCalledTimes(1);
  });

  it('tells it once, not per note, when the turn captured several', async () => {
    const onSlotsWritten = vi.fn();
    await turnWith(() => {
      wrote();
      wrote();
      latest().push('capability_results', {
        results: [{ capabilitySlug: 'fill_slot', result: { success: true } }],
      });
    }, onSlotsWritten);
    expect(onSlotsWritten).toHaveBeenCalledTimes(1);
  });

  it('says nothing when the turn called nothing', async () => {
    const onSlotsWritten = vi.fn();
    const hook = await turnWith(() => {}, onSlotsWritten);
    // The turn ran and produced a reply — the population is not empty.
    expect(hook.result.current.entries.some((entry) => entry.kind === 'reply')).toBe(true);
    expect(onSlotsWritten).not.toHaveBeenCalled();
  });

  it('says nothing when the turn called something else', async () => {
    const onSlotsWritten = vi.fn();
    await turnWith(
      () =>
        latest().push('capability_result', {
          capabilitySlug: 'search_knowledge_base',
          result: { success: true, data: {} },
        }),
      onSlotsWritten
    );
    expect(onSlotsWritten).not.toHaveBeenCalled();
  });

  it('says nothing when the write was refused rather than made', async () => {
    const onSlotsWritten = vi.fn();
    await turnWith(
      () =>
        // The platform refusing a tool is a frame like any other, and nothing
        // was written — a refresh here would find nothing new and teach the
        // reader that the panel moves when it has not.
        latest().push('capability_result', {
          capabilitySlug: 'fill_slot',
          result: { success: false, error: { code: 'tool_not_advertised' } },
        }),
      onSlotsWritten
    );
    expect(onSlotsWritten).not.toHaveBeenCalled();
  });

  it('still tells it when the turn captured and then ended without her', async () => {
    const onSlotsWritten = vi.fn();
    const hook = renderHook(() => useConversation({ fetchImpl, onSlotsWritten }));
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.send('my work is going badly'));
    await waitFor(() => expect(turns).toHaveLength(1));

    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      wrote();
      latest().push('error', { code: 'unavailable', message: 'x' });
      latest().close();
    });

    // The note is in the profile whatever happened to the reply, and a panel
    // left stale until the next turn shows less than the app holds.
    expect(onSlotsWritten).toHaveBeenCalledTimes(1);
  });
});

/**
 * The signal the topbar's spend meter re-reads on (t-95).
 *
 * The meter calls the month-to-date aggregate `agent.md` flags as a watch item,
 * so the property is a count: **one per turn, however many frames it streamed,
 * and however it ended**. Every "once" below is asserted on a turn that pushed
 * several frames, so a per-frame call would read as a number above one rather
 * than passing for free.
 */
describe('every finished turn tells the spend meter, once', () => {
  it('tells it once for a reply, not once per streamed frame', async () => {
    const onTurnSettled = vi.fn();
    const hook = renderHook(() => useConversation({ fetchImpl, onTurnSettled }));
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.send('hello'));
    await waitFor(() => expect(turns).toHaveLength(1));

    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      for (const delta of ['One ', 'word ', 'at ', 'a ', 'time.']) {
        latest().push('content', { delta });
      }
      // Mid-stream, nothing has finished.
      expect(onTurnSettled).not.toHaveBeenCalled();
      latest().push('done', {});
      latest().close();
    });

    expect(hook.result.current.entries.some((entry) => entry.kind === 'reply')).toBe(true);
    expect(onTurnSettled).toHaveBeenCalledTimes(1);
  });

  it('tells it once when the turn ended without her', async () => {
    // An ending can still have cost something — the model ran before it failed.
    const onTurnSettled = vi.fn();
    const hook = renderHook(() => useConversation({ fetchImpl, onTurnSettled }));
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.send('hello'));
    await waitFor(() => expect(turns).toHaveLength(1));

    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      latest().push('content', { delta: 'Half an ans' });
      latest().push('error', { code: 'unavailable', message: 'x' });
      latest().close();
    });

    expect(hook.result.current.entries.some((entry) => entry.kind === 'ending')).toBe(true);
    expect(onTurnSettled).toHaveBeenCalledTimes(1);
  });

  it('says nothing for a turn abandoned by unmounting', async () => {
    const onTurnSettled = vi.fn();
    const hook = renderHook(() => useConversation({ fetchImpl, onTurnSettled }));
    await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
    act(() => hook.result.current.send('hello'));
    await waitFor(() => expect(turns).toHaveLength(1));

    hook.unmount();
    expect(onTurnSettled).not.toHaveBeenCalled();
  });
});
