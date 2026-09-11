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
 * All three now hold by construction rather than by care: the honeypot answer
 * is built on the same line as a genuine one, in the same scope, from the same
 * `headers`.
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
import { handleAPIError } from '@/lib/api/errors';
import { validateRequestBody } from '@/lib/api/validation';
import { getRouteLogger } from '@/lib/api/context';
import { getClientIP } from '@/lib/security/ip';
import { createRateLimitResponse, getRateLimitHeaders } from '@/lib/security/rate-limit';
import { isHoneypotFilled, waitlistWithHoneypotSchema } from '@/lib/validations/app-waitlist';
import { waitlistLimiter } from '@/lib/app/waitlist/rate-limit';
import { resolveJoinLocale } from '@/lib/app/waitlist/locale';
import { joinWaitlist } from '@/lib/app/waitlist/service';

/** What every accepted request answers with — a join, a re-join, or a bot. */
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

    // 2. Validate. The honeypot is `z.unknown()` and never fails here.
    const body = await validateRequestBody(request, waitlistWithHoneypotSchema);

    // 3. The honeypot, decided on the VALUE rather than on a validation error.
    //
    //    Two earlier shapes were wrong in opposite directions. Rejecting it in
    //    the schema (`z.string().max(0)`) meant recognising a hit by the thrown
    //    error's field path — which matches on the FIELD, so `website: null`
    //    failed as "expected string" and a real person was told they had joined
    //    when nothing was written. Answering from the `catch` also lost the
    //    rate-limit headers, and header PRESENCE is a perfectly reliable tell
    //    for which field is the trap.
    //
    //    Here the answer is built on the same line as a genuine one, so status,
    //    body and headers match by construction rather than by care.
    if (isHoneypotFilled(body.website)) {
      log.warn('Waitlist honeypot triggered', { ip: clientIP });
      return successResponse({ message: ACCEPTED }, undefined, { headers });
    }

    // 4. Record it. A repeat fills what is still empty and overwrites nothing —
    //    see the service for why an unverified write must be additive.
    const { created, removed, entryId } = await joinWaitlist({
      email: body.email,
      name: body.name,
      heardFrom: body.heardFrom,
      intent: body.intent,
      locale: resolveJoinLocale(request.headers.get('accept-language')),
    });

    // `created` and `removed` are logged and NOT returned. They are the useful
    // half of the fact and the disclosing half is the response; keeping them
    // apart is the whole of the fix for the status-code oracle.
    //
    // The email is deliberately absent too. This is the one route an
    // unauthenticated stranger can write to, and an address in an application
    // log is a copy of their personal data outside the table the export and
    // erasure paths know about.
    //
    // **Three messages, not two, and `answered` is suppressed on the third.** A
    // submission against a REMOVED entry writes no answers at all (D9 — see the
    // service): only the record of the attempt. An earlier version logged that as
    // "Waitlist entry updated" with `answered: { intent: true }`, which said an
    // answer had been recorded when none had — the one operational record of a
    // re-join attempt, reporting the opposite of what happened. The code review
    // of §03 t-24 caught it.
    if (removed) {
      log.info('Waitlist re-join attempt recorded on a removed entry', { entryId });
    } else {
      log.info(created ? 'Waitlist entry created' : 'Waitlist entry updated', {
        entryId,
        created,
        answered: {
          name: body.name !== undefined,
          heardFrom: body.heardFrom !== undefined,
          intent: body.intent !== undefined,
        },
      });
    }

    return successResponse({ message: ACCEPTED }, undefined, { headers });
  } catch (error) {
    // Nothing honeypot-shaped reaches here any more: `website` is `z.unknown()`,
    // so it cannot fail validation and cannot put its own name in a 400. What is
    // left is a real failure — a bad email, malformed JSON, a database error —
    // and it belongs to the caller.
    return handleAPIError(error);
  }
}
