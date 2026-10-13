/**
 * Framework subject-data manifest (GDPR Art. 15) — the framework tier's half of
 * the subject-access export.
 *
 * Sunrise's `lib/privacy/export-sources.ts` covers the PLATFORM's tables and
 * cannot see Daybreak's; `lib/app/data-export.ts` is the seam it exposes for
 * everything it cannot see. Daybreak fills that seam as a bridge (its third,
 * after `bootstrap.ts` and `admin-nav.ts`), and this file is what the bridge
 * collects — every `framework_*` table holding data about a person, with an
 * explicit disposition:
 *
 * - `export`      — the subject's own data, returned in full.
 * - `attribution` — framework config the subject authored: id + label + date.
 *   The config belongs to the organisation; the fact of authorship belongs to
 *   the subject. This is the same reasoning erasure uses when it retains the
 *   row and nulls the link.
 *
 * **The disposition is not a fresh judgement — it mirrors the erasure policy
 * already written into each migration.** A `userId` column with a hand-written
 * `ON DELETE CASCADE` is personal data (it goes when the subject goes), so it
 * exports in full. A `createdBy` column with `ON DELETE SET NULL` is retained
 * config, so it exports as attribution. Keeping the two halves of GDPR agreeing
 * on what a row *is* is the point; if you change one, change the other.
 *
 * **Adding a framework table?** Add it here too. The guard at
 * `tests/unit/lib/framework/privacy/export-sources.test.ts` parses
 * `prisma/schema/framework-*.prisma` and fails until you do — the framework-tier
 * counterpart of the core guard, and for the same reason: erasure fails loudly
 * (a missing `onDelete` throws `P2003`), while an export that omits a table
 * looks exactly like a complete answer to the person reading it.
 *
 * **Never delete a row here to make that test pass.** That ships a silently
 * short answer to a data subject. Exclude it deliberately, with a reason, via
 * `FRAMEWORK_EXCLUDED_SOURCES`.
 *
 * @see lib/privacy/export-sources.ts · lib/app/data-export.ts
 * @see .context/privacy/data-export.md · .context/framework/README.md
 */

import { prisma } from '@/lib/db/client';
import type {
  AttributionRow,
  ExcludedSource,
  SubjectDataSource,
  SubjectQuery,
} from '@/lib/privacy/export-sources';
import { registerAppSubjectSources } from '@/lib/privacy/subject-source-registry';

const byCreatedAt = { createdAt: 'asc' } as const;

/**
 * What a framework source is handed about the subject: the identity core gives
 * the `lib/app/data-export.ts` collector (`AppSubjectQuery`), not core's own
 * `SubjectQuery`. Sunrise 0.14.0 added `emailVerified` to the latter for its
 * by-address `ContactSubmission` source and deliberately keeps it out of the
 * fork collector, so a framework source cannot be typed to need it. Every
 * framework source keys on `userId` anyway.
 */
export type FrameworkSubjectQuery = Pick<SubjectQuery, 'userId' | 'email'>;

/** Core's source shape, reading a {@link FrameworkSubjectQuery}. */
export type FrameworkSubjectDataSource = Omit<SubjectDataSource, 'fetch'> & {
  fetch: (subject: FrameworkSubjectQuery) => Promise<unknown[]>;
};

/**
 * Every `framework_*` model carrying a user id, with its disposition. Ordered
 * personal-data first, then attribution — matching how the core manifest
 * presents its own.
 */
