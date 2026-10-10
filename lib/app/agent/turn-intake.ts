/**
 * Which client turn ids the turn hook will take (t-160, t-161).
 *
 * The facilitation route validates a client's `turnId` only for length, and
 * passes it on untouched (divergence Row 18). Two kinds of id it lets through
 * must not reach the ledger:
 *
 * - **An AI opening's id** (`app_opening_…`, `app_recap_…`). The transcript
 *   read hands the pane the recap's id ahead of the recap running. A member's
 *   turn posted under it would claim the ledger row first: the recap is then
 *   refused as reused, and the member's turn is read everywhere as one the AI
 *   opened (its reply window, its place in the transcript). The opening and
 *   recap still go through this same hook, so they mark their turn
 *   ({@link markAgentOpened}) and only an unmarked turn is refused.
 * - **`.` or `..`**, which cannot sit in a URL path segment. Escaping does not
 *   help, because the URL standard reads `%2E` as a dot, so every link to such
 *   a turn (the cost views, the metering turn routes) would 404.
 *
 * The marker is a `Symbol.for` key, not a field: a request body is JSON, which
 * cannot carry a symbol, so no client can claim it. `Symbol.for` rather than a
 * module-local symbol because the hook is registered from the boot graph and
 * the routes that mark may sit in another module graph (the reason
 * `turn-hook.ts` keeps its store on `globalThis`).
 */

import { TURN_ID_INVALID, TURN_ID_RESERVED } from '@/lib/app/agent/turn-codes';
import { isAgentOpenedTurnId } from '@/lib/app/conversation/opening-id';
import type {
  FacilitationTurn,
  FacilitationTurnRefusal,
} from '@/lib/framework/facilitation/agents/turn-hook';
import { turnIdParamSchema } from '@/lib/validations/app-metering';

const AGENT_OPENED = Symbol.for('lelanea.agentOpenedTurn');

/**
 * Mark a turn as one the AI opens (the welcome, a session's recap), so the
 * hook lets it run under its reserved id. Enumerable, so a spread of the turn
 * keeps it.
 */
export function markAgentOpened<T extends FacilitationTurn>(turn: T): T {
  return Object.defineProperty(turn, AGENT_OPENED, { value: true, enumerable: true });
}

/** Whether the turn was marked by {@link markAgentOpened}. */
export function isMarkedAgentOpened(turn: FacilitationTurn): boolean {
  return Reflect.get(turn, AGENT_OPENED) === true;
}

/**
 * The refusal for a client turn id the ledger must not take, or null when the
 * id is fine (or there is none, so the hook mints one).
 */
export function refuseClientTurnId(turn: FacilitationTurn): FacilitationTurnRefusal | null {
  const id = turn.clientTurnId;
  if (id === undefined) return null;
  if (!turnIdParamSchema.safeParse(id).success) {
    return {
      refused: true,
      message: 'This turn id cannot be used. Send another.',
      reason: TURN_ID_INVALID,
    };
  }
  if (isAgentOpenedTurnId(id) && !isMarkedAgentOpened(turn)) {
    return {
      refused: true,
      message: "This turn id is kept for the AI's own turns. Send another.",
      reason: TURN_ID_RESERVED,
    };
  }
  return null;
}
