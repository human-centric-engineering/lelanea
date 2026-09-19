/**
 * The browser's side of a turn: the request shape the seam expects, frames
 * out of a real byte stream, and a refusal told apart from a turn (§10 t-64).
 *
 * @see lib/app/conversation/client.ts
 */

import { describe, expect, it, vi } from 'vitest';

import {
  fetchGenerationStatus,
  fetchTranscript,
  STATUS_ROUTE,
  streamTurn,
  TurnRefused,
} from '@/lib/app/conversation/client';

function sse(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A response whose body arrives in the given chunks, as bytes. */
function streamed(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
    ...init,
  });
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe('streamTurn', () => {
  it('posts the seam’s shape — message and turn id — to the role route', async () => {
    const fetchImpl = vi.fn(async () => streamed([sse('done', {})]));

    await collect(
      streamTurn({ seat: 'facilitator', message: 'hello', turnId: 'turn-1', fetchImpl })
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/framework/facilitation/facilitator/chat/stream');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '{}')).toEqual({
      message: 'hello',
      turnId: 'turn-1',
    });
  });

  it('yields every frame in order, including one split across two chunks', async () => {
    const start = sse('start', { conversationId: 'c1' });
    const content = sse('content', { delta: 'Welcome, ' });
    const done = sse('done', { costUsd: 0.001 });
    // Split inside `content`'s JSON, and inside the `\n\n` separator.
    const split = content.length - 7;
    const fetchImpl = vi.fn(async () =>
      streamed([
        start + content.slice(0, split),
        content.slice(split) + done.slice(0, 5),
        done.slice(5),
      ])
    );

    const frames = await collect(
      streamTurn({ seat: 'facilitator', message: 'hi', turnId: 't', fetchImpl })
    );

    expect(frames.map((f) => f.type)).toEqual(['start', 'content', 'done']);
    expect(frames[1]).toEqual({ type: 'content', delta: 'Welcome, ' });
  });

  it('skips a frame it does not recognise rather than stopping', async () => {
    const fetchImpl = vi.fn(async () =>
      streamed([sse('start', { conversationId: 'c' }), sse('novelty', { x: 1 }), sse('done', {})])
    );
    const frames = await collect(
      streamTurn({ seat: 'facilitator', message: 'hi', turnId: 't', fetchImpl })
    );
    expect(frames.map((f) => f.type)).toEqual(['start', 'done']);
  });

  it('yields a final frame that arrived without its trailing separator', async () => {
    const fetchImpl = vi.fn(async () => streamed([sse('done', {}).trimEnd()]));
    const frames = await collect(
      streamTurn({ seat: 'facilitator', message: 'hi', turnId: 't', fetchImpl })
    );
    expect(frames.map((f) => f.type)).toEqual(['done']);
  });

  it('throws a refusal, with the envelope’s reason, before any frame', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: {
              code: 'CONFLICT',
              message: 'still running',
              details: { reason: 'TURN_IN_FLIGHT' },
            },
          }),
          { status: 409, headers: { 'content-type': 'application/json' } }
        )
    );

    const turn = streamTurn({ seat: 'facilitator', message: 'hi', turnId: 't', fetchImpl });
    await expect(turn.next()).rejects.toMatchObject({
      name: 'TurnRefused',
      status: 409,
      code: 'TURN_IN_FLIGHT',
    });
  });

  it('keeps the envelope\u2019s code when `details` is not a reason object', async () => {
    // A validation failure carries `{ errors: [...] }`; a shape without a
    // `reason` must cost the reason, never the code.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'bad', details: ['not', 'an', 'object'] },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } }
        )
    );
    const turn = streamTurn({ seat: 'facilitator', message: 'hi', turnId: 't', fetchImpl });
    await expect(turn.next()).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });

  it('falls back on the status when a refusal is not an envelope', async () => {
    const fetchImpl = vi.fn(async () => new Response('gateway', { status: 502 }));
    const turn = streamTurn({ seat: 'facilitator', message: 'hi', turnId: 't', fetchImpl });
    const error = await turn.next().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TurnRefused);
    expect((error as TurnRefused).code).toBe('http_502');
  });
});

describe('fetchTranscript', () => {
  const entry = {
    kind: 'reply',
    id: 'a1',
    text: 'hello',
    at: '2026-09-19T12:00:00.000Z',
    turnId: 't1',
    citations: [],
    turn: null,
  };

  it('asks for the seat and validates each entry on its own', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              seat: 'facilitator',
              conversationId: 'c1',
              entries: [entry, { kind: 'reply', id: 'broken' }],
            },
          }),
          { status: 200 }
        )
    );

    const transcript = await fetchTranscript('facilitator', { fetchImpl });

    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe('/api/v1/app/conversation?seat=facilitator');
    // One unreadable row drops that row, not the transcript.
    expect(transcript.entries).toHaveLength(1);
    expect(transcript.entries[0]).toMatchObject({ kind: 'reply', id: 'a1' });
    expect(transcript.conversationId).toBe('c1');
  });

  it('throws on a refusal', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    await expect(fetchTranscript('facilitator', { fetchImpl })).rejects.toBeInstanceOf(TurnRefused);
  });
});

describe('fetchGenerationStatus (t-65)', () => {
  const envelope = (generation: unknown) =>
    new Response(JSON.stringify({ success: true, data: { generation } }), { status: 200 });

  it('asks the status route and returns the one word', async () => {
    const fetchImpl = vi.fn(async () => envelope('paused'));
    await expect(fetchGenerationStatus({ fetchImpl })).resolves.toBe('paused');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe(STATUS_ROUTE);
  });

  it('throws on a word it does not know, and on a refusal', async () => {
    await expect(
      fetchGenerationStatus({ fetchImpl: vi.fn(async () => envelope('degraded')) })
    ).rejects.toBeInstanceOf(TurnRefused);
    await expect(
      fetchGenerationStatus({ fetchImpl: vi.fn(async () => new Response('', { status: 401 })) })
    ).rejects.toMatchObject({ status: 401 });
  });
});
