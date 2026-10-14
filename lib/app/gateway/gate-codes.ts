/**
 * The code an API refusal carries when the caller has not passed the gate
 * (t-159), for a client to branch on.
 *
 * In its own module because the browser reads it: `gate.ts` imports the
 * ledger, which imports the Prisma client, and a value import from it would
 * pull `pg` into the client bundle — the same reason `turn-codes.ts` exists.
 *
 * Two shapes carry it, and a client must read both:
 *
 * - **An app route** answers `403` with `error.code === GATE_REQUIRED` and
 *   `error.details.location` — where the shell layout would have sent them
 *   (`/app/begin`, or Sunrise's verify page).
 * - **A turn** on a facilitation seat answers `409` with
 *   `error.details.reason === GATE_REQUIRED`, because the seam the turn route
 *   hands it to can only refuse with a conflict
 *   (`lib/framework/facilitation/agents/turn-hook.ts`). No `location` there —
 *   the client sends them to the gate page, which forwards an unverified
 *   address on to verify.
 */

export const GATE_REQUIRED = 'GATE_REQUIRED';

/** Where a refusal with no `location` sends the person: the gate page. */
export const GATE_FALLBACK_LOCATION = '/app/begin';