export const FRAMEWORK_SUBJECT_DATA_SOURCES: FrameworkSubjectDataSource[] = [
  // ---------------------------------------------------------------------
  // Personal data — the subject's own records. Every one of these is a
  // `userId` column with a hand-written ON DELETE CASCADE.
  // ---------------------------------------------------------------------
  {
    model: 'UserJourney',
    section: 'journeys',
    disposition: 'export',
    description:
      'Facilitation maps the subject has walked, including their per-node progress states.',
    // `nodeStates` is nested rather than being a source of its own: `UserNodeState`
    // holds no user id (it reaches the subject only through this journey), so the
    // coverage guard cannot see it and it has no way to be exported except here.
    // `events` and `nudges` are NOT nested — they are sources in their own right
    // below, and nesting them too would hand the subject the same rows twice.
    fetch: ({ userId }) =>
      prisma.userJourney.findMany({
        where: { userId },
        include: { nodeStates: true },
        orderBy: { startedAt: 'asc' },
      }),
  },
  {
    model: 'JourneyEvent',
    section: 'journeyEvents',
    disposition: 'export',
    description:
      'Every recorded interaction with the framework — steps taken through a map, and engagement events such as feedback the subject left.',
    // Deliberately matched on `userId` alone, NOT on `journeyId`: an event with a
    // null `journeyId` is a non-journey engagement event (a `module.feedback` row
    // carries the subject's free-text comment), reachable only by this column. A
    // journey-scoped query would silently drop exactly the rows holding the
    // subject's own words.
    fetch: ({ userId }) =>
      prisma.journeyEvent.findMany({ where: { userId }, orderBy: { occurredAt: 'asc' } }),
  },
  {
    model: 'SlotValue',
    section: 'slotValues',
    disposition: 'export',
    description:
      'Facts the framework has captured about the subject from their conversations, including superseded earlier readings and the reasoning recorded for each.',
    // Superseded versions are included on purpose: they are prior statements
    // held about the subject, and Art. 15 covers what is held, not only what is
    // current. `provenance` and `reasoningNote` are how the subject can see WHY
    // a reading was made, so neither is omitted.
    fetch: ({ userId }) =>
      prisma.slotValue.findMany({ where: { userId }, orderBy: { capturedAt: 'asc' } }),
  },
  {
    model: 'FrameworkJourneyNudge',
    section: 'journeyNudges',
    disposition: 'export',
    description:
      'Throttle records of when the framework last nudged the subject toward a next step.',
    fetch: ({ userId }) =>
      prisma.frameworkJourneyNudge.findMany({ where: { userId }, orderBy: { nudgedAt: 'asc' } }),
  },
  {
    model: 'FrameworkConversationEval',
    section: 'conversationEvals',
    disposition: 'export',
    description:
      'Automated quality scores and judge reasoning recorded against the subject’s own conversation turns.',
    // Reached by JOIN, not by a column — `framework_conversation_eval` holds no
    // user id, only `conversationId`. That is precisely the shape the userId /
    // createdBy heuristic cannot see, and it is why the fork tier is held to full
    // accounting rather than run through that scan (Sunrise #533 / 0.10.0): under
    // the old rule this table was invisible and silently absent from every export.
    //
    // It IS the subject's data. These are assessments OF their turns — the judge's
    // reasoning about what they said — and Art. 15 covers an assessment relating to
    // a person as squarely as it covers the words assessed. `costUsd` is deliberately
    // not selected: what the judge calls cost the operator is the organisation's
    // data, not the subject's, and it says nothing about them.
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<unknown[]> => {
      // Two steps, not a nested `where`: `conversationId` is a plain string with
      // no `@relation`, so there is no relation filter to traverse. The framework
      // schema keeps FKs to core tables unmodelled on purpose (see the migrations),
      // which is the same property that made this table invisible to core's scan.
      const conversations = await prisma.aiConversation.findMany({
        where: { userId },
        select: { id: true },
      });
      if (conversations.length === 0) return [];
      return prisma.frameworkConversationEval.findMany({
        where: { conversationId: { in: conversations.map((row) => row.id) } },
        select: {
          id: true,
          conversationId: true,
          messageId: true,
          contextType: true,
          contextId: true,
          faithfulness: true,
          groundedness: true,
          relevance: true,
          rubricScore: true,
          rubricReasoning: true,
          judgeReasoning: true,
          supervisorReport: true,
          scoredAt: true,
        },
        orderBy: { scoredAt: 'asc' },
      });
    },
  },

  // ---------------------------------------------------------------------
  // Attribution — framework config the subject authored. Identity of the
  // thing, never its contents. Every one is a `createdBy` column with a
  // hand-written ON DELETE SET NULL.
  // ---------------------------------------------------------------------
  {
    model: 'FacilitationGraph',
    section: 'facilitationMaps',
    disposition: 'attribution',
    description: 'Facilitation maps the subject created.',
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<AttributionRow[]> => {
      const rows = await prisma.facilitationGraph.findMany({
        where: { createdBy: userId },
        select: { id: true, name: true, createdAt: true },
        orderBy: byCreatedAt,
      });
      return rows.map((row) => ({ id: row.id, label: row.name, createdAt: row.createdAt }));
    },
  },
  {
    model: 'FacilitationGraphVersion',
    section: 'facilitationMapVersions',
    disposition: 'attribution',
    description: 'Facilitation map versions the subject published.',
    // `createdBy` also admits `agent:<slug>` for agent-authored versions; a user
    // id never collides with that prefix, so matching on it needs no filter.
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<AttributionRow[]> => {
      const rows = await prisma.facilitationGraphVersion.findMany({
        where: { createdBy: userId },
        select: { id: true, version: true, createdAt: true, graph: { select: { slug: true } } },
        orderBy: byCreatedAt,
      });
      return rows.map((row) => ({
        id: row.id,
        label: `${row.graph.slug} v${row.version}`,
        createdAt: row.createdAt,
      }));
    },
  },
  {
    model: 'FacilitationPolicy',
    section: 'facilitationPolicies',
    disposition: 'attribution',
    description: 'Governance policies the subject created.',
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<AttributionRow[]> => {
      const rows = await prisma.facilitationPolicy.findMany({
        where: { createdBy: userId },
        select: { id: true, kind: true, createdAt: true },
        orderBy: byCreatedAt,
      });
      return rows.map((row) => ({ id: row.id, label: row.kind, createdAt: row.createdAt }));
    },
  },
  {
    model: 'StructureChangeProposal',
    section: 'structureChangeProposals',
    disposition: 'attribution',
    description: 'Structure-change proposals the subject raised or reviewed.',
    // Matched on BOTH author columns. `reviewedBy` is a second SET NULL FK to
    // `user` that the coverage scan does not flag separately (the model is
    // already declared via `createdBy`), so a `createdBy`-only query would drop
    // every proposal the subject approved or rejected — authorship the subject
    // is equally entitled to see. `createdBy` also admits `agent:<slug>`.
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<AttributionRow[]> => {
      const rows = await prisma.structureChangeProposal.findMany({
        where: { OR: [{ createdBy: userId }, { reviewedBy: userId }] },
        select: { id: true, subjectType: true, status: true, createdAt: true },
        orderBy: byCreatedAt,
      });
      return rows.map((row) => ({
        id: row.id,
        label: `${row.subjectType} (${row.status})`,
        createdAt: row.createdAt,
      }));
    },
  },
  {
    model: 'ModuleVersion',
    section: 'moduleVersions',
    disposition: 'attribution',
    description: 'Module configuration versions the subject published.',
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<AttributionRow[]> => {
      const rows = await prisma.moduleVersion.findMany({
        where: { createdBy: userId },
        select: { id: true, version: true, createdAt: true, module: { select: { slug: true } } },
        orderBy: byCreatedAt,
      });
      return rows.map((row) => ({
        id: row.id,
        label: `${row.module.slug} v${row.version}`,
        createdAt: row.createdAt,
      }));
    },
  },
  {
    model: 'ModuleWorkflowBinding',
    section: 'moduleWorkflowBindings',
    disposition: 'attribution',
    description: 'Module-to-workflow bindings the subject created.',
    fetch: async ({ userId }: FrameworkSubjectQuery): Promise<AttributionRow[]> => {
      const rows = await prisma.moduleWorkflowBinding.findMany({
        where: { createdBy: userId },
        select: { id: true, eventType: true, createdAt: true, module: { select: { slug: true } } },
        orderBy: byCreatedAt,
      });
      return rows.map((row) => ({
        id: row.id,
        label: `${row.module.slug} → ${row.eventType}`,
        createdAt: row.createdAt,
      }));
    },
  },
];

