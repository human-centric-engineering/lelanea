/**
 * The write that turns a stored reading into a placeholder, shared by the two
 * ways a person takes something back (f-memory): removing a note (t-78,
 * `delete-note.ts`) and deleting the exchange a note came from (t-127,
 * `lib/app/memory/delete-exchange.ts`).
 *
 * One definition of "wiped", so the two cannot disagree about what a
 * placeholder holds. `removed.ts` says what a placeholder is and why it stays;
 * this is only what gets written over a version, and what is dropped after.
 *
 * @see lib/app/slots/removed.ts — the placeholder
 * @see .context/app/slots.md — "Removing a note", "Deleting an exchange"
 */

import { randomUUID } from 'crypto';

import { getRegisteredModules } from '@/lib/framework/modules/registry';
import { MODULE_CONTEXT_TYPE } from '@/lib/framework/modules/context';
import { invalidateContext } from '@/lib/orchestration/chat/context-builder';
import { READABLE_SEATS } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import {
  REMOVED_CONFIDENCE,
  REMOVED_REASONING,
  REMOVED_SLUG_PREFIX,
  REMOVED_SOURCE_TYPE,
  REMOVED_VALUE,
  REMOVED_VALUE_JSON,
} from '@/lib/app/slots/removed';

/**
 * What a wiped version holds: the words, the typed value, the reasoning and the
 * provenance go. `capturedAt` becomes the moment of removal — the original
 * timeline is a fact about the reading, and it goes with it. `supersededAt` and
 * `version` are not touched: the chain's shape is not what was asked to be
 * forgotten.
 */
export interface PlaceholderFields {
  value: string;
  valueJson: typeof REMOVED_VALUE_JSON;
  confidence: number;
  sourceType: string;
  reasoningNote: string;
  provenance: Record<string, never>;
  capturedAt: Date;
}

export function placeholderFields(removedAt: Date): PlaceholderFields {
  return {
    value: REMOVED_VALUE,
    valueJson: REMOVED_VALUE_JSON,
    confidence: REMOVED_CONFIDENCE,
    sourceType: REMOVED_SOURCE_TYPE,
    reasoningNote: REMOVED_REASONING,
    provenance: {},
    capturedAt: removedAt,
  };
}

/** Only versions not already placeholders, so a repeat changes nothing and reports nothing. */
export const NOT_YET_REMOVED = { sourceType: { not: REMOVED_SOURCE_TYPE } } as const;

/**
 * The opaque slug a heading the AI coined moves to once nothing of the note is
 * left under it. See `REMOVED_SLUG_PREFIX` for why a coined heading cannot stay.
 */
export function opaqueRemovedSlug(): string {
  return `${REMOVED_SLUG_PREFIX}${randomUUID().replace(/-/g, '')}`;
}

/**
 * Drop every cached context block that may quote what was wiped: the
 * facilitation block on every seat the person can talk to, and every module's.
 * Process-local, like the cache itself. Without it the next turn could read a
 * copy of the note up to a minute old.
 */
export function forgetCachedContext(userId: string): void {
  for (const seat of READABLE_SEATS) {
    invalidateContext(FACILITATION_CONTEXT_TYPE, seat, { userId });
  }
  for (const definition of getRegisteredModules()) {
    invalidateContext(MODULE_CONTEXT_TYPE, definition.slug, { userId });
  }
}
