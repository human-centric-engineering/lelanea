/**
 * Which of her documents each path may see — the two rules, against the database.
 *
 * `lib/app/voice/designation.ts` says what the rules ARE; this is where they are
 * applied, and the first of them is the only thing standing between a voice-only
 * document and `search_knowledge_base` quoting it back at someone.
 *
 * Two sets over one corpus, taking the opposite half of the vocabulary each:
 *
 * | Set                             | Purposes            | Consumer                            |
 * | ------------------------------- | ------------------- | ----------------------------------- |
 * | {@link resolveQuotableDocumentIds} | `knowledge`, `both` | the agent's search tool, which quotes |
 * | {@link resolveVoiceDocumentIds}    | `voice`, `both`     | the context contributor, register only |
 *
 * `sensitivity-client` is admitted by neither — the deferral is about the model
 * seeing the words at all, and it sees them either way. Everything below the
 * "Who this widens" heading is about the first set: only it feeds Sunrise's
 * access resolver, and only it can widen an agent.
 *
 * ## Composed live, never materialised
 *
 * The obvious implementation is to write `ai_agent_knowledge_document` rows for
 * the documents that qualify and let Sunrise's resolver read them. Do not:
 * `resolveAgentDocumentAccess`'s own docblock explains why, and it is not a style
 * objection. That pivot has no provenance column, so a process that copies
 * derived grants into it cannot tell its own rows from an operator's — the
 * removal pass either clobbers what a human granted or leaks what the rule has
 * since revoked. Composing at resolve time has neither failure: re-designate a
 * document in the admin and the next resolve (or the next cache eviction) already
 * agrees.
 *
 * ## Who this widens
 *
 * Contributors run only for agents in the `restricted` branch and can only ADD
 * documents, so this can never narrow anything — which is exactly why it must not
 * fire for every restricted agent on the install. Sunrise seeds several of its
 * own (the pattern advisor, the quiz master, the evaluation judges), and handing
 * them her corpus because they happen to be restricted would be a leak nobody
 * asked for.
 *
 * Participation is therefore a property of the agent: {@link isCorpusAgent}, the
 * `lelanea-` slug prefix. A prefix rather than an allowlist constant because the
 * agents themselves did not exist when the rule was written — t-26 creates the
 * first — and an
 * allowlist would ship empty, making this mechanism dark until somebody
 * remembered to come back and add a string (`HB9`). The prefix is live the moment
 * the first `lelanea-…` agent is created, with nothing to remember.
 *
 * ## Her agents carry no purpose tag grants, and that is load-bearing
 *
 * It is tempting to also grant `purpose-knowledge` through Sunrise's agent form
 * as a belt-and-braces measure. That would break the rule rather than reinforce
 * it: tag grants UNION, so a `purpose-knowledge` grant admits every document
 * carrying that tag INCLUDING one also marked `sensitivity-client` — the material
 * the owner deferred. See the header of `designation.ts`.
 *
 * ## System-scoped documents are out of this entirely
 *
 * `AiKnowledgeDocument.scope = 'system'` is the platform's own pre-loaded seed
 * material — the bundled Agentic Design Patterns reference. The resolver returns
 * `includeSystemScope: true` unconditionally, so a system document is searchable
 * by EVERY agent regardless of grants, and no contributor can take that away.
 *
 * Designating one would therefore be theatre: the surface would record an answer
 * the mechanism cannot act on, and an operator who marked it `voice` would
 * reasonably believe it had stopped being quotable (`B31`). So the rule filters
 * to `scope: 'app'` — her material — and the admin surface lists the same set.
 *
 * ## Cache
 *
 * `resolveAgentDocumentAccess` memoises its answer for 60 seconds. Designating a
 * document therefore takes up to a minute to reach a live agent unless the write
 * path evicts — which it does: the leaf's designation route calls
 * `invalidateAllAgentAccess()`, the same contract Sunrise's own tag route
 * follows.
 *
 * @see .context/app/voice.md
 */

