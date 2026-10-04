/**
 * `search_person_memory` — the AI looks back through what this person has said
 * before, and the notes kept about them, by meaning (f-memory t-130, t-107;
 * product description §5 "Data storage").
 *
 * A person mentions their father, and what they said about him in the spring
 * is in the index (t-129) but out of the AI's reach: the conversation it sees
 * is trimmed to fit, and nothing else brings old words back. This is how the
 * AI asks for them.
 *
 * ## A tool, not a context block
 *
 * A context contributor never sees the message being answered, and its block
 * is cached for 60 seconds (`lib/orchestration/chat/context-builder.ts`), so it
 * cannot search by what the person just said. The AI calls this the way it
 * calls `search_knowledge_base`, with a query of its own.
 *
 * ## Per person, from the run and never from the model
 *
 * The only argument is the query. Whose memory is searched is
 * `context.userId`, which the chat handler sets from the session, and the
 * search goes through `memory-index.ts` alone, which filters every row by that
 * person (`index-boundary.test.ts` holds it to one reader). There is no
 * argument by which one person's conversation reaches another person's words.
 *
 * ## Labelled as theirs, or as a note
 *
 * Each result says what it is, and when, in a sentence the model reads
 * (`whose`). Something the person said is their own words. A note is the
 * app's understanding of them, written from what they shared (t-107), and is
 * never to be quoted as something they said. The AI has two other kinds of
 * text in front of it, Lelañea Fulton's material and its own replies, and a
 * quote from the past attributed to the wrong one would be a small lie about
 * the person.
 *
 * ## The facilitator seat only
 *
 * The onboarding seat is the first meeting, with no past to search. The turn
 * seam stamps every dispatch with its seat (`costLogMetadata`), and a call from
 * any other seat, or from no turn, is answered with a refusal the AI can speak
 * past, the way `set_register` answers one.
 *
 * ## Reads, and costs one embedding
 *
 * Nothing is written. The query is embedded once, charged to the person and
 * counted in this turn's cost (`turnId` on the cost row, `metering.ts`), like
 * the knowledge search's.
 *
 * @see lib/app/memory/memory-index.ts — the index and its search
 * @see prisma/seeds/app-lelanea/024-search-person-memory.ts — its row and grant
 */

import { z } from 'zod';

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import {
  BaseCapability,
  type ProvenanceRedaction,
} from '@/lib/orchestration/capabilities/base-capability';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { searchMemory, type MemoryHit } from '@/lib/app/memory/memory-index';

export const SEARCH_PERSON_MEMORY_SLUG = 'search_person_memory';

/** How many results one call returns. Enough to see a pattern, few enough to read. */
export const MEMORY_RESULTS_PER_CALL = 5;

/**
 * Further than this cosine distance, a hit is not about the same thing. Set
 * against `text-embedding-3-small` on the dev database (`npm run
 * smoke:app-search-memory` prints the distances, 4 Oct 2026): "my dad" sat at
 * 0.66 from a sentence about the person's father and at 0.84 from one about
 * their allotment. A short query lands further from everything than a long
 * one, so the line sits between the two rather than near the first.
 */
export const MEMORY_MAX_DISTANCE = 0.75;

/**
 * What the model is told the tool is. Kept in step with the seed's literal by
 * `tests/unit/prisma/seeds/app-lelanea/search-person-memory.test.ts`.
 */
export const SEARCH_PERSON_MEMORY_DEFINITION: CapabilityFunctionDefinition = {
  name: SEARCH_PERSON_MEMORY_SLUG,
  description:
    'Search what this person has said to you before, and the notes kept about them, by meaning. Call it when they mention someone or something they may have spoken about before, or when remembering it would help you meet them now. Each result says whether it is their own words or a note, and when. Quote their words back only as theirs, never as yours or as Lelañea’s material. A note is your understanding of them, not something they said. If nothing comes back, do not claim to remember.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What to look for, in plain words: "my father", "starting the new job".',
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ['query'],
  },
};

const argsSchema = z.object({ query: z.string().trim().min(1).max(500) });
type SearchPersonMemoryArgs = z.infer<typeof argsSchema>;

/** One thing found, as the model reads it. */
export interface RememberedItem {
  /** What it is: something the person said, or a note kept about them. */
  kind: 'their_words' | 'note';
  /** The words, as they were said or as the note holds them. */
  words: string;
  /** When, as a date the model can say aloud ("3 October 2026"). */
  when: string;
  /** Whose these are and how to use them: a sentence the model reads. */
  whose: string;
}

