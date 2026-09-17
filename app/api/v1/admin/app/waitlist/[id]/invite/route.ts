/**
 * Waitlist — invite someone straight from the list (Admin)
 *
 * POST /api/v1/admin/app/waitlist/:id/invite
 *
 * Authentication: admin, as for the rest of this surface.
 *
 * Request body: `{ "name"?: string }`. Used when the entry has no name (D2 made
 * it optional on the public form); the invitation email greets the person by
 * it, so with neither the row nor the body carrying one the route answers 400
 * rather than sending "Hi ,". A name in the body wins over the row's, so an
 * admin can correct one without editing the entry.
 *
 * Responds 201 with `{ entry, emailStatus, expiresAt }` — the row as it now
 * stands (`invitedAt` stamped) and whether the email actually went. Refuses:
 * 404 for an id nothing matches; 409 for a removed row, for a row that has
 * already joined, and for an address that already has an account; 400 for no
 * name; 429 from the invitation limiter.
 *
 * ## The platform's rules, re-derived rather than copied (`fp5`)
 *
 * Sunrise's own flow is inlined in `POST /api/v1/users/invite` — there is no
 * `inviteUser()` service to call, only the library under it. This route uses
 * that library (`generateInvitationToken` / `updateInvitationToken` /
 * `getValidInvitation`, the `invitation` email through the seam, and
 * `inviteLimiter`) and takes each of the route's rules on its own merits:
 *
 * - **An existing account is a 409**, because an invitation is for someone who
 *   has none — and here the check has two forms, the row's own `joinedAt` and
 *   a `User` lookup by address, since Admin → Users → Invite can have let
 *   someone in without ever touching the row.
 * - **A pending invitation is regenerated and resent, with no `?resend=true`
 *   flag.** The platform's flag exists because its form is also how you find
 *   out whether someone was already invited; here the row already says so
 *   (`invitedAt`), and the only caller of this route with a pending invitation
 *   is the "Resend" button, whose whole intent is a new email.
 * - **`inviteLimiter` on the admin's IP**, exactly as the platform applies it:
 *   the email-bombing bound it exists for holds here identically. It runs
 *   before anything else, so a burst of refusals is bounded too.
 * - **Role is always `USER`.** Nobody is promoted to admin from a waitlist.
 *
 * ## Refusing a removed row
 *
 * An invitation to someone the admin took off the list would be two
 * contradictory states on one row — "will not be written to" and "we just
 * wrote to them". Keeping them exclusive is what makes "Removed" mean what the
 * removal dialog says. Restore first; the 409 says so.
 *
 * ## `invitedAt` records the latest send
 *
 * Stamped on every send, moved on a resend, so the badge reads as "last wrote
 * to them on". It is set once the invitation exists, before the email is
 * attempted, because the invitation IS the state — Sunrise's Invitations tab
 * lists it from the same verification store whether or not the email went.
 * `emailStatus` in the response is what says whether it did.
 *
 * ## What reaches the log, and what the platform logs on our behalf
 *
 * This route's own lines carry the entry id and the outcome, never the address
 * — same logger as the rest of the surface (`_shared/route-logger.ts`), for the
 * same reason. The platform's token helpers log the address themselves
 * (`lib/utils/invitation-token.ts`, Sunrise-owned, identical in all three
 * tiers), as they do under the platform's own invite route; that is theirs to
 * change and is noted in `.context/app/waitlist.md` rather than patched here.
 *
 * @see lib/app/waitlist/admin.ts · .context/app/waitlist.md
 */

import { withAdminAuth } from '@/lib/auth/guards';
import { successResponse } from '@/lib/api/responses';
import { ConflictError, NotFoundError, ValidationError } from '@/lib/api/errors';
import { validatePathParam, validateRequestBody } from '@/lib/api/validation';
import { cuidSchema } from '@/lib/validations/common';
import { waitlistInviteSchema } from '@/lib/validations/app-waitlist';
import { findWaitlistEntryForInvite, stampWaitlistEntryInvited } from '@/lib/app/waitlist/admin';
import { getWaitlistRouteLogger } from '@/app/api/v1/admin/app/waitlist/_shared/route-logger';
import { prisma } from '@/lib/db/client';
import { BRAND } from '@/lib/brand';
import { env } from '@/lib/env';
import {
  generateInvitationToken,
  getValidInvitation,
  updateInvitationToken,
} from '@/lib/utils/invitation-token';
import { sendEmail } from '@/lib/email/send';
import { resolveEmailTemplate } from '@/lib/email/registry';
import { inviteLimiter, createRateLimitResponse } from '@/lib/security/rate-limit';
import { getClientIP } from '@/lib/security/ip';

