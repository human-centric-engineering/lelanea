/**
 * App knowledge access-contributor registrations — FILLED by Lelañea.
 *
 * **Fork-owned scaffold** — Sunrise ships this empty and does NOT change it
 * after release, so your edits here merge cleanly on upgrade (the stable
 * contract is this file's export, not its body). Treat it like the other
 * `lib/app/*` seams.
 *
 * Auto-wired: `resolveAgentDocumentAccess()` calls this once before it first
 * consults contributors (server route-handler runtime). Add
 * `registerAgentAccessContributor(key, contributor)` calls to widen a
 * **restricted** agent's searchable document set from a relationship your layer
 * owns (module membership, team ACL, per-tenant grant) — composed **live** at
 * resolve time, without materialising grants onto the per-agent pivot or
 * editing the core resolver.
 *
 * Widen-only: contributors run only in the `restricted` branch (a `full` agent
 * is never touched) and can only ADD documents. A contributor that throws is
 * logged and ignored. When the data your contributor reads changes, call
 * `invalidateAgentAccess(agentId)` for the affected agents (the same contract
 * direct grants follow) so the cached decision is re-composed.
 *
 * ## What Lelañea registers, and why it is here rather than in a tag grant
 *
 * One contributor: her designated corpus, for her own agents only (§05 t-25).
 *
 * A document reaches `search_knowledge_base` — the path that can quote it back
 * at someone — only when its purpose is `knowledge` or `both` AND its
 * sensitivity is not `client`. Voice-only material is designated `voice` and is
 * therefore absent from this set entirely; it reaches the prompt through the
 * context contributor instead, labelled by origin, so the model can tell her
 * register from her answers.
 *
 * The rule has to be composed here, per document, because a tag grant cannot
 * express it: `resolveAgentDocumentAccess` UNIONs each granted tag's documents,
 * so granting `purpose-knowledge` would admit a document that also carries
 * `sensitivity-client` — the material the owner deferred. A tag grant would look
 * exactly like this rule and quietly do something else (`B31`).
 *
 * `lib/app/voice/corpus-access.ts` holds the query and the participation test;
 * `lib/app/voice/designation.ts` holds the vocabulary and the rule as a pure
 * function. Pinned in `tests/unit/lib/app/defaults.test.ts` (`HB2`: pin the new
 * value, never delete the row).
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/orchestration/knowledge.md ·
 * .context/app/voice.md
 */

import { registerAgentAccessContributor } from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import { contributeCorpusAccess } from '@/lib/app/voice/corpus-access';

/**
 * The registry key. Exported so the seam's test can assert the registration by
 * name rather than by counting entries — a count passes whether the right
 * contributor is present or a different one is.
 */
export const CORPUS_ACCESS_CONTRIBUTOR = 'lelanea:designated-corpus';

export function initAppKnowledgeAccessContributors(): void {
  registerAgentAccessContributor(CORPUS_ACCESS_CONTRIBUTOR, contributeCorpusAccess);
}
