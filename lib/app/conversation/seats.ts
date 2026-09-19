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

/** The seat the conversation pane speaks to in release 1. */
export const CONVERSATION_SEAT: string = FACILITATION_ROLES.facilitator;

/** The seats a member may read a transcript for — the two this leaf seeds. */
export const READABLE_SEATS: readonly string[] = [
  FACILITATION_ROLES.facilitator,
  FACILITATION_ROLES.onboarding,
];
