/**
 * The framework tier's org-export manifest (§34 f-framework-tenancy, Hub t-134).
 *
 * Sunrise 0.13.0 made every model carrying `orgId` answerable to the org
 * export: `tests/unit/lib/privacy/org-sources.test.ts` parses the schema and
 * fails naming any such model no tier declares. The 19 `framework_*` models
 * became tenant-owned in the same change, so each is declared here and
 * registered with core's org-source registry by {@link initFrameworkOrgSources},
 * which the `lib/app/org-export.ts` bridge calls from core's lazy
 * `initAppOrgSources()` seam (Sunrise 0.15.0, §109 t-737). Registering from
 * `initFramework()` at boot would be lost the first time the registry resets.
 *
 * **The org export is the org's records, whole.** Everything here is
 * `export` — an offboarding customer is owed its journeys, captured slot
 * values, maps, policies and module configuration — except the one derived
 * artefact, `FrameworkNodeEmbedding`, excluded on the same grounds as core's
 * `AiMessageEmbedding`. None of these tables holds a secret, so no source
 * `omit`s a column; a secret column added later must be `omit`ted here, never
 * dropped by switching to `select`.
 *
 * The rows land under the bundle's `app` key, by `section`, with a summary in
 * `meta.app` — core's shape for every fork tier, so no core section can ever
 * collide with a framework one.
 *
 * This differs from the SUBJECT manifest (`export-sources.ts`) on purpose: a
 * data subject receives their own journeys and only attribution for the maps
 * and policies they authored, whereas the org owns all of it.
 *
 * @see lib/privacy/org-source-registry.ts — core's registry and its rules
 * @see lib/framework/privacy/export-sources.ts — the per-person counterpart
 */

import { prisma } from '@/lib/db/client';
import { ownedBy } from '@/lib/privacy/org-sources';
import {
  registerAppOrgSources,
  type AppExcludedOrgSource,
  type AppOrgDataSource,
} from '@/lib/privacy/org-source-registry';

