/**
 * Leaf-app org-export sources — FILLED by Lelañea.
 *
 * A leaf app (a fork of Daybreak) declares here the models of its own that carry `orgId`, so an
 * organisation's data export includes them (Sunrise §109; guide: `.context/privacy/org-export.md`,
 * "Fork tables"). Daybreak keeps this empty: it is the leaf's seam, reserved so a leaf's
 * declarations merge cleanly on upgrade — the org-export analogue of `lib/app/leaf-data-export.ts`.
 *
 * Called by `lib/app/org-export.ts`'s `initAppOrgSources()` AFTER the framework tier registers its
 * own (`lib/framework/privacy/org-sources.ts`, 18 sources and one exclusion — worked examples of
 * the shape). `tests/unit/lib/privacy/org-sources.test.ts` scans every schema file, yours included,
 * and fails naming any `orgId` model no tier declares: declare each as a source, or as an exclusion
 * with the reason the reader is shown.
 *
 * ```ts
 * import { prisma } from '@/lib/db/client';
 * import { ownedBy } from '@/lib/privacy/org-sources';
 * import { registerAppOrgSources, type AppOrgDataSource } from '@/lib/privacy/org-source-registry';
 *
 * export function initLeafOrgSources(): void {
 *   registerAppOrgSources({
 *     tier: 'app',
 *     sources: [
 *       {
 *         model: 'AppContract',
 *         section: 'contracts',
 *         disposition: 'export',
 *         description: 'Contracts the organisation holds with its clients.',
 *         fetch: ({ orgId }) =>
 *           prisma.appContract.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
 *       },
 *     ],
 *   });
 * }
 * ```
 *
 * **A throwing init takes the framework's declarations down with yours.** Core runs this and the
 * framework's registration as one unit and rolls the whole unit back on a throw (logged at error),
 * after which `exportOrgData()` refuses every org until it is fixed. A row the registry rejects —
 * a short description, a section or model another tier already declared — is dropped and logged
 * instead, and the export refuses only if that leaves a model undeclared.
 *
 * Register synchronously: this function must not be `async`.
 *
 * @see lib/app/org-export.ts · lib/privacy/org-source-registry.ts · CUSTOMIZATION.md §4
 */

import { prisma } from '@/lib/db/client';
import { ownedBy } from '@/lib/privacy/org-sources';
import { registerAppOrgSources, type AppOrgDataSource } from '@/lib/privacy/org-source-registry';
import { listMemoryEntriesForOrg } from '@/lib/app/memory/memory-index';
import { listJourneyEntriesForOrg } from '@/lib/app/journey-record/record';

/**
 * Every Lelañea table is the org's own data (t-112): its content, its members'
 * records and the history of both. None is left out, and none holds a secret
 * to omit. A module constant, as Daybreak's manifest is, so every registration
 * hands over the same sources.
 */
