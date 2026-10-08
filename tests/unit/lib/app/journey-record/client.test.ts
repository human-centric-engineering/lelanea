/**
 * The journey record's fetch wrappers, as the timeline calls them (t-148).
 *
 * Each wrapper is thin — a path, a method, a body — so what is worth proving
 * is the shape it sends, that a non-OK response becomes a {@link JourneyRefused}
 * carrying a message a person can read, and that the refusal's words are the
 * route's own except for the handful this file rewords.
 *
 * @see lib/app/journey-record/client.ts
 */

import { describe, expect, it, vi } from 'vitest';

import {
  JOURNEY_RECORD_ENDPOINT,
  JOURNEY_RECORD_EXPORT,
  JourneyRefused,
  changeOwnEntry,
  fetchCurrentSession,
  keepSynopsis,
  regenerateSynopsis,
  removeEntry,
  writeOwnEntry,
} from '@/lib/app/journey-record/client';

function ok(): Response {
  return new Response(null, { status: 200 });
}

/** A `fetch` stub typed with `fetch`'s own signature, so `mock.calls` is a typed tuple. */
function fetchSpy(respond: () => Response = ok) {
  return vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => respond());
}

function errorEnvelope(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message, details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('JOURNEY_RECORD_EXPORT', () => {
  it('sits under the record endpoint', () => {
    expect(JOURNEY_RECORD_EXPORT).toBe(`${JOURNEY_RECORD_ENDPOINT}/export`);
  });
});

describe('writeOwnEntry', () => {
  it('POSTs the words as JSON to the record endpoint, with credentials included', async () => {
    const fetchImpl = fetchSpy();
    await writeOwnEntry(
      { summary: 'A line', body: 'What happened.', withheldFromAgent: true },
      { fetchImpl }
    );

    expect(fetchImpl).toHaveBeenCalledWith(
      JOURNEY_RECORD_ENDPOINT,
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: 'A line',
          body: 'What happened.',
          withheldFromAgent: true,
        }),
      })
    );
  });
});

describe('changeOwnEntry', () => {
  it('PATCHes only the change given, with the id encoded into the path', async () => {
    const fetchImpl = fetchSpy();
    await changeOwnEntry('entry id/with slash', { withheldFromAgent: true }, { fetchImpl });

    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe(`${JOURNEY_RECORD_ENDPOINT}/entry%20id%2Fwith%20slash`);
    expect(init).toMatchObject({ method: 'PATCH' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ withheldFromAgent: true });
  });
});

describe('removeEntry', () => {
  it('DELETEs with no body at all, not an empty JSON object', async () => {
    const fetchImpl = fetchSpy();
    await removeEntry('cmentry1', { fetchImpl });

    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe(`${JOURNEY_RECORD_ENDPOINT}/cmentry1`);
    expect(init).toMatchObject({ method: 'DELETE', body: undefined });
    // No body means no content-type header either — nothing was serialised.
    expect((init as RequestInit).headers).toBeUndefined();
  });
});

describe('keepSynopsis', () => {
  it('POSTs seen, confirm, and the edit when there is one, to the keep sub-route', async () => {
    const fetchImpl = fetchSpy();
    await keepSynopsis(
      'cmentry1',
      {
        seen: '2026-10-01T00:00:00.000Z',
        confirm: [{ slotSlug: 'life_work', version: 2 }],
        edit: { summary: 'New line', body: 'New body', outcomes: [] },
      },
      { fetchImpl }
    );

    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe(`${JOURNEY_RECORD_ENDPOINT}/cmentry1/keep`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      seen: '2026-10-01T00:00:00.000Z',
      confirm: [{ slotSlug: 'life_work', version: 2 }],
      edit: { summary: 'New line', body: 'New body', outcomes: [] },
    });
  });

  it('sends confirm without an edit when the person kept it as written', async () => {
    const fetchImpl = fetchSpy();
    await keepSynopsis(
      'cmentry1',
      { seen: '2026-10-01T00:00:00.000Z', confirm: [] },
      { fetchImpl }
    );

    const body = JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ seen: '2026-10-01T00:00:00.000Z', confirm: [] });
    expect('edit' in body).toBe(false);
  });
});