import { prisma } from '@/lib/db/client';
import {
  CORPUS_AGENT_SLUG_PREFIX,
  DOCUMENT_PURPOSES,
  TOOL_PATH_PURPOSES,
  VOICE_PATH_PURPOSES,
  UNGRANTABLE_SENSITIVITIES,
  purposeTagSlug,
  sensitivityTagSlug,
} from '@/lib/app/voice/designation';

/**
 * The `AiKnowledgeDocument.scope` value for material uploaded into this install,
 * as opposed to `'system'` — the platform's own pre-loaded seed corpus.
 *
 * Exported because the admin surface must list exactly the set this rule governs.
 * A page that showed a system document beside an `Agent may quote` badge would be
 * stating an answer the rule has no power over.
 */
export const APP_SCOPE = 'app';

/**
 * Re-exported, not defined here.
 *
 * It moved to `designation.ts` — which imports nothing — because this module
 * imports `@/lib/db/client`, and that builds a connection pool at import time.
 * A consumer wanting only the string was paying for a `pg.Pool` to get it. The
 * re-export keeps this module the one place to look for the agent-side rule.
 */
export { CORPUS_AGENT_SLUG_PREFIX };

/** Is this agent one of hers — i.e. one the corpus rule should widen? */
export function isCorpusAgent(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && slug.startsWith(CORPUS_AGENT_SLUG_PREFIX);
}

/**
 * Tag slugs that DISQUALIFY a document from the tool path.
 *
 * Two sources, one list: every purpose outside {@link TOOL_PATH_PURPOSES}
 * (today, `voice`), and every sensitivity in {@link UNGRANTABLE_SENSITIVITIES}
 * (today, `client`).
 *
 * Derived rather than written out, so adding a purpose to the vocabulary without
 * adding it to the tool path excludes it by default — the safe direction. A
 * hand-written list would silently admit the new value.
 */
export function disqualifyingTagSlugs(): string[] {
  return [
    ...DOCUMENT_PURPOSES.filter((purpose) => !TOOL_PATH_PURPOSES.includes(purpose)).map(
      purposeTagSlug
    ),
    ...UNGRANTABLE_SENSITIVITIES.map(sensitivityTagSlug),
  ];
}

/** Tag slugs that QUALIFY a document, before the disqualifiers are subtracted. */
export function qualifyingTagSlugs(): string[] {
  return TOOL_PATH_PURPOSES.map(purposeTagSlug);
}

/**
 * The documents that may reach `search_knowledge_base`.
 *
 * `some(qualifying) AND NOT some(disqualifying)` — the SQL form of
 * `isQuotable()`, and `tests/unit/lib/app/voice/corpus-access.test.ts` asserts the
 * two agree on every combination of the vocabulary rather than trusting that they
 * were written on the same afternoon.
 *
 * An UNDESIGNATED document matches nothing here, so it reaches nothing. That is
 * the safe default and it is deliberate: a document uploaded through Sunrise's
 * own uploader is not knowledge until somebody says it is.
 */
export async function resolveQuotableDocumentIds(): Promise<string[]> {
  const documents = await prisma.aiKnowledgeDocument.findMany({
    where: {
      // Her material only. A `system`-scoped document is searchable by every
      // agent whatever this returns (see the header), so contributing one would
      // add nothing — and omitting the filter would make the set LOOK like it
      // governed documents it does not.
      scope: APP_SCOPE,
      tags: { some: { tag: { slug: { in: qualifyingTagSlugs() } } } },
      NOT: { tags: { some: { tag: { slug: { in: disqualifyingTagSlugs() } } } } },
    },
    select: { id: true },
  });
  return documents.map((document) => document.id);
}

