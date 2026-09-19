/**
 * Her search results say whose material each passage is (f-safety t-60).
 *
 * **What it fixes.** Her instructions tell her to answer from Lelañea's
 * material and to search it first. But `search_knowledge_base` does not return
 * only Lelañea's material. The platform's access resolver always lets
 * `system`-scoped documents through to a restricted agent. On an install that
 * holds the platform's own reference corpus ("Agentic Design Patterns" on a
 * seeded dev database), her searches can return passages from it. Nothing on
 * the result says so, so she could quote it to someone as hers.
 *
 * Her voice exemplars were already labelled by origin, but by the context
 * contributor (`lib/app/voice/context-contributor.ts`), which covers a
 * different path. This is the same labelling on the tool path.
 *
 * **How.** A subclass of the platform's capability, mounted over the built-in
 * slug through `registerAppCapability`. `lib/app/capabilities.ts` does the
 * mounting, and Sunrise's registry documents that seam for exactly this. It runs
 * the platform's search unchanged and then adds an `origin` sentence to each
 * result. The sentence reaches the model, not just the envelope: the chat
 * handler spreads each result into the tool message it sends back
 * (`extractCitations`, `{ ...raw, marker }`). The test asserts that composed
 * message.
 *
 * **Only for her agents.** Other agents on the install get the platform's
 * result unchanged. "Not Lelañea's material" means nothing to an agent that is
 * not her, so the label would be noise. The one exception is below: when the
 * agent itself cannot be looked up, every result is marked unverified.
 *
 * **Three labels, and "not hers" is only for what is known not to be.** A
 * passage from her designated corpus is hers. One from the platform's
 * `system`-scoped reference corpus is not. Anything else she can reach, such as
 * an app document an operator granted her agent directly or a person's own
 * upload, is marked unverified. Calling those "not hers" would tell her to
 * disown material that may be hers or the person's.
 *
 * **Fail-safe, not fail-open.** If the labelling lookup fails, the results are
 * still returned, because a search that errors leaves her answering from
 * memory, which is worse. Each result is marked unverified, never hers.
 *
 * @see lib/app/voice/corpus-access.ts — which documents are hers
 * @see lib/orchestration/chat/citations.ts — how a result reaches the model
 */

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { SearchKnowledgeCapability } from '@/lib/orchestration/capabilities/built-in/search-knowledge';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';
import { isCorpusAgent, resolveQuotableDocumentIds } from '@/lib/app/voice/corpus-access';

/** The sentences a result can carry. They are copy the model reads, so they say what to do. */
export const RESULT_ORIGINS = {
  hers: "Lelañea's material.",
  notHers:
    "Not Lelañea's material. This is reference text the install holds for another purpose. Do not present it as hers or as her view.",
  unverified: "Not confirmed as Lelañea's material. Do not present this as hers.",
} as const;

/** The platform's own reference material. Every restricted agent can search it. */
const SYSTEM_SCOPE = 'system';

type SearchArgs = Parameters<SearchKnowledgeCapability['execute']>[0];
type SearchResult = Awaited<ReturnType<SearchKnowledgeCapability['execute']>>;

export class LabelledSearchKnowledgeCapability extends SearchKnowledgeCapability {
  async execute(args: SearchArgs, context: CapabilityContext): Promise<SearchResult> {
    const result = await super.execute(args, context);
    if (!result.success || !result.data || result.data.results.length === 0) return result;

    let label: (documentId: string) => string;
    try {
      const agent = await prisma.aiAgent.findUnique({
        where: { id: context.agentId },
        select: { slug: true },
      });
      if (!isCorpusAgent(agent?.slug)) return result;
      const [quotable, platform] = await Promise.all([
        resolveQuotableDocumentIds(),
        prisma.aiKnowledgeDocument.findMany({
          where: {
            id: { in: result.data.results.map((item) => item.documentId) },
            scope: SYSTEM_SCOPE,
          },
          select: { id: true },
        }),
      ]);
      const hers = new Set(quotable);
      const platformIds = new Set(platform.map((doc) => doc.id));
      label = (documentId) =>
        hers.has(documentId)
          ? RESULT_ORIGINS.hers
          : platformIds.has(documentId)
            ? RESULT_ORIGINS.notHers
            : RESULT_ORIGINS.unverified;
    } catch (err) {
      logger.warn('labelled search: could not check origins — marking every result unverified', {
        agentId: context.agentId,
        error: err instanceof Error ? err.message : String(err),
      });
      label = () => RESULT_ORIGINS.unverified;
    }

    return {
      ...result,
      data: {
        ...result.data,
        results: result.data.results.map((item) => ({
          ...item,
          origin: label(item.documentId),
        })),
      },
    };
  }
}
