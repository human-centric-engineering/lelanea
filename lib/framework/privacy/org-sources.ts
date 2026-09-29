/**
 * The framework tier's org-export manifest (§34 f-framework-tenancy, Hub t-134).
 *
 * Sunrise 0.13.0 made every model carrying `orgId` answerable to the org
 * export: `tests/unit/lib/privacy/org-sources.test.ts` parses the schema and
 * fails naming any such model the manifest does not declare. The 19
 * `framework_*` models became tenant-owned in the same change, so each is
 * declared here — reached through the `lib/app/data-export.ts` bridge's
 * `collectAppOrgSources()`, which core's `getOrgDataSources()` pulls on every
 * read (a fork-first seam; see `lib/privacy/org-sources.ts`).
 *
 * **The org export is the org's records, whole.** Everything here is
 * `export` — an offboarding customer is owed its journeys, captured slot
 * values, maps, policies and module configuration — except the one derived
 * artefact, `FrameworkNodeEmbedding`, excluded on the same grounds as core's
 * `AiMessageEmbedding`. None of these tables holds a secret, so no source
 * `omit`s a column; a secret column added later must be `omit`ted here, never
 * dropped by switching to `select`.
 *
 * This differs from the SUBJECT manifest (`export-sources.ts`) on purpose: a
 * data subject receives their own journeys and only attribution for the maps
 * and policies they authored, whereas the org owns all of it.
 *
 * @see lib/privacy/org-sources.ts — core's manifest and the seam
 * @see lib/framework/privacy/export-sources.ts — the per-person counterpart
 */

import { prisma } from '@/lib/db/client';
import type { AppOrgSourceContribution, OrgDataSource } from '@/lib/privacy/org-sources';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { isMultiTenant } from '@/lib/tenancy/context';

/**
 * Core's `ownedBy()` rule, restated from public exports (core keeps its copy
 * private): at `TENANCY_MODE=single` a `NULL` org is the install org's, so the
 * install org's export also carries any row written before the chokepoint
 * stamped it; at `multi` the match is strict and a `NULL` is nobody's.
 */
function ownedBy(orgId: string): { orgId: string } | { OR: [{ orgId: string }, { orgId: null }] } {
  if (orgId === INSTALL_ORG_ID && !isMultiTenant()) return { OR: [{ orgId }, { orgId: null }] };
  return { orgId };
}

const SOURCES: OrgDataSource[] = [
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

/** The framework tier's contribution to the org export. */
export function frameworkOrgSources(): AppOrgSourceContribution {
  return {
    sources: SOURCES,
    excluded: [
      {
        model: 'FrameworkNodeEmbedding',
        reason:
          'Vector embeddings derived from the facilitation maps the export already carries in full; the vector column is Unsupported in Prisma and holds nothing readable.',
      },
    ],
  };
}
