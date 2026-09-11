/**
 * POST /api/v1/app/waitlist — the leaf's first unauthenticated write route.
 *
 * The done-when cases: a join accepted, a repeat accepted, 400 on a bad email,
 * 429 past the sub-cap, honeypot swallowed with no row. Plus the ones nobody
 * would notice by looking at the page — that NOTHING in the response tells a
 * caller whether the address was already listed or which field is the trap, and
 * that the address never reaches the application log.
 *
 * The task specified 201-on-first / 200-on-repeat and the owner collapsed it to
 * a single 200 on 10 September 2026: the split was a membership oracle and the
 * form treated both codes identically. The cases below hold the collapse, and
 * hold it on the headers as well as the status — an earlier version leaked the
 * honeypot through header presence alone.
 *
 * @see app/api/v1/app/waitlist/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

const { joinWaitlistMock, checkMock, routeLog } = vi.hoisted(() => ({
  joinWaitlistMock: vi.fn(),
  checkMock: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/app/waitlist/service', () => ({ joinWaitlist: joinWaitlistMock }));
vi.mock('@/lib/app/waitlist/rate-limit', () => ({ waitlistLimiter: { check: checkMock } }));
vi.mock('@/lib/security/ip', () => ({ getClientIP: () => '203.0.113.7' }));
// `tests/setup.ts` mocks `getRouteLogger` globally; this narrows it so the
// no-PII-in-logs case can read what was actually logged.
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));

import { POST } from '@/app/api/v1/app/waitlist/route';

/** The one sentence every accepted request answers with. */
const ACCEPTED = 'You are on the list. We will write to you when a place opens.';