describe('regenerateSynopsis', () => {
  it('POSTs the steer text to the regenerate sub-route', async () => {
    const fetchImpl = fetchSpy();
    await regenerateSynopsis('cmentry1', 'Shorter, please.', { fetchImpl });

    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe(`${JOURNEY_RECORD_ENDPOINT}/cmentry1/regenerate`);
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      steer: 'Shorter, please.',
    });
  });
});

describe('a refusal', () => {
  it('throws JourneyRefused with the route’s own message when the reason is not reworded', async () => {
    const fetchImpl = fetchSpy(() =>
      errorEnvelope(400, 'VALIDATION_ERROR', 'That summary is too long.')
    );

    const call = writeOwnEntry({ summary: '', body: 'x', withheldFromAgent: false }, { fetchImpl });
    await expect(call).rejects.toBeInstanceOf(JourneyRefused);
    await expect(call).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'That summary is too long.',
    });
  });

  it('rewords changed_meanwhile into the friendly message, keyed off details.reason', async () => {
    const fetchImpl = fetchSpy(() =>
      errorEnvelope(409, 'CONFLICT', 'Conflict.', { reason: 'changed_meanwhile' })
    );

    await expect(removeEntry('cmentry1', { fetchImpl })).rejects.toMatchObject({
      code: 'changed_meanwhile',
      message: expect.stringContaining('now shows the latest version'),
    });
  });

  it('rewords every other known reason the same way', async () => {
    const fetchImpl = fetchSpy(() =>
      errorEnvelope(429, 'RATE_LIMITED', 'Too many.', { reason: 'ceiling_reached' })
    );

    await expect(regenerateSynopsis('cmentry1', '', { fetchImpl })).rejects.toMatchObject({
      code: 'ceiling_reached',
      message: expect.stringContaining('this month’s limit'),
    });
  });

  it('falls back to the http status code when the body is not JSON at all', async () => {
    const fetchImpl = fetchSpy(() => new Response('<html>Gateway Timeout</html>', { status: 504 }));

    await expect(removeEntry('cmentry1', { fetchImpl })).rejects.toMatchObject({
      status: 504,
      code: 'http_504',
      message: expect.stringContaining('Try again in a moment'),
    });
  });

  it('falls back to the envelope’s own code when details carries no reason', async () => {
    const fetchImpl = fetchSpy(() =>
      errorEnvelope(403, 'FORBIDDEN', 'Not allowed.', { somethingElse: true })
    );

    await expect(removeEntry('cmentry1', { fetchImpl })).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: 'Not allowed.',
    });
  });
});

describe('fetchCurrentSession', () => {
  const SESSION = `ses_${'a'.repeat(32)}`;

  function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  it('reads the current session with credentials and answers it', async () => {
    const fetchImpl = fetchSpy(() =>
      json({ success: true, data: { session: { id: SESSION, hasTurns: true } } })
    );

    await expect(fetchCurrentSession({ fetchImpl })).resolves.toEqual({
      id: SESSION,
      hasTurns: true,
    });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe('/api/v1/app/sessions/current');
    expect(init?.credentials).toBe('include');
    expect(init?.method).toBeUndefined();
  });

  it('answers null when the route has no session to offer', async () => {
    const fetchImpl = fetchSpy(() => json({ success: true, data: { session: null } }));

    await expect(fetchCurrentSession({ fetchImpl })).resolves.toBeNull();
  });

  it('throws on an answer it cannot read, rather than offering on a guess', async () => {
    const fetchImpl = fetchSpy(() =>
      json({ success: true, data: { session: { id: SESSION, hasTurns: 'yes' } } })
    );

    await expect(fetchCurrentSession({ fetchImpl })).rejects.toMatchObject({ code: 'malformed' });
  });

  it('throws the route’s refusal', async () => {
    const fetchImpl = fetchSpy(() => errorEnvelope(401, 'UNAUTHORIZED', 'Sign in first.'));

    await expect(fetchCurrentSession({ fetchImpl })).rejects.toMatchObject({
      status: 401,
      message: 'Sign in first.',
    });
  });
});
