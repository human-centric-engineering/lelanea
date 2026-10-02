/**
 * The AI opens the first conversation after onboarding (f-onboarding t-122).
 *
 * After "Begin the journey" (t-106) the person lands on an empty facilitator
 * conversation. The opening is a turn like any other, through the same hook
 * (`runFacilitationTurn`, divergence Row 18, filled by `lib/app/agent/turns.ts`),
 * metered, deadlined and recorded on `app_turn`. What differs is that the
 * agent opens it: Sunrise's `streamChat` takes an `openingTurn` (#474), whose
 * content steers the turn as a system message and is never stored as the
 * person's words. That content is {@link OPENING_MESSAGE}, written here, and
 * never anything a client sent. The person sees only the AI's reply: there is
 * no user row to show or to hide. (The hook still hashes and screens
 * {@link OPENING_MESSAGE} as the turn's message; it is the same text.)
 *
 * ## Once per person
 *
 * Keyed on the turn id. Every opening runs under {@link OPENING_TURN_ID},
 * sent as a client id so the ledger can replay it, and the ledger is unique on
 * (person, turn id). A second request while the first is running is refused as
 * in flight; one after it completed is the recorded reply again, with no model
 * call; one after it failed runs it again under the same id. None of them is a
 * second opening.
 *
 * ## When it is owed
 *
 * All of these, read on the server, never taken from the client:
 *
 * - **Past the gate** (`hasPassedGate`, the shell layout's own check).
 * - **Handed off**: Values entered and onboarding no longer active
 *   (`handedOffFrom`, as the Begin step reads it).
 * - **Nothing said on the facilitator seat.** Any message of the person's in
 *   a facilitator conversation means they have already spoken, and the AI does
 *   not open a conversation that is under way. The opening writes none of its
 *   own, so this needs no exception for it. A message answered with the crisis
 *   resource alone is stored nowhere, but records a safety event (f-safety
 *   t-58), which counts too: a person who reached for help is not then greeted
 *   brightly.
 * - **Someone to speak.** The seat has a live agent the person may reach
 *   (`resolveFacilitationSurface`), or there is no opening to give.
 * - **Not given up on.** An opening that failed {@link MAX_OPENING_ATTEMPTS}
 *   times is not run again: each attempt is a model call, and a cause that
 *   keeps failing it (an outage, a reply that cannot be linked) would
 *   otherwise be paid for on every load. The person can simply speak.
 *
 * {@link openingDue} adds "the opening has not completed", which is what the
 * transcript read tells the pane. {@link prepareOpening} does not: a completed
 * opening asked for again is answered by the ledger with its replay, which is
 * the right answer to a retry whose connection dropped.
 *
 * ## Changing the words
 *
 * The ledger refuses an id reused for a different message, so new words need a
 * new id: bump the version in {@link OPENING_TURN_ID}. Someone who was opened
 * under the old id then has a recorded turn on the seat that is not the
 * current opening, which `hasSpoken` reads as "already spoken", so nobody is
 * opened twice. What reads an opening's rows matches every version
 * (`isOpeningTurnId`).
 *
 * @see lib/app/agent/turns.ts — the hook the turn goes through
 * @see app/api/v1/app/conversation/opening/route.ts — the route the pane calls
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { streamChat } from '@/lib/orchestration/chat';
import type { ChatStream } from '@/lib/orchestration/chat/types';
import {
  FACILITATION_SURFACE_CONTEXT_TYPE,
  resolveFacilitationSurface,
  type FacilitationSurface,
} from '@/lib/framework/facilitation/agents/surface';
import { runFacilitationTurn } from '@/lib/framework/facilitation/agents/turn-hook';
import { readJourneyNodeStates } from '@/lib/app/onboarding/first-run-store';
import { handedOffFrom } from '@/lib/app/onboarding/hand-off-state';
import { hasPassedGate, type GateSubject } from '@/lib/app/gateway/gate';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { OPENING_TURN_ID } from '@/lib/app/conversation/opening-id';

export { OPENING_TURN_ID } from '@/lib/app/conversation/opening-id';

/**
 * What the AI is asked, as the person's side of the opening turn. Written
 * here, never sent by a client. The person never sees it.
 *
 * Their answers are already in the turn's context (t-105's block, on the
 * facilitator seat too), so this only says what to do with them. It claims
 * nothing about timing: the person may begin the journey days after the last
 * answer (t-106 review round 1). The platform's injection scan does not read
 * an opening turn's content (it is the app's, not the person's); the
 * facilitation hook's crisis screen does, as it reads every turn's message.
 *
 * Sunrise titles a new conversation from it (the first 80 characters), as it
 * would from a person's first message. Members never see a conversation
 * title; an admin listing conversations does.
 */
export const OPENING_MESSAGE =
  'The person has finished the discovery questions and begun the journey, which starts with ' +
  'Values. This conversation is empty, so you speak first. Open on their own words: in the ' +
  'block of what they wrote in the discovery questions, their answers are the lines that begin ' +
  'with "> ", under each [Question …] label. Quote one phrase from one of those lines, exactly ' +
  'and in quotation marks, choosing the answer with the most of them in it. Quote nothing else ' +
  'as theirs: not a question, and not any example in your own instructions. Then reflect it ' +
  'back briefly and warmly, and end with one open question that invites them to say more. ' +
  'Say nothing about when they wrote it.';

/** How many attempts a failed opening gets before it is given up on. */
export const MAX_OPENING_ATTEMPTS = 3;

