/**
 * The write that turns a stored reading into a placeholder, shared by the two
 * ways a person takes something back (f-memory): removing a note (t-78,
 * `delete-note.ts`) and deleting the exchange a note came from (t-127,
 * `lib/app/memory/delete-exchange.ts`).
 *
 * Deleting a whole conversation (t-128, `delete-conversation.ts`) wipes through
 * {@link wipeTurnWrites} too, the same as an exchange.
 *
 * One definition of "wiped", so the two cannot disagree about what a
 * placeholder holds. `removed.ts` says what a placeholder is and why it stays;
 * this is only what gets written over a version, and what is dropped after.
 *
 * @see lib/app/slots/removed.ts — the placeholder
 * @see .context/app/slots.md — "Removing a note", "Deleting an exchange"
 */

import { randomUUID } from 'crypto';

import { prisma } from '@/lib/db/client';
import type { executeTransaction } from '@/lib/db/utils';
import { listSlotDefinitions } from '@/lib/framework/data-slots';
import { getRegisteredModules } from '@/lib/framework/modules/registry';
import { MODULE_CONTEXT_TYPE } from '@/lib/framework/modules/context';
import { invalidateContext } from '@/lib/orchestration/chat/context-builder';
import { READABLE_SEATS } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { forgetWipedNotes } from '@/lib/app/memory/memory-index';
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

/** The client a transaction hands its callback. */
type Tx = Parameters<Parameters<typeof executeTransaction>[0]>[0];

/**
 * The slugs here that the AI coined: no definition in either tier. A taxonomy
 * slug is an admin's wording and stays whatever happens to the readings under it.
 */
export async function coinedSlugs(slugs: string[]): Promise<Set<string>> {
  if (slugs.length === 0) return new Set();
  const framework = await listSlotDefinitions();
  const ours = await prisma.appSlotDefinition.findMany({
    where: { slug: { in: slugs } },
    select: { slug: true },
  });
  const defined = new Set([...framework.map((d) => d.slug), ...ours.map((d) => d.slug)]);
  return new Set(slugs.filter((slug) => !defined.has(slug)));
}

/** One version a turn wrote, as its ledger row (`app_turn_slot_write`) records it. */
export interface TurnWrite {
  slotSlug: string;
  version: number;
}

/**
 * Make placeholders of the versions some of one person's turns wrote, and only
 * those: earlier and later readings came from other exchanges and stay (owner
 * ruling, 3 Oct 2026). Returns how many versions were wiped.
 *
 * The vectors of the versions it wipes go in the same transaction
 * ({@link forgetWipedNotes}, t-107): a placeholder is rewritten in place, so no
 * foreign key cascade would take them.
 *
 * A heading the AI coined moves to an opaque slug only once **no** version
 * under it is left unwiped. While another exchange's reading is still filed
 * there, the heading is what that reading is filed under, and renaming part of
 * a chain would leave the old slug with no head, so its next capture would
 * collide at version 1. The ledger follows the rename, as on a removal (t-78).
 *
 * Call {@link coinedSlugs} before the transaction opens and pass its answer.
 *
 * STOPGAP — a direct write to Daybreak's `framework_slot_value`. Owner ruling,
 * 3 Oct 2026; divergence row in `.context/app/divergences.md`. Replace with
 * Daybreak's per-value removal when it ships (daybreak#286).
 */
export async function wipeTurnWrites(
  tx: Tx,
  input: { userId: string; writes: TurnWrite[]; coined: Set<string>; removedAt: Date }
): Promise<number> {
  const bySlug = new Map<string, number[]>();
  for (const write of input.writes) {
    const versions = bySlug.get(write.slotSlug) ?? [];
    versions.push(write.version);
    bySlug.set(write.slotSlug, versions);
  }
  let versions = 0;
  for (const [slotSlug, written] of bySlug) {
    const wiped = await tx.slotValue.updateMany({
      where: { userId: input.userId, slotSlug, version: { in: written }, ...NOT_YET_REMOVED },
      data: placeholderFields(input.removedAt),
    });
    versions += wiped.count;

    if (wiped.count > 0 && input.coined.has(slotSlug)) {
      const left = await tx.slotValue.count({
        where: { userId: input.userId, slotSlug, ...NOT_YET_REMOVED },
      });
      if (left === 0) {
        const renamedTo = opaqueRemovedSlug();
        await tx.slotValue.updateMany({
          where: { userId: input.userId, slotSlug },
          data: { slotSlug: renamedTo },
        });
        await tx.appTurnSlotWrite.updateMany({
          where: { slotSlug, turn: { userId: input.userId } },
          data: { slotSlug: renamedTo },
        });
      }
    }
  }
  if (versions > 0) await forgetWipedNotes(tx, { userId: input.userId });
  return versions;
}
