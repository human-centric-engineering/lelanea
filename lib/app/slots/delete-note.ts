/**
 * A person removes one of Lelañea's notes, and every version of it goes (f-memory
 * t-78; product description §3.19, §12 "Deletion is real").
 *
 * ## This writes to Daybreak's table directly, and it is a stopgap
 *
 * Daybreak's slot engine is insert-only by design: `appendSlotValue` and
 * `getSlotHeads`, nothing that removes (`lib/framework/data-slots/values.ts`).
 * Erasure takes the whole account through the FK cascade, or nothing. So
 * keeping §3.19's promise for one note means writing `framework_slot_value`
 * from here — the thing that module exists to prevent.
 *
 * The owner ruled for it explicitly (3 Oct 2026, journal on `f-memory`): one
 * marked function, a row in `.context/app/divergences.md`, and a Daybreak issue
 * asking for a per-value removal, with this as the reference. **Delete this
 * function and call Daybreak's when one lands.** It is the same arrangement as
 * `readPreviousVersions()` in `notes.ts`, and the ruling covers this write
 * alone — it is not a licence to write framework tables elsewhere.
 *
 * ## What it does
 *
 * Every version of the slug, for this person, is overwritten **in place** with
 * the placeholder `removed.ts` defines: the words, the typed value, the
 * reasoning and the provenance go, and the version numbers stay. `removed.ts`
 * says why the rows stay and why the head stays the head. `supersededAt` is
 * left as it was — the chain's shape is not what was asked to be forgotten.
 *
 * `capturedAt` becomes the moment of removal, on every version. The original
 * timeline is a fact about the note, and it goes with it; what the person sees
 * is when they removed it.
 *
 * ## What it leaves, on purpose
 *
 * - **`app_turn_slot_write` rows.** They hold a turn id, a slug and a version —
 *   no words — and they are the only link from a note to the exchange it came
 *   from, which the exchange-deletion task needs to offer that exchange next
 *   (owner ruling 4).
 * - **The conversation.** What the person said is still in it, and the AI can
 *   still read it. That is the exchange-deletion task's to offer, not this one's.
 * - **Embeddings.** None exist for a slot value; the index task owns the rule
 *   that one goes with its source (ruling 2).
 *
 * ## What it drops
 *
 * The person's cached context blocks — the facilitation block on every seat
 * they can talk to, and every module's block — so the next turn reads the
 * placeholder rather than a copy of the note up to a minute old. Process-local,
 * like the cache itself.
 *
 * @see lib/app/slots/removed.ts — the placeholder
 * @see .context/app/slots.md — "Removing a note"
 */

import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { getRegisteredModules } from '@/lib/framework/modules/registry';
import { MODULE_CONTEXT_TYPE } from '@/lib/framework/modules/context';
import { invalidateContext } from '@/lib/orchestration/chat/context-builder';
import { READABLE_SEATS } from '@/lib/app/conversation/seats';
import { FACILITATION_CONTEXT_TYPE } from '@/lib/app/voice/context-contributor';
import { readSlotVerdict } from '@/lib/app/slots/notes';
import {
  REMOVED_CONFIDENCE,
  REMOVED_REASONING,
  REMOVED_SOURCE_TYPE,
  REMOVED_VALUE,
  REMOVED_VALUE_JSON,
} from '@/lib/app/slots/removed';

export interface NoteRemoval {
  userId: string;
  slotSlug: string;
}

/** What a removal did. The panel re-reads the page rather than patching a row. */
export interface RemovedNote {
  /** How many versions were wiped — every one that was not already a placeholder. */
  versions: number;
}

/**
 * Remove the note under `slotSlug`, every version of it.
 *
 * One refusal, the correction's own: a hidden slug and a slug with nothing to
 * remove get the **same** 404, so the route cannot be used to learn that a
 * hidden slot exists and is filled (§12). A note already removed is "nothing to
 * remove" too. Retired and Art. 9 notes are removable: the person's right to
 * take something back does not depend on whether the question is still asked,
 * and an Art. 9 note's kept summary is exactly what someone might want gone.
 *
 * The write is one statement, scoped by `userId` from the session and never by
 * anything in the request, and it touches only versions not already removed —
 * so a second removal racing the first changes nothing and reports nothing.
 */
export async function deleteNote(input: NoteRemoval): Promise<RemovedNote> {
  const { isHidden } = await readSlotVerdict(input.slotSlug);
  if (isHidden) throw nothingToRemove();

  const removedAt = new Date();
  // STOPGAP — direct write to Daybreak's `framework_slot_value`. Owner ruling,
  // 3 Oct 2026; divergence row in `.context/app/divergences.md`. Replace with
  // Daybreak's per-value removal when it ships.
  const { count } = await prisma.slotValue.updateMany({
    where: {
      userId: input.userId,
      slotSlug: input.slotSlug,
      sourceType: { not: REMOVED_SOURCE_TYPE },
    },
    data: {
      value: REMOVED_VALUE,
      valueJson: REMOVED_VALUE_JSON,
      confidence: REMOVED_CONFIDENCE,
      sourceType: REMOVED_SOURCE_TYPE,
      reasoningNote: REMOVED_REASONING,
      provenance: {},
      capturedAt: removedAt,
    },
  });
  if (count === 0) throw nothingToRemove();

  forgetCachedContext(input.userId);
  return { versions: count };
}

function nothingToRemove(): NotFoundError {
  return new NotFoundError('There is no note under that heading to remove.');
}

/** Every cached block that may quote the note: each seat's, and each module's. */
function forgetCachedContext(userId: string): void {
  for (const seat of READABLE_SEATS) {
    invalidateContext(FACILITATION_CONTEXT_TYPE, seat, { userId });
  }
  for (const definition of getRegisteredModules()) {
    invalidateContext(MODULE_CONTEXT_TYPE, definition.slug, { userId });
  }
}
