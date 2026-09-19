// @vitest-environment happy-dom

/**
 * The conversation's state, frame by frame — the paths the pane test does
 * not reach by typing: what rides on the live turn, how a turn folds into an
 * entry, a refusal, a dropped stream, and the busy guard (§10 t-64).
 *
 * @see components/app/conversation/use-conversation.ts
 */

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

const turns: ReturnType<typeof openTurn>[] = [];
let refuse: Response | null = null;

const fetchImpl = vi.fn(async (url: string | URL | Request): Promise<Response> => {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  if (href.startsWith('/api/v1/app/conversation')) return emptyTranscript();
  if (refuse) return refuse;
  const turn = openTurn();
  turns.push(turn);
  return turn.response;
}) as unknown as typeof fetch;

const latest = () => turns[turns.length - 1];

async function loaded() {
  const hook = renderHook(() => useConversation({ fetchImpl }));
  await waitFor(() => expect(hook.result.current.phase).toBe('idle'));
  return hook;
}

beforeEach(() => {
  turns.length = 0;
  refuse = null;
  vi.mocked(fetchImpl).mockClear();
});

describe('useConversation', () => {
  it('carries what the turn called and what it cited onto the finished reply', async () => {
    const { result } = await loaded();
    act(() => result.current.send('what does she say about boundaries?'));

    await act(async () => {
      latest().push('start', { conversationId: 'c1' });
      latest().push('status', { message: 'Executing search_knowledge_base' });
      latest().push('capability_result', { capabilitySlug: 'search_knowledge_base', result: 1 });
      latest().push('capability_results', {
        results: [{ capabilitySlug: 'get_state', result: 1 }],
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
    refuse = new Response(
      JSON.stringify({
        success: false,
        error: { code: 'CONFLICT', message: 'x', details: { reason: 'TURN_IN_FLIGHT' } },
      }),
      { status: 409, headers: { 'content-type': 'application/json' } }
    );
    const { result } = await loaded();
    act(() => result.current.send('again'));
    await waitFor(() => expect(result.current.phase).toBe('idle'));
    expect(result.current.entries[1]).toMatchObject({ kind: 'ending', code: 'TURN_IN_FLIGHT' });
    // The words were never cleared — no `start` came — and are still there.
    expect(result.current.entries[0]).toMatchObject({ kind: 'user', text: 'again' });
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
    expect(result.current.entries[1]).toMatchObject({ kind: 'ending', code: 'unavailable' });
    // And the words are back in the box.
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
    const [, init] = vi.mocked(fetchImpl).mock.calls[1] as unknown as [string, RequestInit];
    hook.unmount();
    expect(init.signal?.aborted).toBe(true);
  });
});