export interface SearchPersonMemoryResult {
  results: RememberedItem[];
}

/** The date a hit was said on, in words, in UTC so it never depends on the server's zone. */
export function spokenDate(at: Date): string {
  return at.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** The sentence that tells the model whose words a hit is. */
export function whoseWords(when: string): string {
  return `The person’s own words, said by them on ${when}. Quote them only as theirs.`;
}

/** The sentence that tells the model a hit is a note, not something they said (t-107). */
export function whoseNote(when: string): string {
  return `A note kept about the person, written from what they shared, last updated on ${when}. It is your understanding of them, not their words: never quote it as something they said.`;
}

function asRemembered(hit: MemoryHit): RememberedItem {
  if (hit.sourceKind === 'note') {
    const when = spokenDate(hit.notedAt);
    return { kind: 'note', words: hit.text, when, whose: whoseNote(when) };
  }
  const when = spokenDate(hit.saidAt);
  return { kind: 'their_words', words: hit.text, when, whose: whoseWords(when) };
}

const turnStampSchema = z.object({ seat: z.string(), turnId: z.string().min(1).optional() });

/** The seat and turn the turn seam stamped on this dispatch, or null when it came from no turn. */
function stampOf(context: CapabilityContext): { seat: string; turnId: string | null } | null {
  const parsed = turnStampSchema.safeParse(context.costLogMetadata);
  return parsed.success ? { seat: parsed.data.seat, turnId: parsed.data.turnId ?? null } : null;
}

/** The message this turn answers, so the search does not hand it straight back. */
async function turnMessageId(userId: string, turnId: string | null): Promise<string | null> {
  if (turnId === null) return null;
  const turn = await prisma.appTurn.findUnique({
    where: { userId_turnId: { userId, turnId } },
    select: { userMessageId: true },
  });
  return turn?.userMessageId ?? null;
}

export class SearchPersonMemoryCapability extends BaseCapability<
  SearchPersonMemoryArgs,
  SearchPersonMemoryResult
> {
  readonly slug = SEARCH_PERSON_MEMORY_SLUG;
  readonly functionDefinition = SEARCH_PERSON_MEMORY_DEFINITION;
  protected readonly schema = argsSchema;
  /** The query is the person's subject, and every result is their words. */
  readonly processesPii = true;

  /**
   * What the audit row keeps: how many things were found, never the query or
   * the words. Both are the person's, and the durable trace is not where a
   * deletion reaches.
   */
  redactProvenance(
    _args: SearchPersonMemoryArgs,
    result: CapabilityResult<SearchPersonMemoryResult>
  ): ProvenanceRedaction {
    return {
      args: { query: '[redacted]' },
      resultPreview: JSON.stringify(
        result.success
          ? { success: true, found: result.data?.results.length ?? 0 }
          : { success: false, error: result.error?.code ?? 'unknown' }
      ),
    };
  }

  async execute(
    args: SearchPersonMemoryArgs,
    context: CapabilityContext
  ): Promise<CapabilityResult<SearchPersonMemoryResult>> {
    if (context.userId === null) {
      return this.error('There is no person whose past to search.', 'no_person');
    }
    const stamp = stampOf(context);
    if (stamp?.seat !== CONVERSATION_SEAT) {
      return this.error(
        'What the person said before can only be searched in the main conversation. Answer them from what is in front of you.',
        'wrong_seat'
      );
    }

    try {
      const own = await turnMessageId(context.userId, stamp.turnId);
      const hits = await searchMemory({ userId: context.userId }, args.query, {
        limit: MEMORY_RESULTS_PER_CALL,
        maxDistance: MEMORY_MAX_DISTANCE,
        excludeMessageIds: own ? [own] : [],
        attribution: {
          agentId: context.agentId,
          ...(context.conversationId ? { conversationId: context.conversationId } : {}),
          metadata: { ...(context.costLogMetadata ?? {}) },
        },
      });
      return this.success({ results: hits.map(asRemembered) });
    } catch (err) {
      logger.error('search_person_memory: the search failed', {
        agentId: context.agentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.error(
        'Their earlier conversations could not be searched just now. Answer from what is in front of you, and do not claim to remember.',
        'search_failed'
      );
    }
  }
}
