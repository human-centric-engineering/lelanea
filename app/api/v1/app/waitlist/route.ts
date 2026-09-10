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
 * on a bad email, 429 past the per-IP sub-cap. A filled honeypot returns 200
 * and writes nothing.
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
 * a bot. One string, because the three cases must be indistinguishable from
 * outside: a different message for "already on the list" would turn this
 * endpoint into an oracle telling anyone whether a given address is on it.
 */
const ACCEPTED = 'You are on the list. We will write to you when a place opens.';

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
      return successResponse({ message: ACCEPTED }, undefined, { headers });
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
        return successResponse({ message: ACCEPTED });
      }
    }

    return handleAPIError(error);
  }
}