/**
 * Framework models deliberately left out of the export, with the reason the
 * subject is shown.
 *
 * **Every framework model is either here or in the manifest above** — there is
 * no third state. Sunrise 0.10.0 holds a fork tier's schema to full accounting
 * rather than to core's `userId` / `createdBy` heuristic, because core reads its
 * own column vocabulary and cannot read ours: `FrameworkConversationEval` reaches
 * the subject through `conversationId` and was invisible to that scan for exactly
 * as long as the scan was what we relied on.
 *
 * A reason here is disclosed to the data subject verbatim, in the bundle's
 * `meta.excluded`, on the same terms as core's own exclusions. It is what tells
 * them "we hold nothing about you" apart from "we decided not to give it to you",
 * so write it for that reader — not as filing.
 */
export const FRAMEWORK_EXCLUDED_SOURCES: ExcludedSource[] = [
  {
    model: 'UserNodeState',
    reason:
      'The subject’s per-node progress. Not withheld — it is delivered nested inside each row of the `journeys` section, because it holds no user id of its own and reaches the subject only through their journey. Listing it as a source too would hand them the same rows twice.',
  },
  {
    model: 'SlotDefinition',
    reason:
      'The catalogue of what the framework can capture — a slot’s name, meaning and type. Organisation configuration that is identical for every user; the subject’s own captured values are in the `slotValues` section.',
  },
  {
    model: 'FrameworkNodeEmbedding',
    reason:
      'Numeric vectors of facilitation-map node text, used for search. Derived from map content authored by the organisation, not from anything the subject said, and identical for every user.',
  },
  {
    model: 'Module',
    reason:
      'The catalogue of modules the organisation has configured — name, status, availability window. Organisation configuration, identical for every user and holding nothing about the subject.',
  },
  {
    model: 'ModuleAgentBinding',
    reason:
      'Which AI agent staffs which seat in a module. Organisation configuration, identical for every user and holding nothing about the subject.',
  },
  {
    model: 'ModuleKnowledgeDocument',
    reason:
      'A join row pairing a module with a knowledge document. Two identifiers and a timestamp, identical for every user and holding nothing about the subject.',
  },
  {
    model: 'ModuleKnowledgeTag',
    reason:
      'A join row pairing a module with a knowledge tag. Two identifiers and a timestamp, identical for every user and holding nothing about the subject.',
  },
  {
    model: 'FacilitationAgentBinding',
    reason:
      'Which AI agent staffs which facilitation role. Organisation configuration, identical for every user and holding nothing about the subject.',
  },
];