export const LEAF_ORG_SOURCES: readonly AppOrgDataSource[] = [
  {
    model: 'AppWaitlistEntry',
    section: 'appWaitlist',
    disposition: 'export',
    description: 'Everyone who joined the waitlist, and what became of their place on it.',
    fetch: ({ orgId }) =>
      prisma.appWaitlistEntry.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppAcknowledgement',
    section: 'appAcknowledgements',
    disposition: 'export',
    description: 'Which version of each founding document each member acknowledged, and when.',
    fetch: ({ orgId }) =>
      prisma.appAcknowledgement.findMany({
        where: ownedBy(orgId),
        orderBy: { acknowledgedAt: 'asc' },
      }),
  },
  {
    model: 'AppUserBudget',
    section: 'appUserBudgets',
    disposition: 'export',
    description: 'Monthly spending limits an admin set for individual members.',
    fetch: ({ orgId }) =>
      prisma.appUserBudget.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppTurn',
    section: 'appTurns',
    disposition: 'export',
    description:
      'One record per conversation turn: which model and version answered, what it cost, and the session it fell in.',
    fetch: ({ orgId }) =>
      prisma.appTurn.findMany({ where: ownedBy(orgId), orderBy: { startedAt: 'asc' } }),
  },
  {
    model: 'AppTurnSlotWrite',
    section: 'appTurnSlotWrites',
    disposition: 'export',
    description: 'Which data slots each turn wrote, one row per slot.',
    fetch: ({ orgId }) =>
      prisma.appTurnSlotWrite.findMany({
        where: ownedBy(orgId),
        orderBy: { writtenAt: 'asc' },
      }),
  },
  {
    // f-memory t-129. Read through the index module, the only code that touches
    // the table, and never the vectors.
    model: 'AppMemoryEmbedding',
    section: 'appMemoryEmbeddings',
    disposition: 'export',
    description:
      'Which of each member’s messages, notes and kept journey entries are in the memory index, when and by which model. Not the vectors, and no words.',
    fetch: ({ orgId }) => listMemoryEntriesForOrg(orgId),
  },
  {
    // f-journey-record t-145. Read through the record module, the only code
    // that touches the table.
    model: 'AppJourneyEntry',
    section: 'appJourneyEntries',
    disposition: 'export',
    description:
      'Each member’s journey record: kept and draft session synopses, and the entries they wrote themselves.',
    fetch: ({ orgId }) => listJourneyEntriesForOrg(orgId),
  },
  {
    model: 'AppSafetyEvent',
    section: 'appSafetyEvents',
    disposition: 'export',
    description:
      'Each time the crisis path answered a member. The words that triggered it are never stored.',
    fetch: ({ orgId }) =>
      prisma.appSafetyEvent.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppAgentSettings',
    section: 'appAgentSettings',
    disposition: 'export',
    description: 'The agent’s deadlines and the default monthly limit.',
    fetch: ({ orgId }) =>
      prisma.appAgentSettings.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppCrisisCopy',
    section: 'appCrisisCopy',
    disposition: 'export',
    description: 'The crisis resource’s wording and its sign-off state.',
    fetch: ({ orgId }) =>
      prisma.appCrisisCopy.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppCrisisRegion',
    section: 'appCrisisRegions',
    disposition: 'export',
    description: 'The crisis helplines, one row per country or region.',
    fetch: ({ orgId }) =>
      prisma.appCrisisRegion.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppSlotDefinition',
    section: 'appSlotDefinitions',
    disposition: 'export',
    description: 'The taxonomy of what the agent may learn about a member.',
    fetch: ({ orgId }) =>
      prisma.appSlotDefinition.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppSlotDefinitionRevision',
    section: 'appSlotDefinitionRevisions',
    disposition: 'export',
    description: 'Every change to the slot taxonomy, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appSlotDefinitionRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppKnowledgeDesignation',
    section: 'appKnowledgeDesignations',
    disposition: 'export',
    description: 'What each uploaded document is for, and on what terms the agent may use it.',
    fetch: ({ orgId }) =>
      prisma.appKnowledgeDesignation.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppDocumentCollection',
    section: 'appDocumentCollections',
    disposition: 'export',
    description: 'The collection the founding documents belong to.',
    fetch: ({ orgId }) =>
      prisma.appDocumentCollection.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppFoundationalDocument',
    section: 'appFoundationalDocuments',
    disposition: 'export',
    description:
      'The founding documents: mission, about, the app, welcome, disclaimer, terms and data.',
    fetch: ({ orgId }) =>
      prisma.appFoundationalDocument.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppFoundationalDocumentRevision',
    section: 'appFoundationalDocumentRevisions',
    disposition: 'export',
    description: 'Every edit to a founding document, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appFoundationalDocumentRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppJourney',
    section: 'appJourneys',
    disposition: 'export',
    description: 'The journey the modules are arranged in.',
    fetch: ({ orgId }) =>
      prisma.appJourney.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppJourneyTier',
    section: 'appJourneyTiers',
    disposition: 'export',
    description: 'The journey’s tiers: their labels and intent.',
    fetch: ({ orgId }) =>
      prisma.appJourneyTier.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppJourneyTierRevision',
    section: 'appJourneyTierRevisions',
    disposition: 'export',
    description: 'Every edit to a tier’s text, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appJourneyTierRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppJourneyModule',
    section: 'appJourneyModules',
    disposition: 'export',
    description: 'Each module’s title, subtitle and phases.',
    fetch: ({ orgId }) =>
      prisma.appJourneyModule.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppJourneyModuleRevision',
    section: 'appJourneyModuleRevisions',
    disposition: 'export',
    description: 'Every edit to a module’s text, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appJourneyModuleRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppQuestionSet',
    section: 'appQuestionSets',
    disposition: 'export',
    description: 'The set of discovery questions Onboarding asks.',
    fetch: ({ orgId }) =>
      prisma.appQuestionSet.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppQuestionSetRevision',
    section: 'appQuestionSetRevisions',
    disposition: 'export',
    description: 'Every edit to the question set, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appQuestionSetRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppDiscoveryQuestion',
    section: 'appDiscoveryQuestions',
    disposition: 'export',
    description: 'The discovery questions, their hints and their weights.',
    fetch: ({ orgId }) =>
      prisma.appDiscoveryQuestion.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppDiscoveryQuestionRevision',
    section: 'appDiscoveryQuestionRevisions',
    disposition: 'export',
    description: 'Every edit to a discovery question, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appDiscoveryQuestionRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppResourceCollection',
    section: 'appResourceCollections',
    disposition: 'export',
    description: 'The collection of resources the drawer offers, and its sign-off state.',
    fetch: ({ orgId }) =>
      prisma.appResourceCollection.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppResource',
    section: 'appResources',
    disposition: 'export',
    description: 'The videos, audio and articles the drawer and the agent offer.',
    fetch: ({ orgId }) =>
      prisma.appResource.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppResourceRevision',
    section: 'appResourceRevisions',
    disposition: 'export',
    description: 'Every edit to a resource, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appResourceRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppResourceWords',
    section: 'appResourceWords',
    disposition: 'export',
    description: 'The passages in her own words shown beside each module.',
    fetch: ({ orgId }) =>
      prisma.appResourceWords.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppResourceWordsRevision',
    section: 'appResourceWordsRevisions',
    disposition: 'export',
    description: 'Every edit to a passage, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appResourceWordsRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceOverlaySet',
    section: 'appVoiceOverlaySets',
    disposition: 'export',
    description: 'The set of voice overlays and its sign-off state.',
    fetch: ({ orgId }) =>
      prisma.appVoiceOverlaySet.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceOverlaySetRevision',
    section: 'appVoiceOverlaySetRevisions',
    disposition: 'export',
    description: 'Every edit to the overlay set, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appVoiceOverlaySetRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceOverlay',
    section: 'appVoiceOverlays',
    disposition: 'export',
    description: 'The register the agent takes for each situation.',
    fetch: ({ orgId }) =>
      prisma.appVoiceOverlay.findMany({ where: ownedBy(orgId), orderBy: { createdAt: 'asc' } }),
  },
  {
    model: 'AppVoiceOverlayRevision',
    section: 'appVoiceOverlayRevisions',
    disposition: 'export',
    description: 'Every edit to an overlay, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appVoiceOverlayRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceGoldenSet',
    section: 'appVoiceGoldenSets',
    disposition: 'export',
    description: 'The golden set of prompts her voice is measured against.',
    fetch: ({ orgId }) =>
      prisma.appVoiceGoldenSet.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceGoldenSetRevision',
    section: 'appVoiceGoldenSetRevisions',
    disposition: 'export',
    description: 'Every edit to the golden set, with who made it.',
    fetch: ({ orgId }) =>
      prisma.appVoiceGoldenSetRevision.findMany({
        where: ownedBy(orgId),
        orderBy: { changedAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceComparison',
    section: 'appVoiceComparisons',
    disposition: 'export',
    description: 'Each comparison run of her voice against the control.',
    fetch: ({ orgId }) =>
      prisma.appVoiceComparison.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
  {
    model: 'AppVoiceComparisonArm',
    section: 'appVoiceComparisonArms',
    disposition: 'export',
    description: 'The two sides of each voice comparison and what they were told.',
    fetch: ({ orgId }) =>
      prisma.appVoiceComparisonArm.findMany({
        where: ownedBy(orgId),
        orderBy: { createdAt: 'asc' },
      }),
  },
];

/**
 * Declare all of ours (`LEAF_ORG_SOURCES` above), after the framework tier's. Moved
 * here from `leafOrgSources()` in `lib/app/leaf-data-export.ts` on the Daybreak
 * 0.9.0 sync (t-174), when Sunrise §109 shipped the seam that one stood in for.
 */
export function initLeafOrgSources(): void {
  registerAppOrgSources({ tier: 'app', sources: LEAF_ORG_SOURCES });
}
