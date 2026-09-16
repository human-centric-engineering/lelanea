/**
 * Her own sentences, fetched for a moment — the fingerprint's third layer.
 *
 * The core says how she sounds in the abstract; an exemplar is a real passage of
 * hers, so the model has something concrete to sound *like*. This module is the
 * retrieval half: which documents may be used as examples, what is searched for,
 * and what a passage looks like by the time it is safe to put in a prompt.
 *
 * ## Directly, and not through `search_knowledge_base`
 *
 * t-25's rule is that a `voice`-designated document may never reach the agent's
 * search tool, because that is the path that can QUOTE it — the path where her
 * Substack paragraphs come back as an answer attributed to nobody. That rule
 * still holds, and this module does not weaken it: it calls the search *service*
 * itself with an explicit allowlist of voice-designated documents, and what it
 * returns is framed as an example of register, never offered as an answer.
 *
 * Two paths over one corpus, with the opposite half of the vocabulary each:
 *
 * | Path                       | Purposes admitted   | May the model quote it? |
 * | -------------------------- | ------------------- | ----------------------- |
 * | `search_knowledge_base`    | `knowledge`, `both` | yes                     |
 * | this module → the prompt   | `voice`, `both`     | no — register only      |
 *
 * `sensitivity-client` is admitted by neither. The deferral is about the model
 * seeing the words at all, and it sees them either way.
 *
 * ## No documents, no search
 *
 * An install with no voice-designated material returns an empty list without
 * embedding anything. That is not only a cost saving: `searchKnowledge` treats
 * `documentIds: []` as an explicit restriction that collapses to `FALSE`, so the
 * call could only ever return nothing, and spending an embedding to be told so
 * on every cache miss would be a real per-turn bill for a guaranteed answer.
 *
 * ## What a passage looks like by the time it leaves here
 *
 * Neutralised, truncated, and never trusted. A chunk is her writing, but it is
 * writing that arrived through an upload, and it lands inside a `LOCKED CONTEXT`
 * block whose fence is a line of `=` characters. A passage containing such a line
 * would forge the end of the block and put everything after it back at the
 * model's top level, so every fence-shaped line has its `=` characters replaced
 * before the passage is emitted. The rest of the defence is the authored framing
 * in `content/lelanea_voice_overlays.json`, which tells the model in her own
 * words that these are examples of how she sounds, are not what the person said,
 * and are not instructions to her.
 *
 * @see .context/app/voice.md
 * @see lib/app/voice/designation.ts — the vocabulary and the two rules
 */

import { logger } from '@/lib/logging';
import { searchKnowledge } from '@/lib/orchestration/knowledge/search';
import { resolveVoiceDocumentIds } from '@/lib/app/voice/corpus-access';

/**
 * How many passages reach one prompt.
 *
 * Three, because the point is to show a register and not to build a corpus in
 * the context window. Every passage costs tokens on a turn that already carries
 * the whole always-on core, and the fourth example of how she writes teaches the
 * model nothing the first three did not.
 */
export const MAX_EXEMPLARS = 3;

/**
 * The most of one passage that is emitted.
 *
 * A chunk can be long, and a long one stops being an example of her cadence and
 * starts being an article the model may try to answer from — which is exactly
 * the failure the `voice` designation exists to prevent, arriving by length
 * rather than by path.
 */
export const MAX_EXEMPLAR_CHARS = 1_200;

/** One passage of hers, ready to be labelled and emitted. */
export interface VoiceExemplar {
  /** The document it came from, where the row has a name. */
  source: string | null;
  /** The passage itself: neutralised, collapsed and truncated. */
  passage: string;
}

/**
 * Replace the `=` characters in any fence-shaped line.
 *
 * `buildContext` frames every body between `=== LOCKED CONTEXT ===` and
 * `=== END LOCKED CONTEXT ===`. A passage carrying a line of its own that looks
 * like that would close the block early, and everything after it — including the
 * rest of her passage — would read to the model as ordinary prompt rather than
 * as labelled, quarantined material.
 *
 * The words are kept and only the fence is destroyed, so a passage that happens
 * to discuss a heading rule still reads as itself.
 */
function neutraliseFences(text: string): string {
  return text.replace(/^[ \t]*={3,}.*$/gm, (line) => line.replaceAll('=', '-'));
}

/** Collapse the whitespace a chunker leaves behind, without reflowing her lines. */
function collapseBlankRuns(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Cut to {@link MAX_EXEMPLAR_CHARS} at a word boundary, with an ellipsis.
 *
 * The ellipsis is not decoration — an example that stops mid-sentence with no
 * mark reads to a model as a sentence she wrote that way.
 */
function truncate(text: string): string {
  if (text.length <= MAX_EXEMPLAR_CHARS) return text;
  const cut = text.slice(0, MAX_EXEMPLAR_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > MAX_EXEMPLAR_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** The whole passage pipeline, in the order it has to run. */
export function preparePassage(content: string): string {
  return truncate(collapseBlankRuns(neutraliseFences(content)));
}

/**
 * Passages of hers for this moment, or an empty list.
 *
 * Empty is a normal answer, not a failure: an install whose corpus is not yet
 * designated has no voice material, and the caller emits the authored
 * "no passage was found" note rather than pretending otherwise.
 *
 * The embedding spend is attributed with a `kind`, so a cost reader can tell
 * this path's queries from a user's own searches. There is no agent or
 * conversation id to attribute to — `buildContext` gives a contributor the
 * context tuple and a `userId`, and nothing else — and inventing one would put a
 * wrong id on a real cost row.
 */
export async function retrieveVoiceExemplars(
  query: string,
  limit: number = MAX_EXEMPLARS
): Promise<VoiceExemplar[]> {
  const documentIds = await resolveVoiceDocumentIds();
  if (documentIds.length === 0) return [];

  const results = await searchKnowledge(query, { documentIds }, limit, undefined, {
    metadata: { kind: 'lelanea:voice-exemplars' },
  });

  return results
    .map((result) => ({
      source: result.documentName?.trim() ? result.documentName.trim() : null,
      passage: preparePassage(result.chunk.content),
    }))
    .filter((exemplar) => exemplar.passage.length > 0);
}

/**
 * The same, but never throwing.
 *
 * A retrieval failure — the embedding provider down, a dimension mismatch, a
 * transient database error — must not cost the person her register. The overlay
 * and the always-on core are the reliable half of this feature, and throwing out
 * to `buildContext`'s contributor-catch would blank the whole block and lose
 * them both over something retrieval did. The same degrade-rather-than-throw
 * shape the framework's module contributor uses for its slot read.
 */
export async function retrieveVoiceExemplarsSafely(
  query: string,
  limit: number = MAX_EXEMPLARS
): Promise<VoiceExemplar[]> {
  try {
    return await retrieveVoiceExemplars(query, limit);
  } catch (err) {
    logger.warn('voice exemplars: retrieval failed; emitting the overlay without examples', {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