/**
 * Declare the framework tier's models to core's subject-source registry.
 *
 * **This is a delegation, not a new seam.** Daybreak built this manifest
 * fork-first while Sunrise #533 was open, and carried its own coverage guard
 * because core's scanned `framework-*.prisma` against a manifest only core could
 * write to. Sunrise 0.10.0 landed the resolver — `registerAppSubjectSources()` —
 * so the declarations now live in core's registry and core's guard, `meta.app`
 * and `meta.excluded` do the work this file's own `meta` block used to.
 *
 * Derived from the two constants above rather than hand-listed. A second literal
 * list is a second place to edit every time the framework gains a table, and the
 * two drift apart the first time someone forgets — which is the exact failure the
 * coverage guard exists to catch, reintroduced one layer up.
 *
 * **Called from the leaf's `initAppSubjectSources()` in `lib/app/data-export.ts`,
 * NOT from `initFramework()` at boot.** Core's registry re-runs only the lazy
 * `lib/app/*` seam, so a contribution registered at boot is lost the moment
 * anything resets the registry — the coverage guard does exactly that — and never
 * comes back. Upstream documents this; it is the same bridge shape as
 * `bootstrap.ts` → `initFramework()`.
 *
 * @see lib/privacy/subject-source-registry.ts · lib/app/data-export.ts
 */
export function initFrameworkSubjectSources(): void {
  registerAppSubjectSources({
    tier: 'framework',
    sources: FRAMEWORK_SUBJECT_DATA_SOURCES.map((source) => ({
      model: source.model,
      section: source.section,
      disposition: source.disposition,
      // `scopeNote` is FOLDED INTO the description, not dropped. Core's
      // `AppSubjectDataSource` carries no `scopeNote` — that field exists only on
      // core's own `SubjectDataSource`, and `meta.app` has nowhere to put it. A
      // scope note says the subject received only SOME of their rows and why;
      // losing it turns a partial answer into one that reads as complete, which
      // is the same silent-omission failure as a missing section, at row
      // granularity. Folding keeps it in front of the subject on the one surface
      // that reaches them. Filed upstream — see .context/framework/upstream-asks.md.
      //
      // No framework source narrows today, so this is a guard against the next
      // one being written rather than live behaviour.
      description: source.scopeNote
        ? `${source.description} ${source.scopeNote}`
        : source.description,
    })),
    excluded: FRAMEWORK_EXCLUDED_SOURCES,
  });
}
