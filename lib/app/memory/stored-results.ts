/**
 * What a memory search left in the conversation, cleared when the person takes
 * something back (f-memory t-130; product description §12 "Deletion is real").
 *
 * Sunrise's chat handler stores every tool result as a `role: 'tool'` message,
 * and replays it to the model on every later turn (`message-builder.ts`). So a
 * `search_person_memory` call leaves a verbatim copy of what it found in the
 * conversation it ran in: someone's words from the spring, or a note, now
 * sitting in October's exchange. Deleting the spring exchange, or removing the
 * note, drops the vector and the source, and would leave that copy reaching
 * every later prompt. The security review on t-130/t-107 found it.
 *
 * ## Cleared, not deleted, and all of them
 *
 * The row stays, so the assistant message that made the call still has its
 * answer: a call with no result is refused by the providers on replay. Its
 * content becomes {@link CLEARED_SEARCH_RESULT} and its metadata, which holds
 * the same result and the query, is emptied.
 *
 * **Every stored search result of the person's goes**, not only those that
 * held what was deleted. Telling which did would mean reading each one for the
 * deleted words, and a match that missed one would be the failure this exists
 * to prevent. What is lost is only a copy: the AI can search again, and a
 * search now finds what is still there.
 *
 * Called inside the transaction of each way a person takes something back:
 * removing a note (`delete-note.ts`), deleting an exchange
 * (`delete-exchange.ts`), and forgetting a deleted conversation
 * (`delete-conversation.ts`).
 *
 * @see lib/app/memory/search-capability.ts — the tool whose results these are
 */

import type { executeTransaction } from '@/lib/db/utils';
import { SEARCH_PERSON_MEMORY_SLUG } from '@/lib/app/memory/search-capability';

/** What a cleared result says to the model on replay. */
export const CLEARED_SEARCH_RESULT = JSON.stringify({
  success: true,
  data: { results: [] },
  cleared:
    'What this search found was cleared after the person deleted something they had shared. Search again if you need it; never repeat what was here.',
});

/** The client a transaction hands its callback. */
type Tx = Parameters<Parameters<typeof executeTransaction>[0]>[0];

/**
 * Overwrite every stored `search_person_memory` result in the person's
 * conversations. Scoped by the conversation's owner, so nobody else's
 * conversation is touched. Idempotent: a cleared row is not written again.
 */
export async function clearStoredSearchResults(
  tx: Tx,
  subject: { userId: string }
): Promise<number> {
  const { count } = await tx.aiMessage.updateMany({
    where: {
      role: 'tool',
      capabilitySlug: SEARCH_PERSON_MEMORY_SLUG,
      conversation: { userId: subject.userId },
      NOT: { content: CLEARED_SEARCH_RESULT },
    },
    data: { content: CLEARED_SEARCH_RESULT, metadata: {} },
  });
  return count;
}
