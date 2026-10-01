/**
 * Which seats the conversation pane may read and speak to (§10 t-64).
 *
 * Its own module, and import-light on purpose: the pane's client hook needs
 * the seat name, and `transcript.ts` — where the read lives — imports the
 * Prisma client. A value import from there pulled `pg` into the browser
 * bundle (found looking at it; the console said "Can't resolve 'util/types'").
 * Types cross that boundary erased; values must not.
 */

import { FACILITATION_ROLES } from '@/lib/framework/facilitation/agents/roles';

/**
 * The seat the conversation pane speaks to once onboarding is behind a person,
 * and the default wherever the person's place could not be read.
 */
export const CONVERSATION_SEAT: string = FACILITATION_ROLES.facilitator;

/**
 * The seat the pane speaks to while the person is still in onboarding: the
 * first run and the discovery questions (f-onboarding t-105). Her register
 * there is `first-meeting`, and the person's answers so far ride with every
 * turn (`lib/app/onboarding/answers-context.ts`).
 */
export const ONBOARDING_SEAT: string = FACILITATION_ROLES.onboarding;

/** Which seat the pane speaks to, given whether the person is still in onboarding. */
export function conversationSeatFor(inOnboarding: boolean): string {
  return inOnboarding ? ONBOARDING_SEAT : CONVERSATION_SEAT;
}

/** The seats a member may read a transcript for — the two this leaf seeds. */
export const READABLE_SEATS: readonly string[] = [
  FACILITATION_ROLES.facilitator,
  FACILITATION_ROLES.onboarding,
];
