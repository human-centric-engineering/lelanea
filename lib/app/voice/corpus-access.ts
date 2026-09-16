/**
 * Which of her documents the agent's search tool may see.
 *
 * `lib/app/voice/designation.ts` says what the rule IS; this is where it is
 * applied to the database, and it is the only thing standing between a
 * voice-only document and `search_knowledge_base` quoting it back at someone.
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
 * agents themselves do not exist yet — t-26 and t-27 create them — and an
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
  DOCUMENT_PURPOSES,
  TOOL_PATH_PURPOSES,
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
 * The slug prefix marking an agent as one of Lelañea's own.
 *
 * Exported so the test can build an agent that participates without repeating
 * the string, and so a future change has one place to happen.
 */
export const CORPUS_AGENT_SLUG_PREFIX = 'lelanea-';

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