/** The platform's invitation window; `generateInvitationToken` hard-codes the same. */
const INVITATION_EXPIRY_DAYS = 7;

export const POST = withAdminAuth<{ id: string }>(async (request, session, { params }) => {
  const log = await getWaitlistRouteLogger(request);

  // First, before any read: the bound on how many emails one admin session can
  // cause, and the one refusal that should not cost a database round trip.
  const rateLimit = inviteLimiter.check(getClientIP(request));
  if (!rateLimit.success) {
    log.warn('Waitlist invitation rate limit exceeded', {
      adminId: session.user.id,
      remaining: rateLimit.remaining,
    });
    return createRateLimitResponse(rateLimit);
  }

  // Next.js 16: `params` is a promise.
  const { id: rawId } = await params;
  const id = validatePathParam(rawId, cuidSchema, { label: 'waitlist entry id' });

  const body = await validateRequestBody(request, waitlistInviteSchema);

  const entry = await findWaitlistEntryForInvite(id);
  if (!entry) {
    throw new NotFoundError('Waitlist entry not found');
  }

  if (entry.removedAt) {
    throw new ConflictError(
      'This person was taken off the waitlist. Put them back on it before inviting them.',
      { reason: 'removed' }
    );
  }

  if (entry.joinedAt || entry.userId) {
    throw new ConflictError('This person has already joined.', { reason: 'joined' });
  }

  // The row is the truth for the list; the `User` table is the truth for
  // accounts, and someone let in through Admin → Users → Invite before this
  // route existed has an account the row does not know about.
  const existingUser = await prisma.user.findUnique({
    where: { email: entry.email },
    select: { id: true },
  });
  if (existingUser) {
    throw new ConflictError('This person already has an account.', { reason: 'account_exists' });
  }

  // A pending invitation, whichever surface raised it, is regenerated and
  // resent rather than reported — see the docblock. Its metadata name is the
  // last fallback, so a headless resend for a nameless row need not repeat it.
  const existingInvitation = await getValidInvitation(entry.email);

  const name = body.name ?? entry.name ?? existingInvitation?.metadata.name;
  if (!name) {
    throw new ValidationError(
      'This entry has no name. Give one so the invitation can greet them.',
      {
        field: 'name',
      }
    );
  }

  const invitedAt = new Date();
  const metadata = {
    name,
    role: 'USER',
    invitedBy: session.user.id,
    invitedAt: invitedAt.toISOString(),
  };

  const token = existingInvitation
    ? await updateInvitationToken(entry.email, metadata)
    : await generateInvitationToken(entry.email, metadata);

  // The invitation now exists, so the row says so — before the email, whose
  // outcome is reported separately.
  const stamped = await stampWaitlistEntryInvited(id, invitedAt);

  const appUrl = env.NEXT_PUBLIC_APP_URL || env.BETTER_AUTH_URL;
  const invitationUrl = `${appUrl}/accept-invite?token=${token}&email=${encodeURIComponent(entry.email)}`;

  const expiresAt = new Date(invitedAt);
  expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

  const emailResult = await sendEmail({
    to: entry.email,
    subject: `You've been invited to join ${BRAND.name}`,
    react: resolveEmailTemplate('invitation', {
      inviterName: session.user.name || 'Administrator',
      inviteeName: name,
      inviteeEmail: entry.email,
      invitationUrl,
      expiresAt,
    }),
  });

  // The entry id and the outcome. Not the address, and not the name.
  log.info(existingInvitation ? 'Waitlist invitation resent' : 'Waitlist invitation sent', {
    entryId: id,
    invitedBy: session.user.id,
    isResend: existingInvitation !== null,
    emailStatus: emailResult.status,
    // False only if the row vanished between the read above and the stamp —
    // the invitation still exists and the email still went, so it is a fact
    // for the log rather than a failure for the caller.
    stamped,
  });

  return successResponse(
    {
      entry: { ...entry, invitedAt: invitedAt.toISOString() },
      emailStatus: emailResult.status,
      expiresAt: expiresAt.toISOString(),
    },
    undefined,
    { status: 201 }
  );
});
