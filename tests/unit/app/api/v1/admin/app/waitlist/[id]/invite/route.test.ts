/**
 * POST /api/v1/admin/app/waitlist/:id/invite — inviting someone from the list.
 *
 * The done-when cases: an invitation created and the email sent on a live row,
 * `invitedAt` stamped, the resend path, 404 / 409 existing account / 409
 * removed / 409 joined / 400 no name / 429 — with `sendEmail` mocked, because a
 * test that sent one would be a test that wrote to a stranger. Plus the one
 * nobody would notice by looking at the screen: no address in any of the
 * route's own log lines.
 *
 * The platform's token helpers are mocked rather than run: what they write to
 * the verification table is theirs to test, and what matters here is that the
 * route calls the right one — regenerate when an invitation is pending,
 * generate when not — with `USER` and the resolved name.
 *
 * @see app/api/v1/admin/app/waitlist/[id]/invite/route.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const {
  findWaitlistEntryForInvite,
  stampWaitlistEntryInvited,
  userFindUnique,
  generateInvitationToken,
  updateInvitationToken,
  getValidInvitation,
  sendEmail,
  check,
  routeLog,
} = vi.hoisted(() => ({
  findWaitlistEntryForInvite: vi.fn(),
  stampWaitlistEntryInvited: vi.fn(),
  userFindUnique: vi.fn(),
  generateInvitationToken: vi.fn(),
  updateInvitationToken: vi.fn(),
  getValidInvitation: vi.fn(),
  sendEmail: vi.fn(),
  check: vi.fn(),
  routeLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/app/api/v1/admin/app/waitlist/_shared/route-logger', () => ({
  getWaitlistRouteLogger: () => Promise.resolve(routeLog),
}));
vi.mock('@/lib/app/waitlist/admin', () => ({
  findWaitlistEntryForInvite,
  stampWaitlistEntryInvited,
}));
vi.mock('@/lib/db/client', () => ({ prisma: { user: { findUnique: userFindUnique } } }));
vi.mock('@/lib/utils/invitation-token', () => ({
  generateInvitationToken,
  updateInvitationToken,
  getValidInvitation,
}));
vi.mock('@/lib/email/send', () => ({ sendEmail }));
// The real registry would render Lelañea's invitation email, which its own
// test covers; here the props handed to it are what matter.
vi.mock('@/lib/email/registry', () => ({
  resolveEmailTemplate: vi.fn((kind: string, props: unknown) => ({ kind, props })),
}));
vi.mock('@/lib/security/rate-limit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/security/rate-limit')>(
    '@/lib/security/rate-limit'
  );
  return { ...actual, inviteLimiter: { check } };
});
vi.mock('@/lib/env', () => ({
  env: { NEXT_PUBLIC_APP_URL: 'https://lelanea.com', BETTER_AUTH_URL: 'https://lelanea.com' },
}));

import { auth } from '@/lib/auth/config';
import { resolveEmailTemplate } from '@/lib/email/registry';
import { POST } from '@/app/api/v1/admin/app/waitlist/[id]/invite/route';

/** A real cuid shape — `cuidSchema` rejects anything else. */
const ENTRY_ID = 'cmtso8tdu000p0bgmhn1v7lao';

const ENTRY = {
  id: ENTRY_ID,
  email: 'ada@example.com',
  name: 'Ada',
  heardFrom: null,
  intent: null,
  source: 'form',
  locale: 'en-US',
  consentedAt: '2026-09-01T10:00:00.000Z',
  userId: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  removedAt: null,
  rejoinRequestedAt: null,
  rejoinRequests: 0,
  invitedAt: null,
  joinedAt: null,
};

interface Body {
  success: boolean;
  data: {
    entry: { invitedAt: string | null };
    emailStatus: string;
    expiresAt: string;
    link: string;
  };
  error?: { code: string; message: string; details?: { reason?: string; field?: string } };
}

