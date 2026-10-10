/**
 * The codes a refused turn carries, for a client to branch on (§08 t-54).
 *
 * In their own module because the browser reads them: `turns.ts` — the seam
 * that answers with them — imports the Prisma client, and a value import from
 * it pulls `pg` into the client bundle (found in §10 t-64, the same way the
 * seat constants got `seats.ts`). `turns.ts` re-exports these, so nothing
 * server-side changes.
 *
 * - `TURN_IN_FLIGHT` — the id's turn is still running; the request is refused
 *   rather than raced. The client keeps the id and asks again later.
 * - `TURN_ID_REUSED` — the id was used for different words. A client that
 *   binds each id to its words never produces it.
 * - `TURN_ID_RESERVED` — the id is one the AI's own turns run under (an
 *   opening's or a recap's). A client that mints its own ids never produces it.
 * - `TURN_ID_INVALID` — the id could never be linked to (`.` or `..`).
 *
 * Both of the last two are answered before anything is claimed: send the turn
 * again under a fresh id (t-160, t-161; `turn-intake.ts`).
 */

export const TURN_IN_FLIGHT = 'TURN_IN_FLIGHT';
export const TURN_ID_REUSED = 'TURN_ID_REUSED';
export const TURN_ID_RESERVED = 'TURN_ID_RESERVED';
export const TURN_ID_INVALID = 'TURN_ID_INVALID';