export const FRAMEWORK_ORG_DATA_SOURCES: readonly AppOrgDataSource[] = [
  // ── Journeys and what they captured ──
  {
    model: 'UserJourney',
    section: 'journeys',
    disposition: 'export',
    description: 'Every member’s journeys through the organisation’s facilitation maps.',
    fetch: ({ orgId }) =>
      prisma.userJourney.findMany({ where: ownedBy(orgId), orderBy: { startedAt: 'asc' } }),
  },
  {
    model: 'UserNodeState',
    section: 'journeyNodeStates',
    disposition: 'export',
    description: 'Per-node progress within each journey: entered, active and completed times.',
    fetch: ({ orgId }) =>
      prisma.userNodeState.findMany({
        where: ownedBy(orgId),
        orderBy: { firstEnteredAt: 'asc' },
      }),
  },
  {
    model: 'JourneyEvent',
    section: 'journeyEvents',
    disposition: 'export',
    description: 'The engagement event stream recorded against members’ journeys and modules.',
    fetch: ({ orgId }) =>
      prisma.journeyEvent.findMany({ where: ownedBy(orgId), orderBy: { occurredAt: 'asc' } }),
  },
  {
    model: 'FrameworkJourneyNudge',
    section: 'journeyNudges',
    disposition: 'export',
    description: 'The proactive-guidance throttle row for each journey that has been nudged.',
    fetch: ({ orgId }) =>
      prisma.frameworkJourneyNudge.findMany({
        where: ownedBy(orgId),
        orderBy: { nudgedAt: 'asc' },
      }),
  },
  {
    model: 'SlotValue',
    section: 'slotValues',
    disposition: 'export',
    description: 'Every captured slot value, all versions, with provenance.',
    fetch: ({ orgId }) =>
      prisma.slotValue.findMany({ where: ownedBy(orgId), orderBy: { capturedAt: 'asc' } }),
  },
  {
    model: 'FrameworkConversationEval',
    section: 'conversationEvals',
    disposition: 'export',
    description: 'Quality scores and judge reasoning for facilitation conversation turns.',
    fetch: ({ orgId }) =>
      prisma.frameworkConversationEval.findMany({
        where: ownedBy(orgId),
        orderBy: { scoredAt: 'asc' },
      }),
  },
  // ── Facilitation configuration ──
  {
    model: 'FacilitationGraph',
    section: 'facilitationMaps',
    disposition: 'export',
    description: 'The organisation’s facilitation maps and which version of each is published.',
    fetch: ({ orgId }) =>
      prisma.facilitationGraph.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'FacilitationGraphVersion',
    section: 'facilitationMapVersions',
    disposition: 'export',
    description: 'Every saved version of every facilitation map, drafts included.',
    fetch: ({ orgId }) =>
      prisma.facilitationGraphVersion.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'FacilitationPolicy',
    section: 'facilitationPolicies',
    disposition: 'export',
    description: 'Typed facilitation policies the organisation has configured.',
    fetch: ({ orgId }) =>
      prisma.facilitationPolicy.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'FacilitationAgentBinding',
    section: 'facilitationAgentBindings',
    disposition: 'export',
    description: 'Which agent fills each facilitation role for the organisation.',
    fetch: ({ orgId }) =>
      prisma.facilitationAgentBinding.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'StructureChangeProposal',
    section: 'structureChangeProposals',
    disposition: 'export',
    description:
      'Proposed changes to the organisation’s maps and modules, and their review outcome.',
    fetch: ({ orgId }) =>
      prisma.structureChangeProposal.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  // ── Modules and slot definitions ──
  {
    model: 'Module',
    section: 'modules',
    disposition: 'export',
    description: 'The organisation’s module settings: status, availability, audience and config.',
    fetch: ({ orgId }) =>
      prisma.module.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'ModuleVersion',
    section: 'moduleVersions',
    disposition: 'export',
    description: 'Every saved version of each module’s configuration.',
    fetch: ({ orgId }) =>
      prisma.moduleVersion.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'ModuleAgentBinding',
    section: 'moduleAgentBindings',
    disposition: 'export',
    description: 'Which agents are bound to each module, and in which role.',
    fetch: ({ orgId }) =>
      prisma.moduleAgentBinding.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'ModuleWorkflowBinding',
    section: 'moduleWorkflowBindings',
    disposition: 'export',
    description: 'Which workflows each module triggers, and on which events.',
    fetch: ({ orgId }) =>
      prisma.moduleWorkflowBinding.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'ModuleKnowledgeDocument',
    section: 'moduleKnowledgeDocuments',
    disposition: 'export',
    description: 'Knowledge documents granted to each module.',
    fetch: ({ orgId }) =>
      prisma.moduleKnowledgeDocument.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'ModuleKnowledgeTag',
    section: 'moduleKnowledgeTags',
    disposition: 'export',
    description: 'Knowledge tags granted to each module.',
    fetch: ({ orgId }) =>
      prisma.moduleKnowledgeTag.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'SlotDefinition',
    section: 'slotDefinitions',
    disposition: 'export',
    description: 'The slot definitions in force for the organisation, including deactivated ones.',
    fetch: ({ orgId }) =>
      prisma.slotDefinition.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
];

/** The framework models deliberately left out of the org export, each with the reason shown. */
export const FRAMEWORK_ORG_EXCLUDED_SOURCES: readonly AppExcludedOrgSource[] = [
  {
    model: 'FrameworkNodeEmbedding',
    reason:
      'Vector embeddings derived from the facilitation maps the export already carries in full; the vector column is Unsupported in Prisma and holds nothing readable.',
  },
];

/**
 * Register the framework's org-export declarations with core's registry.
 *
 * Synchronous, as core's seam requires. Called only from the
 * `lib/app/org-export.ts` bridge, inside core's init gate: if the leaf hook
 * called after it throws, the gate rolls back these registrations too and
 * `exportOrgData()` refuses every org until the leaf is fixed.
 */
export function initFrameworkOrgSources(): void {
  registerAppOrgSources({
    tier: 'framework',
    sources: FRAMEWORK_ORG_DATA_SOURCES,
    excluded: FRAMEWORK_ORG_EXCLUDED_SOURCES,
  });
}