function request(body: unknown = {}, id = ENTRY_ID) {
  const req = new Request(`https://lelanea.com/api/v1/admin/app/waitlist/${id}/invite`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
    // `undefined` sends no body at all — the headless-resend shape.
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
  return [req, { params: Promise.resolve({ id }) }] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  check.mockReturnValue({ success: true, limit: 10, remaining: 9, reset: 1_800_000_000 });
  findWaitlistEntryForInvite.mockResolvedValue(ENTRY);
  stampWaitlistEntryInvited.mockResolvedValue(true);
  userFindUnique.mockResolvedValue(null);
  getValidInvitation.mockResolvedValue(null);
  generateInvitationToken.mockResolvedValue('fresh-token');
  updateInvitationToken.mockResolvedValue('regenerated-token');
  sendEmail.mockResolvedValue({ success: true, status: 'sent', id: 'email-1' });
});

describe('POST /api/v1/admin/app/waitlist/:id/invite', () => {
  it('answers 401 when nobody is signed in, and sends nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());

    const response = await POST(...request());

    expect(response.status).toBe(401);
    expect(sendEmail).not.toHaveBeenCalled();
    expect(generateInvitationToken).not.toHaveBeenCalled();
  });

  it('answers 403 for a signed-in non-admin, and sends nothing', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

    const response = await POST(...request());

    expect(response.status).toBe(403);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('creates the invitation, sends the email, and stamps the row', async () => {
    const response = await POST(...request());

    expect(response.status).toBe(201);
    // A NEW token, because nothing was pending. `USER` always — nobody is
    // promoted from a waitlist — and the row's own name, since it has one.
    expect(generateInvitationToken).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({ name: 'Ada', role: 'USER' })
    );
    expect(updateInvitationToken).not.toHaveBeenCalled();
    expect(stampWaitlistEntryInvited).toHaveBeenCalledWith(ENTRY_ID, expect.any(Date));

    // The email goes to the row's address, greets by the resolved name, and
    // carries a link built from the token this request minted.
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sent = sendEmail.mock.calls[0]?.[0] as { to: string };
    expect(sent.to).toBe('ada@example.com');
    expect(resolveEmailTemplate).toHaveBeenCalledWith(
      'invitation',
      expect.objectContaining({
        inviteeName: 'Ada',
        inviteeEmail: 'ada@example.com',
        invitationUrl: expect.stringContaining('token=fresh-token'),
      })
    );

    const body = (await response.json()) as Body;
    expect(body.success).toBe(true);
    expect(body.data.emailStatus).toBe('sent');
    // The row as it now stands, so the table can show the badge without a guess.
    expect(body.data.entry.invitedAt).toEqual(expect.any(String));
  });

  it('regenerates and resends when an invitation is already pending, with no flag', async () => {
    getValidInvitation.mockResolvedValue({
      email: 'ada@example.com',
      metadata: { name: 'Ada', role: 'USER', invitedBy: 'admin-0', invitedAt: '2026-09-15' },
      expiresAt: new Date('2026-09-22T00:00:00.000Z'),
      createdAt: new Date('2026-09-15T00:00:00.000Z'),
    });

    const response = await POST(...request());

    // The platform's route reports a pending invitation and waits for
    // `?resend=true`. Here the only caller with one pending is the "Resend"
    // button, whose whole intent is a new email — so the old token goes and a
    // fresh one is sent, with nothing to opt into.
    expect(response.status).toBe(201);
    expect(updateInvitationToken).toHaveBeenCalledTimes(1);
    expect(generateInvitationToken).not.toHaveBeenCalled();
    expect(resolveEmailTemplate).toHaveBeenCalledWith(
      'invitation',
      expect.objectContaining({ invitationUrl: expect.stringContaining('token=regenerated-token') })
    );
    // And the stamp moves: it records the latest send.
    expect(stampWaitlistEntryInvited).toHaveBeenCalledTimes(1);
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist invitation resent',
      expect.objectContaining({ isResend: true })
    );
  });

  it('accepts a POST with no body at all, since the body is optional', async () => {
    const response = await POST(...request(undefined));

    // The documented headless resend is `POST` with nothing. The platform's
    // `validateRequestBody` would have answered "Invalid JSON" before the row
    // was read; the code review of t-47 caught the docblock promising otherwise.
    expect(response.status).toBe(201);
    expect(generateInvitationToken).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({ name: 'Ada' })
    );
  });

  it('still refuses a body that is not JSON', async () => {
    const req = new Request(`https://lelanea.com/api/v1/admin/app/waitlist/${ENTRY_ID}/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: '{not json',
    }) as unknown as NextRequest;

    const response = await POST(req, { params: Promise.resolve({ id: ENTRY_ID }) });

    expect(response.status).toBe(400);
    expect(findWaitlistEntryForInvite).not.toHaveBeenCalled();
  });

  it('still refuses a name that is not a string', async () => {
    const response = await POST(...request({ name: 42 }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as Body & { error?: { details?: { errors?: unknown[] } } };
    expect(body.error?.details?.errors).toHaveLength(1);
    expect(generateInvitationToken).not.toHaveBeenCalled();
  });

  it('takes the name from the body when the row has none', async () => {
    findWaitlistEntryForInvite.mockResolvedValue({ ...ENTRY, name: null });

    const response = await POST(...request({ name: '  Ada Lovelace ' }));

    expect(response.status).toBe(201);
    expect(generateInvitationToken).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({ name: 'Ada Lovelace' })
    );
  });

  it('lets a name in the body win over the row, so an admin can correct one', async () => {
    await POST(...request({ name: 'Ada L.' }));

    expect(resolveEmailTemplate).toHaveBeenCalledWith(
      'invitation',
      expect.objectContaining({ inviteeName: 'Ada L.' })
    );
  });

  it('falls back to the pending invitation’s name on a headless resend', async () => {
    findWaitlistEntryForInvite.mockResolvedValue({ ...ENTRY, name: null });
    getValidInvitation.mockResolvedValue({
      email: 'ada@example.com',
      metadata: { name: 'Ada', role: 'USER', invitedBy: 'admin-0', invitedAt: '2026-09-15' },
      expiresAt: new Date('2026-09-22T00:00:00.000Z'),
      createdAt: new Date('2026-09-15T00:00:00.000Z'),
    });

    const response = await POST(...request());

    expect(response.status).toBe(201);
    expect(updateInvitationToken).toHaveBeenCalledWith(
      'ada@example.com',
      expect.objectContaining({ name: 'Ada' })
    );
  });

  it('refuses with 400 when neither the row nor the body has a name, before minting anything', async () => {
    findWaitlistEntryForInvite.mockResolvedValue({ ...ENTRY, name: null });

    const response = await POST(...request({}));

    // "Hi ," is not an invitation. Refused before a token exists, so a refusal
    // leaves no pending invitation behind for the Invitations tab to list.
    expect(response.status).toBe(400);
    const body = (await response.json()) as Body;
    expect(body.error?.details?.field).toBe('name');
    expect(generateInvitationToken).not.toHaveBeenCalled();
    expect(stampWaitlistEntryInvited).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('answers 404 for an id nothing matches', async () => {
    findWaitlistEntryForInvite.mockResolvedValue(null);

    const response = await POST(...request());

    expect(response.status).toBe(404);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('rejects an id that is not a cuid, before touching the table', async () => {
    const response = await POST(...request({}, 'not-a-cuid'));

    expect(response.status).toBe(400);
    expect(findWaitlistEntryForInvite).not.toHaveBeenCalled();
  });

  it('refuses a removed row with 409 — restore first', async () => {
    findWaitlistEntryForInvite.mockResolvedValue({
      ...ENTRY,
      removedAt: '2026-09-11T12:00:00.000Z',
    });

    const response = await POST(...request());

    // "Will not be written to" and "we just wrote to them" cannot both be true
    // of one row. Keeping them exclusive is what makes "Removed" mean what the
    // dialog says.
    expect(response.status).toBe(409);
    const body = (await response.json()) as Body;
    expect(body.error?.details?.reason).toBe('removed');
    expect(sendEmail).not.toHaveBeenCalled();
    expect(stampWaitlistEntryInvited).not.toHaveBeenCalled();
  });

  it('refuses a row that has already joined with 409', async () => {
    findWaitlistEntryForInvite.mockResolvedValue({
      ...ENTRY,
      userId: 'user-1',
      joinedAt: '2026-09-16T09:00:00.000Z',
    });

    const response = await POST(...request());

    expect(response.status).toBe(409);
    const body = (await response.json()) as Body;
    expect(body.error?.details?.reason).toBe('joined');
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('refuses with 409 when an account already exists for the address, whatever the row says', async () => {
    // Let in through Admin → Users → Invite before this route existed: the row
    // does not know, the `User` table does.
    userFindUnique.mockResolvedValue({ id: 'user-9' });

    const response = await POST(...request());

    expect(response.status).toBe(409);
    const body = (await response.json()) as Body;
    expect(body.error?.details?.reason).toBe('account_exists');
    expect(userFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'ada@example.com' } })
    );
    expect(generateInvitationToken).not.toHaveBeenCalled();
  });

  it('answers 429 from the invitation limiter, keyed on the admin’s IP, before any read', async () => {
    check.mockReturnValue({ success: false, limit: 10, remaining: 0, reset: 1_800_000_000 });

    const response = await POST(...request());

    // The email-bombing bound the platform's invite route carries applies here
    // identically — this route sends the same email through the same helpers.
    expect(response.status).toBe(429);
    expect(check).toHaveBeenCalledWith('203.0.113.9');
    expect(findWaitlistEntryForInvite).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('still answers 201 when the email did not go, and says so', async () => {
    sendEmail.mockResolvedValue({ success: false, status: 'failed', error: 'boom' });

    const response = await POST(...request());

    // The invitation exists — the Invitations tab lists it — so the request did
    // not fail; what the admin needs is the status, and Resend is the remedy.
    expect(response.status).toBe(201);
    const body = (await response.json()) as Body;
    expect(body.data.emailStatus).toBe('failed');
    expect(stampWaitlistEntryInvited).toHaveBeenCalledTimes(1);
    // And the link travels, as the platform's route returns it: when the email
    // did not go, handing it over by another channel is the remedy.
    expect(body.data.link).toContain('token=fresh-token');
    expect(body.data.link).toContain('email=ada%40example.com');
  });

  it('reports the row as it holds it when a removal landed between the read and the stamp', async () => {
    stampWaitlistEntryInvited.mockResolvedValue(false);

    const response = await POST(...request());

    // The invitation was minted and the email went — the person will accept
    // it or not — but the row must not claim the list sent it, or it reads as
    // Removed and Invited at once. The response says what the row holds.
    expect(response.status).toBe(201);
    const body = (await response.json()) as Body;
    expect(body.data.entry.invitedAt).toBeNull();
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist invitation sent',
      expect.objectContaining({ stamped: false })
    );
  });

  it('logs the entry id and the outcome, and nobody’s address or name', async () => {
    await POST(...request({ name: 'Ada Lovelace' }));

    const logged = JSON.stringify([...routeLog.info.mock.calls, ...routeLog.warn.mock.calls]);
    expect(logged).not.toContain('ada@example.com');
    expect(logged).not.toContain('Lovelace');
    expect(routeLog.info).toHaveBeenCalledWith(
      'Waitlist invitation sent',
      expect.objectContaining({ entryId: ENTRY_ID, isResend: false, emailStatus: 'sent' })
    );
  });
});
