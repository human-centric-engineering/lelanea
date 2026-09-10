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
 * Responses: 201 on a first join, 200 when an existing entry was updated, 400
 * on a bad email, 429 past the per-IP sub-cap. A filled honeypot answers 201 and
 * writes nothing.
 *
 * **What the status code discloses, stated rather than glossed.** The BODY is
 * one fixed sentence in every accepted case, so it tells a caller nothing. The
 * 201-vs-200 split does: it says whether that address was already on the list.
 * The task's contract asks for the split, and the disclosure it buys is narrow
 * and self-defeating — the only way to ask the question is to *join*, so probing
 * an address enrols it, and the sub-cap allows five questions an hour per IP.
 * Worth knowing it is there; not worth breaking the contract over.
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

/**
 * What every accepted request answers with, whether it joined, re-joined or was
 * a bot. One string: a body that differed for "already on the list" would let
 * anyone read a yes/no answer straight out of the response, without even having
 * to notice the status code.
 */
const ACCEPTED = 'You are on the list. We will write to you when a place opens.';

/**
 * The status a swallowed honeypot answers with.
 *
 * 201, not 200, and the choice is not arbitrary: a honeypot must answer the way
 * a real submission of the same shape would, or the difference IS the tell. A
 * bot spraying addresses it has not used before gets 201 from the real path
 * almost every time, so 200 here would let it find the honeypot field by
 * submitting one address twice and watching the codes disagree.
 */
const HONEYPOT_STATUS = 201;

export async function POST(request: NextRequest): Promise<Response> {
  const log = await getRouteLogger(request);
  const clientIP = getClientIP(request);

  try {
    // 1. Per-flow sub-cap, before anything is read or written.
    const rateLimit = waitlistLimiter.check(clientIP);
    if (!rateLimit.success) {
      log.warn('Waitlist rate limit exceeded', { ip: clientIP, reset: rateLimit.reset });
      return createRateLimitResponse(rateLimit);
    }

    const headers = getRateLimitHeaders(rateLimit);

    // 2. Validate, honeypot included.
    const body = await validateRequestBody(request, waitlistWithHoneypotSchema);

    // 3. Honeypot. Answer exactly as a real join does and write nothing — a bot
    //    that can tell the difference will simply stop filling the field.
    if (body.website && body.website.length > 0) {
      log.warn('Waitlist honeypot triggered', { ip: clientIP });
      return successResponse({ message: ACCEPTED }, undefined, {
        status: HONEYPOT_STATUS,
        headers,
      });
    }

    // 4. Record it. A repeat updates the answers rather than failing — see the
    //    service for why that is the kind answer as well as the useful one.
    const { created, entryId } = await joinWaitlist({
      email: body.email,
      name: body.name,
      heardFrom: body.heardFrom,
      intent: body.intent,
      locale: resolveJoinLocale(request.headers.get('accept-language')),
    });

    // The email is deliberately absent from the log line. This is the one route
    // an unauthenticated stranger can write to, and an address in an
    // application log is a copy of their personal data outside the table the
    // export and erasure paths know about.
    log.info(created ? 'Waitlist entry created' : 'Waitlist entry updated', {
      entryId,
      created,
      answered: {
        name: body.name !== undefined,
        heardFrom: body.heardFrom !== undefined,
        intent: body.intent !== undefined,
      },
    });

    return successResponse({ message: ACCEPTED }, undefined, {
      status: created ? 201 : 200,
      headers,
    });
  } catch (error) {
    // A honeypot that fails VALIDATION (a non-empty `website`) must answer like
    // a success too, for the same reason step 3 does. Without this it returns a
    // 400 naming the field, which tells the bot exactly which input to leave
    // alone next time. Mirrors `app/api/v1/contact/route.ts`.
    if (error instanceof ValidationError && error.details) {
      const { errors } = error.details;
      if (
        Array.isArray(errors) &&
        errors.some((issue: unknown) => isRecord(issue) && issue.path === 'website')
      ) {
        log.warn('Waitlist honeypot validation failed', { ip: clientIP });
        return successResponse({ message: ACCEPTED }, undefined, {
          status: HONEYPOT_STATUS,
        });
      }
    }

    return handleAPIError(error);
  }
}
