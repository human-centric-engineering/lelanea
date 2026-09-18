/**
 * Facilitation turn hook — a seam a leaf fills to own what happens around a
 * facilitation turn.
 *
 * **Carried by Lelañea ahead of Daybreak** (`.context/app/divergences.md`,
 * Row 18; proposed upstream as daybreak#265). The facilitation role route hands every turn to
 * {@link runFacilitationTurn} instead of calling `streamChat` itself. With
 * nothing registered it runs the turn exactly as the route always did.
 *
 * ## The contract, for any leaf that registers one
 *
 * - `run(extras)` is the turn the route would have run: `streamChat` with the
 *   route's own arguments, plus whatever `costLogMetadata` / `messageMetadata`
 *   the hook passes. Call it at most once. Not calling it is how a hook answers a
 *   turn without the model — a replay of one it already answered.
 * - Throw an `APIError` to refuse the turn. It happens before any stream is
 *   opened, so the caller gets a status code, not an event stream saying no.
 * - `clientTurnId` is the client's optional `turnId`, validated by the route and
 *   otherwise untouched. The route gives it no meaning of its own.
 *
 * Register from the leaf's boot seam (`lib/app/leaf-bootstrap.ts`); the
 * framework does not import the leaf, so the leaf reaches in.
 *
 * ## Why the store is on `globalThis`
 *
 * Next can bundle a route handler and the boot seam into separate module graphs,
 * each with its own copy of this file. A module-scoped variable set at boot would
 * be invisible to the route that reads it. Same reason, same fix, as the module
 * registry (`lib/framework/modules/registry.ts`, #160).
 */

import type { ChatRequest, ChatStream } from '@/lib/orchestration/chat/types';

/** One turn on a facilitation seat, as the route resolved it. */
export interface FacilitationTurn {
  userId: string;
  /** The seat — the route's `:role` segment. */
  role: string;
  agentId: string;
  agentSlug: string;
  /** The surface conversation being resumed, or undefined for a new one. */
  conversationId: string | undefined;
  message: string;
  /** The client's own id for this turn, when it sent one. */
  clientTurnId: string | undefined;
}

/** What a hook may add to the turn's `streamChat` call. */
export type FacilitationTurnExtras = Pick<ChatRequest, 'costLogMetadata' | 'messageMetadata'>;

/** The turn the route would have run, with the hook's extras merged in. */
export type FacilitationTurnRun = (extras: FacilitationTurnExtras) => ChatStream;

export type FacilitationTurnHook = (
  turn: FacilitationTurn,
  run: FacilitationTurnRun
) => Promise<ChatStream>;

/** The behaviour with nothing registered: run the turn as the route always did. */
export const passThroughFacilitationTurn: FacilitationTurnHook = (_turn, run) =>
  Promise.resolve(run({}));

const store = globalThis as unknown as {
  daybreakFacilitationTurnHook?: FacilitationTurnHook;
};

/** Register the hook. One per install; a second registration replaces the first. */
export function registerFacilitationTurnHook(hook: FacilitationTurnHook): void {
  store.daybreakFacilitationTurnHook = hook;
}

/** The registered hook, or the pass-through. */
export function getFacilitationTurnHook(): FacilitationTurnHook {
  return store.daybreakFacilitationTurnHook ?? passThroughFacilitationTurn;
}

/** Called by the facilitation route for every turn. */
export function runFacilitationTurn(
  turn: FacilitationTurn,
  run: FacilitationTurnRun
): Promise<ChatStream> {
  return getFacilitationTurnHook()(turn, run);
}

/** Test-only: back to nothing registered. */
export function __resetFacilitationTurnHookForTests(): void {
  delete store.daybreakFacilitationTurnHook;
}
