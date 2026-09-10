/**
 * POST /api/v1/app/waitlist — the leaf's first unauthenticated write route.
 *
 * The done-when cases: 201 on a first join, 200 on a repeat, 400 on a bad
 * email, 429 past the sub-cap, honeypot swallowed with a 200 and no row. Plus
 * the two that would not be noticed by looking at the page — that the response
 * body cannot be used to ask whether an address is already on the list, and
 * that the address never reaches the application log.
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
  joinWaitlistMock.mockResolvedValue({ created: true, entryId: 'entry-1' });
});

describe('POST /api/v1/app/waitlist', () => {
  it('answers 201 on a first join and records the answers', async () => {
    const response = await POST(
      request({
        email: 'Ada@Example.com',
        name: 'Ada',
        heardFrom: 'a friend',
        intent: 'to slow down',
      })
    );

    expect(response.status).toBe(201);
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

  it('answers 200 when the entry already existed', async () => {
    joinWaitlistMock.mockResolvedValue({ created: false, entryId: 'entry-1' });

    const response = await POST(request({ email: 'ada@example.com' }));

    expect(response.status).toBe(200);
  });

  it('says exactly the same thing whether it created or updated', async () => {
    const first = await POST(request({ email: 'ada@example.com' }));
    joinWaitlistMock.mockResolvedValue({ created: false, entryId: 'entry-1' });
    const repeat = await POST(request({ email: 'ada@example.com' }));

    // A different message for "already on the list" turns this endpoint into an
    // oracle: anyone could ask it whether a given address had signed up.
    const [a, b] = await Promise.all([first.json(), repeat.json()]);
    expect(a).toEqual(b);
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

  it('swallows a filled honeypot: 200, and no row', async () => {
    const response = await POST(
      request({ email: 'bot@example.com', website: 'http://spam.example' })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { message: ACCEPTED } });
    // The whole value of a honeypot is that the bot cannot tell it was caught.
    expect(joinWaitlistMock).not.toHaveBeenCalled();
  });

  it('does not name the honeypot field when it fails validation', async () => {
    // A non-string `website` fails the schema before the handler's own check,
    // and the default 400 would carry `path: "website"` — telling the bot
    // exactly which input to leave alone next time.
    const response = await POST(request({ email: 'bot@example.com', website: 12345 }));

    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('website');
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