/**
 * Tag slugs that DISQUALIFY a document from the voice path: the ungrantable
 * sensitivities, and nothing else.
 *
 * **The asymmetry with {@link disqualifyingTagSlugs} is `readDesignation`'s
 * safest-reading rule, in SQL.** A document can carry two purpose tags — the
 * platform's own tag modal knows nothing about these families and will happily
 * put both on one row — and when it does, `readDesignation` resolves the pair to
 * `voice`, because the cost of being wrong that way is a passage that is never
 * quoted and the cost the other way is her Substack pasted into a reply as an
 * answer.
 *
 * So on the TOOL path a second `purpose-voice` tag is disqualifying: it makes
 * the document less quotable. On THIS path a second tag cannot make a document
 * less of a voice example, so nothing about a purpose disqualifies it here. A
 * document tagged `purpose-voice` and `purpose-knowledge` is semantically what
 * `purpose-both` says: it reaches this path, and not the one that can quote.
 *
 * The first version derived these the same way the tool path's are derived —
 * "every purpose outside {@link VOICE_PATH_PURPOSES}" — which excluded that
 * document from BOTH paths while the admin surface showed it as `Voice`. It
 * reached nothing, silently, exactly as if nobody had designated it. Caught by
 * /code-review.
 *
 * The safe-by-default property that derivation bought is not lost: it lives in
 * {@link voiceQualifyingTagSlugs} instead. A purpose added to the vocabulary and
 * to neither path still qualifies a document for nothing on its own.
 */
export function voiceDisqualifyingTagSlugs(): string[] {
  return [...UNGRANTABLE_SENSITIVITIES.map(sensitivityTagSlug)];
}

/** Tag slugs that QUALIFY a document for the voice path, before disqualifiers. */
export function voiceQualifyingTagSlugs(): string[] {
  return VOICE_PATH_PURPOSES.map(purposeTagSlug);
}

/**
 * The documents that may be shown to the model as EXAMPLES OF HER REGISTER.
 *
 * The same SQL shape as {@link resolveQuotableDocumentIds} over the other half
 * of the vocabulary, and `tests/unit/lib/app/voice/corpus-access.test.ts`
 * asserts it against `isVoiceExemplar()` over every combination rather than
 * trusting the two to have stayed in step.
 *
 * **This set is NOT a widening of what the agent can quote.** Nothing returned
 * here reaches `search_knowledge_base`; it reaches the context contributor,
 * which labels every passage by origin and tells the model in her own authored
 * words that these are examples of how she sounds and not answers to give. A
 * `voice` document is in this set and absent from the quotable one, which is the
 * property t-25 shipped and this task must not weaken.
 *
 * Same `scope: 'app'` filter, for the same reason: `system`-scoped seed material
 * is the platform's bundled reference, is searchable by every agent whatever any
 * rule says, and is emphatically not an example of how she writes.
 */
export async function resolveVoiceDocumentIds(): Promise<string[]> {
  const documents = await prisma.aiKnowledgeDocument.findMany({
    where: {
      scope: APP_SCOPE,
      tags: { some: { tag: { slug: { in: voiceQualifyingTagSlugs() } } } },
      NOT: { tags: { some: { tag: { slug: { in: voiceDisqualifyingTagSlugs() } } } } },
    },
    select: { id: true },
  });
  return documents.map((document) => document.id);
}

/**
 * The access contributor itself: her corpus, for her agents, and nothing for
 * anyone else's.
 *
 * Returns an empty contribution for an agent that is not hers — including an
 * agent that no longer exists, which `resolveAgentDocumentAccess` has already
 * handled by the time a contributor could see it, but which is cheap to be
 * correct about.
 */
export async function contributeCorpusAccess(agentId: string): Promise<{ documentIds: string[] }> {
  const agent = await prisma.aiAgent.findUnique({
    where: { id: agentId },
    select: { slug: true },
  });
  if (!isCorpusAgent(agent?.slug)) return { documentIds: [] };

  return { documentIds: await resolveQuotableDocumentIds() };
}