/** Why an opening is not started, for the route to answer and the client to branch on. */
export const OPENING_NOT_DUE = 'opening_not_due';

/** The person's hand-off, read as the Begin step reads it. */
async function isHandedOff(userId: string): Promise<boolean> {
  return handedOffFrom(await readJourneyNodeStates(userId));
}

/**
 * Whether the person has said anything on the facilitator seat: a message in a
 * facilitator conversation of theirs, one answered with the crisis resource
 * alone, which stores no message, or any recorded turn there that is not the
 * current opening — an earlier version's opening included.
 */
async function hasSpoken(userId: string): Promise<boolean> {
  const [turn, message, crisis] = await Promise.all([
    prisma.appTurn.findFirst({
      where: { userId, seat: CONVERSATION_SEAT, turnId: { not: OPENING_TURN_ID } },
      select: { id: true },
    }),
    prisma.aiMessage.findFirst({
      where: {
        role: 'user',
        conversation: {
          userId,
          contextType: FACILITATION_SURFACE_CONTEXT_TYPE,
          contextId: CONVERSATION_SEAT,
        },
      },
      select: { id: true },
    }),
    prisma.appSafetyEvent.findFirst({
      where: { userId, seat: CONVERSATION_SEAT },
      select: { id: true },
    }),
  ]);
  return turn !== null || message !== null || crisis !== null;
}

/**
 * Whether an opening may be started for this person: past the gate, handed
 * off, and nothing else said on the facilitator seat. Read together, since
 * each is a separate query. Never throws; a failed read is "no", because an
 * opening that does not happen costs nothing.
 */
export async function mayOpen(user: GateSubject): Promise<boolean> {
  try {
    const [passed, handedOff, spoken, opening] = await Promise.all([
      hasPassedGate(user),
      isHandedOff(user.id),
      hasSpoken(user.id),
      readOpening(user.id),
    ]);
    const givenUp = opening?.status === 'failed' && opening.attempts >= MAX_OPENING_ATTEMPTS;
    return passed && handedOff && !spoken && !givenUp;
  } catch (error) {
    logger.warn('Opening eligibility could not be read', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** The current opening's ledger row, if it has one. */
function readOpening(userId: string) {
  return prisma.appTurn.findUnique({
    where: { userId_turnId: { userId, turnId: OPENING_TURN_ID } },
    select: { status: true, attempts: true },
  });
}

/**
 * Whether the pane should start the opening now: {@link mayOpen}, someone to
 * speak it, and the opening not already completed. The same refusals as
 * {@link prepareOpening}, so the pane is never told to ask for an opening the
 * route will refuse.
 */
export async function openingDue(user: GateSubject): Promise<boolean> {
  try {
    const [may, surface, opening] = await Promise.all([
      mayOpen(user),
      resolveFacilitationSurface(user.id, CONVERSATION_SEAT),
      readOpening(user.id),
    ]);
    return may && surface !== null && opening?.status !== 'completed';
  } catch (error) {
    logger.warn('Opening turn could not be read', {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** What a request contributes to the opening turn: never its words. */
export interface OpeningRequest {
  user: GateSubject;
  requestId?: string;
  visitorId?: string;
  signal?: AbortSignal;
  keepAlive?: (work: Promise<unknown>) => void;
  headers?: Headers;
}

/** Why the opening is not run: not owed, or no facilitator agent to speak. */
export type OpeningRefusal = { ready: false; reason: typeof OPENING_NOT_DUE | 'no_surface' };

/** The facilitator surface the opening will be spoken on. */
export type OpeningReady = { ready: true; surface: FacilitationSurface };

/**
 * Whether the opening may run for this person now, and on which surface. Split
 * from {@link runOpening} so a route can answer each refusal before any stream
 * is opened.
 */
export async function prepareOpening(user: GateSubject): Promise<OpeningReady | OpeningRefusal> {
  if (!(await mayOpen(user))) return { ready: false, reason: OPENING_NOT_DUE };
  const surface = await resolveFacilitationSurface(user.id, CONVERSATION_SEAT);
  if (surface === null) return { ready: false, reason: 'no_surface' };
  return { ready: true, surface };
}

/**
 * Run the opening turn on a surface {@link prepareOpening} resolved. The turn
 * goes through the facilitation hook exactly as a member's would, under
 * {@link OPENING_TURN_ID} and with {@link OPENING_MESSAGE}. The hook's own
 * refusals (in flight) throw its `ConflictError`, as they do on the role route.
 */
export async function runOpening(
  surface: FacilitationSurface,
  request: OpeningRequest
): Promise<ChatStream> {
  const userId = request.user.id;
  return runFacilitationTurn(
    {
      userId,
      role: CONVERSATION_SEAT,
      agentId: surface.agentId,
      agentSlug: surface.agentSlug,
      conversationId: surface.conversationId,
      message: OPENING_MESSAGE,
      clientTurnId: OPENING_TURN_ID,
      signal: request.signal,
      keepAlive: request.keepAlive,
      headers: request.headers,
    },
    (extras) =>
      streamChat({
        // The agent opens the turn: no `message`, so no row in the person's name.
        openingTurn: { content: OPENING_MESSAGE },
        agentSlug: surface.agentSlug,
        userId,
        conversationId: surface.conversationId,
        contextType: FACILITATION_SURFACE_CONTEXT_TYPE,
        contextId: CONVERSATION_SEAT,
        requestId: request.requestId,
        visitorId: request.visitorId,
        signal: request.signal,
        ...extras,
      })
  );
}
