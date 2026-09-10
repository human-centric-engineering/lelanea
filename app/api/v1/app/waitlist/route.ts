/**
 * Waitlist — join (Public)
 *
 * POST /api/v1/app/waitlist
 *
 * Authentication: none. The app is not open, so the waitlist is the one thing a
 * visitor can do, and there is nobody to be signed in as.
 *
 * Request body:
 *   - email      required
 *   - name       optional
 *   - heardFrom  optional — "where did you hear about this?"
 *   - intent     optional — "what would you want to achieve?"
 *   - website    honeypot; must be absent or empty
 *
 * Responses: 200 on any accepted join, 400 on a bad email, 429 past the per-IP
 * sub-cap. A filled honeypot answers 200 too, and writes nothing.
 *
 * ## Every accepted request answers identically, and that took three tries
 *
 * The point is that a caller learns nothing from the response — not whether the
 * address was already on the list, and not which field is the honeypot. Three
 * things had to agree for that to be true, and each was wrong on its own:
 *
 * 1. **The body.** One fixed sentence. A message that differed for "already on
 *    the list" hands over a yes/no answer in plain text.
 * 2. **The status.** This route originally answered 201 on a first join and 200
 *    on a repeat, which is REST-correct and is a membership oracle: post an
 *    address, read the status, learn whether that person is on a pre-launch
 *    list. It bought nothing observable — the form treats both the same — so the
 *    owner collapsed it to a single 200 (ruling, 10 September 2026).
 * 3. **The headers.** Every accepted response carries the same
 *    `X-RateLimit-*` set. An earlier version answered the honeypot without
 *    them, which made header PRESENCE a perfectly reliable tell for which field
 *    was the trap — the exact disclosure the fixed body and status were for.
 *
 * Rate limiting: TWO layers. `proxy.ts` has already applied the `'api'` section
 * cap (100/min) before this handler runs, keyed on `ip:<addr>` for an anonymous
 * caller. This handler adds the per-flow sub-cap — 5 per hour per IP — which is
 * the layer that matters for a public write. Handlers never call a section
 * limiter themselves; see `.context/security/rate-limiting.md`.
 *
 * No email is sent (A8): there is no waitlist confirmation this phase, so the
 * response is the only acknowledgement and the form says so in place.
 *
 * @see lib/app/waitlist/service.ts · components/app/site/waitlist-form.tsx
 */

import type { NextRequest } from 'next/server';
import { successResponse } from '@/lib/api/responses';
import { ValidationError, handleAPIError } from '@/lib/api/errors';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { createRateLimitResponse, getRateLimitHeaders } from '@/lib/security/rate-limit';
import { isRecord } from '@/lib/utils';
import { waitlistWithHoneypotSchema } from '@/lib/validations/app-waitlist';
import { waitlistLimiter } from '@/lib/app/waitlist/rate-limit';
import { resolveJoinLocale } from '@/lib/app/waitlist/locale';
import { joinWaitlist } from '@/lib/app/waitlist/service';

/** What every accepted request answers with — a join, a re-join, or a bot. */
const ACCEPTED = 'You are on the list. We will write to you when a place opens.';

export async function POST(request: NextRequest): Promise<Response> {
  const log = await getRouteLogger(request);
  const clientIP = getClientIP(request);

  /**
   * Declared out here so the honeypot answer in `catch` carries exactly the
   * headers a genuine answer does. Scoped inside the `try`, it did not — and a
   * bot could then find the trap field by submitting one address twice and
   * noticing that only one response had `X-RateLimit-Remaining` on it.
   */
  let headers: Record<string, string> | undefined;

  try {
    // 1. Per-flow sub-cap, before anything is read or written.
    const rateLimit = waitlistLimiter.check(clientIP);
    if (!rateLimit.success) {
      log.warn('Waitlist rate limit exceeded', { ip: clientIP, reset: rateLimit.reset });
      return createRateLimitResponse(rateLimit);
    }

    headers = getRateLimitHeaders(rateLimit);

    // 2. Validate. The honeypot is rejected HERE, by the schema's
    //    `website: z.string().max(0)`, so it arrives in `catch` below as a
    //    ValidationError rather than as a value this function ever sees. An
    //    earlier version also checked `body.website` after this line, mirroring
    //    `app/api/v1/contact/route.ts` — that branch is unreachable for exactly
    //    this reason and is gone; it was dead code that read like the real path.
    const body = await validateRequestBody(request, waitlistWithHoneypotSchema);

    // 3. Record it. A repeat fills what is still empty and overwrites nothing —
    //    see the service for why an unverified write must be additive.
    const { created, entryId } = await joinWaitlist({
      email: body.email,
      name: body.name,
      heardFrom: body.heardFrom,
      intent: body.intent,
      locale: resolveJoinLocale(request.headers.get('accept-language')),
    });

    // `created` is logged and NOT returned. It is the useful half of the fact
    // and the disclosing half is the response; keeping them apart is the whole
    // of the fix for the status-code oracle.
    //
    // The email is deliberately absent too. This is the one route an
    // unauthenticated stranger can write to, and an address in an application
    // log is a copy of their personal data outside the table the export and
    // erasure paths know about.
    log.info(created ? 'Waitlist entry created' : 'Waitlist entry updated', {
      entryId,
      created,
      answered: {
        name: body.name !== undefined,
        heardFrom: body.heardFrom !== undefined,
        intent: body.intent !== undefined,
      },
    });

    return successResponse({ message: ACCEPTED }, undefined, { headers });
  } catch (error) {
    // A filled honeypot lands here, and must answer like a success: the default
    // 400 names `website` in its details, which tells the bot exactly which
    // input to leave alone next time.
    if (error instanceof ValidationError && error.details) {
      const { errors } = error.details;
      if (
        Array.isArray(errors) &&
        errors.some((issue: unknown) => isRecord(issue) && issue.path === 'website')
      ) {
        log.warn('Waitlist honeypot triggered', { ip: clientIP });
        return successResponse({ message: ACCEPTED }, undefined, { headers });
      }
    }

    return handleAPIError(error);
  }
}