function request(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new Request('https://lelanea.com/api/v1/app/waitlist', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

const ALLOWED = { success: true, limit: 5, remaining: 4, reset: 1_800_000_000 };

beforeEach(() => {
  vi.clearAllMocks();
  checkMock.mockReturnValue(ALLOWED);
  joinWaitlistMock.mockResolvedValue({ created: true, removed: false, entryId: 'entry-1' });
});

describe('POST /api/v1/app/waitlist', () => {
  it('accepts a first join and records the answers', async () => {
    const response = await POST(
      request({
        email: 'Ada@Example.com',
        name: 'Ada',
        heardFrom: 'a friend',
        intent: 'to slow down',
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { message: ACCEPTED },
    });
    expect(joinWaitlistMock).toHaveBeenCalledWith(
      expect.objectContaining({
        // Lower-cased by the schema, which is what makes the table's unique
        // index mean one person rather than one spelling.
        email: 'ada@example.com',
        name: 'Ada',
        heardFrom: 'a friend',
        intent: 'to slow down',
      })
    );
  });

  it('is INDISTINGUISHABLE between a first join and a repeat', async () => {
    const first = await POST(request({ email: 'ada@example.com' }));
    joinWaitlistMock.mockResolvedValue({ created: false, removed: false, entryId: 'entry-1' });
    const repeat = await POST(request({ email: 'ada@example.com' }));

    // The whole finding, in one case. Anything that differs here — the status,
    // the body, or a header — lets anyone post an address and read back whether
    // that person is on a pre-launch waitlist.
    expect(repeat.status).toBe(first.status);
    expect(repeat.status).toBe(200);
    const [a, b] = await Promise.all([first.json(), repeat.json()]);
    expect(a).toEqual(b);
    expect([...repeat.headers.keys()].sort()).toEqual([...first.headers.keys()].sort());
  });

  it('logs a re-join against a REMOVED entry as what it is, not as an update', async () => {
    joinWaitlistMock.mockResolvedValue({ created: false, removed: true, entryId: 'entry-1' });

    const response = await POST(request({ email: 'ada@example.com', intent: 'put me back' }));

    expect(response.status).toBe(200);
    // D9: a submission against a removed entry writes no answers at all — only the
    // record of the attempt. The first version logged it as "Waitlist entry updated"
    // with `answered: { intent: true }`, which said an answer had been recorded when
    // none had: the one operational record of a re-join attempt, reporting the
    // opposite of what happened. Found by the code review of §03 t-24.
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist re-join attempt recorded on a removed entry',
      { entryId: 'entry-1' }
    );
    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(logged).not.toContain('answered');
    expect(logged).not.toContain('Waitlist entry updated');
    // And still no address, as everywhere else on this route.
    expect(logged).not.toContain('ada@example.com');
  });

  it('is INDISTINGUISHABLE from an ordinary join when the entry was removed', async () => {
    const ordinary = await POST(request({ email: 'ada@example.com' }));
    joinWaitlistMock.mockResolvedValue({ created: false, removed: true, entryId: 'entry-1' });
    const againstRemoved = await POST(request({ email: 'ada@example.com' }));

    // The membership oracle this route was hardened against has a second question
    // now — "and did that person ask to be taken off?" — which must be no more
    // answerable than the first.
    expect(againstRemoved.status).toBe(ordinary.status);
    const [a, b] = await Promise.all([ordinary.json(), againstRemoved.json()]);
    expect(a).toEqual(b);
    expect([...againstRemoved.headers.keys()].sort()).toEqual([...ordinary.headers.keys()].sort());
  });

  it('does not leak `created` into the response body', async () => {
    const response = await POST(request({ email: 'ada@example.com' }));

    // It is logged, deliberately, and must not travel back out. A `created`
    // field would restore the oracle the status collapse just closed.
    expect(await response.text()).not.toContain('created');
  });

  it('sends the visitor’s language through as the locale', async () => {
    await POST(request({ email: 'ada@example.com' }, { 'accept-language': 'pt-BR,pt;q=0.9' }));

    expect(joinWaitlistMock).toHaveBeenCalledWith(expect.objectContaining({ locale: 'pt-BR' }));
  });

  it('answers 400 on an email that is not one, and writes nothing', async () => {
    const response = await POST(request({ email: 'not-an-email' }));

    expect(response.status).toBe(400);
    expect(joinWaitlistMock).not.toHaveBeenCalled();
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 400 on a missing email', async () => {
    const response = await POST(request({ name: 'Ada' }));

    expect(response.status).toBe(400);
    expect(joinWaitlistMock).not.toHaveBeenCalled();
  });

  it('answers 429 past the per-IP sub-cap, before reading the body', async () => {
    checkMock.mockReturnValue({ success: false, limit: 5, remaining: 0, reset: 1_800_000_000 });

    const response = await POST(request({ email: 'ada@example.com' }));

    expect(response.status).toBe(429);
    expect(joinWaitlistMock).not.toHaveBeenCalled();
    expect(response.headers.get('Retry-After')).not.toBeNull();
  });

  it('keys the sub-cap on the client IP', async () => {
    await POST(request({ email: 'ada@example.com' }));

    expect(checkMock).toHaveBeenCalledWith('203.0.113.7');
  });

  it('swallows a filled honeypot, and writes no row', async () => {
    const response = await POST(
      request({ email: 'bot@example.com', website: 'http://spam.example' })
    );

    await expect(response.json()).resolves.toMatchObject({ data: { message: ACCEPTED } });
    // The whole value of a honeypot is that the bot cannot tell it was caught.
    expect(joinWaitlistMock).not.toHaveBeenCalled();
  });

  it('answers a honeypot with the SAME status, body AND headers as a real join', async () => {
    const trapped = await POST(
      request({ email: 'bot@example.com', website: 'http://spam.example' })
    );
    const genuine = await POST(request({ email: 'someone@example.com' }));

    // The headers half is not decoration. An earlier version answered the
    // honeypot from a `catch` block that could not see the rate-limit headers,
    // so only the genuine response carried `X-RateLimit-Remaining` — and header
    // PRESENCE is a perfectly reliable oracle for which field is the trap, which
    // is the one thing a honeypot must never reveal.
    expect(trapped.status).toBe(genuine.status);
    expect(await trapped.text()).toBe(await genuine.text());
    expect([...trapped.headers.keys()].sort()).toEqual([...genuine.headers.keys()].sort());
    expect(trapped.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('never names the honeypot field in a response', async () => {
    const trapped = await POST(
      request({ email: 'bot@example.com', website: 'http://spam.example' })
    );
    const badEmail = await POST(request({ email: 'nope', website: 'http://spam.example' }));

    // The 400 for a bad email must not carry `path: "website"` either — that
    // would tell the bot exactly which input to leave alone.
    expect(await trapped.text()).not.toContain('website');
    expect(await badEmail.text()).not.toContain('website');
  });

  it('treats a non-string honeypot as filled — the real form cannot send one', async () => {
    const response = await POST(request({ email: 'bot@example.com', website: 12345 }));

    expect(response.status).toBe(200);
    expect(joinWaitlistMock).not.toHaveBeenCalled();
  });

  it.each([
    ['an explicit null from a hand-rolled client', null],
    ['the empty string the real form sends', ''],
    ['whitespace', '   '],
    ['an absent field', undefined],
  ])('JOINS a real person whose honeypot is %s', async (_why, website) => {
    // The finding this case exists for. `website` used to be
    // `z.string().max(0)`, so `null` failed validation as "expected string",
    // matched the honeypot branch BY FIELD NAME, and returned "You are on the
    // list" having written nothing. A person believing they joined when no row
    // exists is exactly what t-5 shipped the card inert to prevent.
    const response = await POST(request({ email: 'ada@example.com', website }));

    expect(response.status).toBe(200);
    expect(joinWaitlistMock).toHaveBeenCalledTimes(1);
  });

  it('still rejects a bad email when the honeypot is empty', async () => {
    // The swallow must not have widened into "any validation error is a bot".
    const response = await POST(request({ email: 'nope', website: '' }));

    expect(response.status).toBe(400);
    expect(joinWaitlistMock).not.toHaveBeenCalled();
  });

  it('never puts the email address in the log line', async () => {
    await POST(request({ email: 'ada@example.com', name: 'Ada', intent: 'to slow down' }));

    // This is the one route an unauthenticated stranger can write to. An address
    // in an application log is a copy of their personal data outside the table
    // the export and erasure paths know about.
    const logged = JSON.stringify(routeLog.info.mock.calls);
    expect(logged).not.toContain('ada@example.com');
    expect(logged).not.toContain('to slow down');
    // What IS logged: whether each optional question was answered.
    expect(routeLog.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        created: true,
        answered: { name: true, heardFrom: false, intent: true },
      })
    );
  });

  it('carries the rate-limit headers on a success', async () => {
    const response = await POST(request({ email: 'ada@example.com' }));

    expect(response.headers.get('X-RateLimit-Limit')).toBe('5');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('4');
  });

  it('answers 500 in the standard envelope when the write throws', async () => {
    joinWaitlistMock.mockRejectedValue(new Error('connection terminated'));

    const response = await POST(request({ email: 'ada@example.com' }));

    expect(response.status).toBe(500);
    const body = (await response.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    // Redacting the message is `handleAPIError`'s job and is gated on
    // `NODE_ENV === 'production'`, which this harness is not — asserting it here
    // would be asserting the platform's behaviour through our route. What this
    // case holds is that the failure is not mistaken for a honeypot and quietly
    // answered 200, which is the shape the catch block above it makes possible.
  });
});
