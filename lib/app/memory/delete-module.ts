/**
 * A person deletes everything they said while working through one module
 * (f-forget-session t-155; product description §3.19, §12 "Deletion is real").
 *
 * A module's worth is the person's turns stamped with that module
 * (`app_turn.moduleSlug`, t-152; owner ruling 2, 7 Oct 2026, journal on
 * `f-forget-session`). Each goes as one deleted exchange does, through
 * `deleteOwnedExchanges`, so it takes everything an exchange deletion takes
 * (`delete-exchange.ts` lists it), and the sessions it touches settle the same
 * way:
 *
 * - **A draft account goes**, and **a kept account is flagged** as written from
 *   something since deleted (t-147).
 * - **The recaps that looked back on those sessions go** (t-151).
 *
 * There is no tick for a kept account, as there is for a whole session
 * (t-153): a module's worth is part of several sessions, so no account is
 * wholly its own, and the person may still want the rest of what it says.
 *
 * ## What stays
 *
 * - **Turns from before the stamp.** Nothing recorded a turn's module before
 *   t-152, and a reconstruction from node states would be a guess, so they are
 *   not part of any module's worth. They can be deleted by session or one
 *   exchange at a time. The offer says so.
 * - **Turns in other modules, and turns stamped with none.**
 * - **The module's node state and the person's progress in it.** They hold no
 *   words: where someone is on the journey is not something they said.
 * - **Session rows**, as for every deletion here (journal, 8 Oct 2026).
 *
 * ## One transaction
 *
 * As for a session, and for the same reason: a module's worth half deleted
 * when a batch failed, with the person told it was gone, is what §12 exists to
 * prevent. It gets the session's longer timeout.
 *
 * ## Refusals
 *
 * - **Nothing stamped with that slug**, whether the module does not exist, the
 *   person said nothing in it, or all of it predates the stamp, gets a 404
 *   that says so. Never a success that deleted nothing (`B31`): that would read
 *   as done.
 * - **A turn still being answered** gets a 409 that says to wait
 *   (`planTurnDeletion`), and nothing is deleted.
 *
 * @see lib/app/memory/delete-exchange.ts — what an exchange deletion takes
 * @see lib/app/memory/delete-session.ts — the whole-session deletion
 * @see .context/app/slots.md — "Deleting a module's worth"
 */

import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { OWNED_TURN_SELECT } from '@/lib/app/memory/delete-turns';
import { deleteOwnedExchanges, type DeletedExchanges } from '@/lib/app/memory/delete-exchange';
import { SESSION_DELETION_TIMEOUT_MS } from '@/lib/app/memory/delete-session';

export interface ModuleDeletion {
  userId: string;
  /** The module's slug, as `app_turn.moduleSlug` stamps it. */
  moduleSlug: string;
}

/** How many of the person's turns are stamped with this module: whether there is anything to offer. */
export function countModuleExchanges(userId: string, moduleSlug: string): Promise<number> {
  return prisma.appTurn.count({ where: { userId, moduleSlug } });
}

/**
 * Delete every turn of the person's stamped with this module, with everything
 * derived from it, in one transaction.
 */
export async function deleteModuleExchanges(input: ModuleDeletion): Promise<DeletedExchanges> {
  const { userId, moduleSlug } = input;
  const turns = await prisma.appTurn.findMany({
    where: { userId, moduleSlug },
    select: OWNED_TURN_SELECT,
  });
  if (turns.length === 0) {
    throw new NotFoundError(
      'There is nothing you said in this module to delete. Conversations from before Lelañea noted which module you were in can be deleted by session, or one exchange at a time from your notes.'
    );
  }
  return deleteOwnedExchanges(userId, turns, { timeout: SESSION_DELETION_TIMEOUT_MS });
}
