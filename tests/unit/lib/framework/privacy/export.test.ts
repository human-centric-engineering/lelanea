/**
 * Tests: the framework subject-data collector and the `lib/app/data-export.ts` bridge.
 *
 * The coverage guard next door proves the MANIFEST is complete. This file proves
 * the two things a complete manifest still cannot tell you: that each source
 * actually queries the column it claims to, and that the bridge folds the
 * framework and leaf tiers together without either losing the other.
 *
 * @see lib/framework/privacy/export.ts · lib/app/data-export.ts
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/data-export.ts`, not a mock
 * ---------------------------------------------------------------------------
 * It has to: the bridge is the thing under test in the second describe block —
 * that Daybreak's framework sections reach `app` and that the leaf tier is not
 * lost on the way. A mocked seam would assert the mock.
 *
 * **What a leaf should expect, and what to do.** Filling
 * `lib/app/leaf-data-export.ts` adds your sections to what
 * `collectAppSubjectData()` returns, so the two cases that count keys — "spreads
 * the framework tier's sections directly under `app`" and "contributes nothing
 * leaf-owned by default" — will fail. That second one is asserting emptiness on
 * YOUR behalf, so PIN it: assert your sections alongside the framework's.
 * Deleting either case loses the guarantee that one tier cannot shadow the
 * other's section, which is the failure mode that costs a data subject rows.
 *
 * ---------------------------------------------------------------------------
 * LELAÑEA — the seam is filled, and these cases are pinned exactly as told
 * ---------------------------------------------------------------------------
 * §03 t-7 fills `leaf-data-export.ts` with `AppWaitlistEntry` → the `waitlist`
 * section. Three consequences, all handled below rather than by deleting a case:
 *
 * 1. The Prisma stub gains `appWaitlistEntry`, because the real leaf collector
 *    now runs and queries it. Without it every bridge case fails on
 *    "Cannot read properties of undefined" — which looks like a framework bug
 *    and is not one.
 * 2. The two key-counting cases assert the framework sections PLUS `waitlist`.
 *    The property they still hold, and the one that matters, is that neither
 *    tier shadows the other's section.
 * 3. The declaration case expects the framework models plus ours.
 *
 * A future leaf table adds one entry to `LEAF_SECTIONS` / `LEAF_MODELS` below
 * and nothing else here changes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * One stub delegate per framework model the manifest touches. Each records the
 * args it was called with and returns a single marker row, so a source that
 * queries the wrong column or drops its rows on the floor is visible.
 */
const findMany = {
  userJourney: vi.fn(),
  journeyEvent: vi.fn(),
  slotValue: vi.fn(),
  frameworkJourneyNudge: vi.fn(),
  facilitationGraph: vi.fn(),
  facilitationGraphVersion: vi.fn(),
  facilitationPolicy: vi.fn(),
  structureChangeProposal: vi.fn(),
  moduleVersion: vi.fn(),
  moduleWorkflowBinding: vi.fn(),
  // The eval source reaches the subject by JOIN: conversations first, then evals.
  aiConversation: vi.fn(),
  frameworkConversationEval: vi.fn(),
  // LELAÑEA — the leaf tier's own table, reached through the real leaf seam.
  appWaitlistEntry: vi.fn(),
};

vi.mock('@/lib/db/client', () => ({
  prisma: {
    userJourney: { findMany: (...a: unknown[]) => findMany.userJourney(...a) },
    journeyEvent: { findMany: (...a: unknown[]) => findMany.journeyEvent(...a) },
    slotValue: { findMany: (...a: unknown[]) => findMany.slotValue(...a) },
    frameworkJourneyNudge: { findMany: (...a: unknown[]) => findMany.frameworkJourneyNudge(...a) },
    facilitationGraph: { findMany: (...a: unknown[]) => findMany.facilitationGraph(...a) },
    facilitationGraphVersion: {
      findMany: (...a: unknown[]) => findMany.facilitationGraphVersion(...a),
    },
    facilitationPolicy: { findMany: (...a: unknown[]) => findMany.facilitationPolicy(...a) },
    structureChangeProposal: {
      findMany: (...a: unknown[]) => findMany.structureChangeProposal(...a),
    },
    moduleVersion: { findMany: (...a: unknown[]) => findMany.moduleVersion(...a) },
    moduleWorkflowBinding: { findMany: (...a: unknown[]) => findMany.moduleWorkflowBinding(...a) },
    aiConversation: { findMany: (...a: unknown[]) => findMany.aiConversation(...a) },
    frameworkConversationEval: {
      findMany: (...a: unknown[]) => findMany.frameworkConversationEval(...a),
    },
    appWaitlistEntry: { findMany: (...a: unknown[]) => findMany.appWaitlistEntry(...a) },
  },
}));

const { collectFrameworkSubjectData } = await import('@/lib/framework/privacy/export');
const { FRAMEWORK_SUBJECT_DATA_SOURCES } = await import('@/lib/framework/privacy/export-sources');
const { collectAppSubjectData } = await import('@/lib/app/data-export');

const SUBJECT = { userId: 'user-1', email: 'subject@example.com' };

/** LELAÑEA — what `lib/app/leaf-data-export.ts` contributes to the bridge. */
const LEAF_SECTIONS = ['waitlist'];
const LEAF_MODELS = ['AppWaitlistEntry'];

const NOW = new Date('2026-01-01T00:00:00.000Z');

beforeEach(() => {
  // LELAÑEA — the leaf collector runs for real, so its query needs an answer.
  // Empty rather than a marker row: what the bridge cases below assert is the
  // section KEY, and a leaf row here would only prove the stub returned it.
  findMany.appWaitlistEntry.mockResolvedValue([]);

  // Personal-data sources return rows verbatim.
  findMany.userJourney.mockResolvedValue([{ id: 'j1', graphSlug: 'onboarding' }]);
  findMany.journeyEvent.mockResolvedValue([
    { id: 'e1', type: 'node_entered' },
    // The non-journey engagement event — journeyId null, reachable only by userId.
    { id: 'e2', type: 'module.feedback', journeyId: null, payload: { comment: 'loved it' } },
  ]);
  findMany.slotValue.mockResolvedValue([{ id: 's1', value: 'a captured fact' }]);
  findMany.frameworkJourneyNudge.mockResolvedValue([{ id: 'n1', nodeKey: 'step-2' }]);

  // Attribution sources are narrowed to { id, label, createdAt } by the manifest.
  findMany.facilitationGraph.mockResolvedValue([{ id: 'g1', name: 'Onboarding', createdAt: NOW }]);
  findMany.facilitationGraphVersion.mockResolvedValue([
    { id: 'gv1', version: 3, createdAt: NOW, graph: { slug: 'onboarding' } },
  ]);
  findMany.facilitationPolicy.mockResolvedValue([
    { id: 'p1', kind: 'auto_approval', createdAt: NOW },
  ]);
  findMany.structureChangeProposal.mockResolvedValue([
    { id: 'pr1', subjectType: 'graph', status: 'approved', createdAt: NOW },
  ]);
  findMany.moduleVersion.mockResolvedValue([
    { id: 'mv1', version: 2, createdAt: NOW, module: { slug: 'coaching' } },
  ]);
  findMany.moduleWorkflowBinding.mockResolvedValue([
    { id: 'mw1', eventType: 'completed', createdAt: NOW, module: { slug: 'coaching' } },
  ]);

  findMany.aiConversation.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]);
  findMany.frameworkConversationEval.mockResolvedValue([
    { id: 'ev1', conversationId: 'c1', messageId: 'm1', faithfulness: 0.9, scoredAt: NOW },
  ]);
});

describe('collectFrameworkSubjectData', () => {
  it('returns the subject’s personal framework data in full', async () => {
    const result = await collectFrameworkSubjectData(SUBJECT);

    // Rows come back verbatim — an `export` source must not narrow.
    expect(result.journeys).toEqual([{ id: 'j1', graphSlug: 'onboarding' }]);
    expect(result.slotValues).toEqual([{ id: 's1', value: 'a captured fact' }]);
    expect(result.journeyNudges).toEqual([{ id: 'n1', nodeKey: 'step-2' }]);
  });

  it('includes the non-journey engagement event, which carries the subject’s own words', async () => {
    // The regression this guards: a journeyId-scoped query would drop `e2` — a
    // module.feedback row holding free-text the subject wrote — while still
    // reporting a plausible count for the events it did return.
    const result = await collectFrameworkSubjectData(SUBJECT);

    expect(result.journeyEvents).toHaveLength(2);
    expect(findMany.journeyEvent).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
  });

  it('returns an empty eval section — and asks the eval table nothing — for a subject with no conversations', async () => {
    // The early return is not an optimisation. `conversationId: { in: [] }` is a
    // query Prisma will happily send, and the section would come back empty
    // either way — but the guard is what makes "no conversations" reach the
    // subject as `conversationEvals: []` without a round trip, and it is the one
    // branch of this join-reached source that no other case exercises.
    findMany.aiConversation.mockResolvedValue([]);
    // Call history is not reset between cases in this file — `beforeEach` sets
    // return values, not `clearAllMocks` — so assert against a clean slate
    // rather than against an accumulated count.
    findMany.frameworkConversationEval.mockClear();

    const result = await collectFrameworkSubjectData(SUBJECT);

    expect(result.conversationEvals).toEqual([]);
    expect(Object.hasOwn(result, 'conversationEvals')).toBe(true);
    expect(findMany.frameworkConversationEval).not.toHaveBeenCalled();
  });

  it('scopes conversation evals to the subject’s own conversations', async () => {
    // The regression this guards is the one that matters for a join-reached
    // source: a query that forgot the id filter would hand this subject every
    // eval row in the table — assessments of strangers' conversations — and the
    // section would look perfectly plausible.
    await collectFrameworkSubjectData(SUBJECT);

    expect(findMany.aiConversation).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } })
    );
    expect(findMany.frameworkConversationEval).toHaveBeenCalledWith(
      expect.objectContaining({ where: { conversationId: { in: ['c1', 'c2'] } } })
    );
  });

  it('never returns what a judge call cost the operator', async () => {
    // `costUsd` is the organisation's data, not the subject's: it says what the
    // operator spent, and nothing about the person. The manifest uses `select`,
    // so the guarantee is that the selected shape has no such key.
    await collectFrameworkSubjectData(SUBJECT);

    const calls = findMany.frameworkConversationEval.mock.calls;
    const call = calls[calls.length - 1]?.[0] as {
      select: Record<string, boolean>;
    };
    expect(call.select).not.toHaveProperty('costUsd');
    expect(call.select.judgeReasoning).toBe(true);
  });

  it('nests node states inside the journey that owns them', async () => {
    // UserNodeState holds no user id, so no coverage scan can see it; the only
    // way it reaches the subject is this include.
    await collectFrameworkSubjectData(SUBJECT);

    expect(findMany.userJourney).toHaveBeenCalledWith(
      expect.objectContaining({ include: { nodeStates: true } })
    );
  });

  it('matches personal data on userId, not createdBy', async () => {
    await collectFrameworkSubjectData(SUBJECT);

    for (const delegate of [
      findMany.userJourney,
      findMany.journeyEvent,
      findMany.slotValue,
      findMany.frameworkJourneyNudge,
    ]) {
      expect(delegate).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1' }) })
      );
    }
  });

  it('reduces authored config to id + label + date, never its contents', async () => {
    const result = await collectFrameworkSubjectData(SUBJECT);

    expect(result.facilitationMaps).toEqual([{ id: 'g1', label: 'Onboarding', createdAt: NOW }]);
    expect(result.facilitationMapVersions).toEqual([
      { id: 'gv1', label: 'onboarding v3', createdAt: NOW },
    ]);
    expect(result.moduleWorkflowBindings).toEqual([
      { id: 'mw1', label: 'coaching → completed', createdAt: NOW },
    ]);
  });

  it('never returns a policy’s payload or a proposal’s definition', async () => {
    // These hold organisational config, not the subject's data. The manifest
    // uses `select`, so the guarantee is that the selected shape has no such key.
    const result = await collectFrameworkSubjectData(SUBJECT);

    const serialised = JSON.stringify([
      result.facilitationPolicies,
      result.structureChangeProposals,
    ]);
    expect(serialised).not.toContain('payload');
    expect(serialised).not.toContain('proposedDefinition');
  });

  it('finds proposals the subject reviewed as well as those they raised', async () => {
    // `reviewedBy` is a second SET NULL FK the coverage scan does not flag
    // separately; a createdBy-only query would silently drop every proposal the
    // subject approved or rejected.
    await collectFrameworkSubjectData(SUBJECT);

    expect(findMany.structureChangeProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ createdBy: 'user-1' }, { reviewedBy: 'user-1' }] },
      })
    );
  });

  it('produces exactly one key per declared source, and no others', async () => {
    // The manifest and the collector are two halves of one promise: every
    // declared `section` must appear in what this returns, or `exportUserData()`
    // throws DeclaredAppSourceMissingError. Deriving BOTH from the same constant
    // is what makes that hold, and this is the test that says so — an extra key
    // is a section `meta.app` would never describe, and a missing one is the
    // throw.
    const result = await collectFrameworkSubjectData(SUBJECT);

    expect(Object.keys(result).sort()).toEqual(
      FRAMEWORK_SUBJECT_DATA_SOURCES.map((source) => source.section).sort()
    );
  });

  it('returns an empty array for a source the subject owns nothing in, never omitting the key', async () => {
    // `undefined` counts as missing — JSON.stringify drops the key, so the
    // section would be certified in `meta.app` and absent from what the subject
    // receives. `rows.length ? rows : undefined` is the shape this forbids.
    findMany.slotValue.mockResolvedValue([]);

    const result = await collectFrameworkSubjectData(SUBJECT);

    expect(result.slotValues).toEqual([]);
    expect(Object.hasOwn(result, 'slotValues')).toBe(true);
  });

  it('discloses a narrowing by folding the source’s scopeNote into its declared description', async () => {
    // No framework source narrows TODAY, so this branch would otherwise never
    // run — and it is the one that keeps a narrowed source honest. A source that
    // returns only some of the subject's rows without saying so is the
    // silent-omission failure at row granularity instead of table granularity:
    // the count looks like a complete answer either way.
    //
    // Core's `AppSubjectDataSource` has no `scopeNote` field — only core's own
    // `SubjectDataSource` does — so delegating to the registry would have dropped
    // the note entirely. Folding it into the description is what keeps it in
    // front of the subject, on the one surface (`meta.app`) that reaches them.
    const { FRAMEWORK_SUBJECT_DATA_SOURCES, initFrameworkSubjectSources } =
      await import('@/lib/framework/privacy/export-sources');
    const { getAppSubjectSources, __resetAppSubjectSourceRegistryForTests } =
      await import('@/lib/privacy/subject-source-registry');

    FRAMEWORK_SUBJECT_DATA_SOURCES.push({
      model: 'JourneyEvent',
      section: 'narrowedProbe',
      disposition: 'export',
      description: 'A deliberately narrowed probe source.',
      scopeNote: 'Withholds rows belonging to a third party.',
      fetch: () => Promise.resolve([{ id: 'x' }]),
    });

    try {
      __resetAppSubjectSourceRegistryForTests();
      initFrameworkSubjectSources();
      const declared = getAppSubjectSources();

      const probe = declared.find((entry) => entry.section === 'narrowedProbe');
      expect(probe?.description).toBe(
        'A deliberately narrowed probe source. Withholds rows belonging to a third party.'
      );

      // A source that does NOT narrow must be left exactly as written, so the
      // extra sentence always means something.
      const slots = declared.find((entry) => entry.section === 'slotValues');
      expect(slots?.description).toBe(
        FRAMEWORK_SUBJECT_DATA_SOURCES.find((source) => source.section === 'slotValues')
          ?.description
      );
    } finally {
      FRAMEWORK_SUBJECT_DATA_SOURCES.pop();
      __resetAppSubjectSourceRegistryForTests();
    }
  });

  it('fails the whole export when a source throws, rather than dropping a section', async () => {
    // The deliberate opposite of the erasure path. A swallowed failure here
    // yields a bundle that looks complete and is not.
    findMany.slotValue.mockRejectedValue(new Error('db down'));

    await expect(collectFrameworkSubjectData(SUBJECT)).rejects.toThrow('db down');
  });
});

describe('collectAppSubjectData bridge', () => {
  it('spreads the framework tier’s sections directly under `app`', async () => {
    // The nesting is gone. Daybreak used to fold the tier into a single
    // `app.framework = { meta, personalData, attributions }` key, because core
    // had no way to describe a fork tier's sections and an undescribed section
    // is a bundle whose manifest contradicts its contents. Sunrise 0.10.0 landed
    // that (#533), so the sections sit flat where `meta.app` can name each one.
    const result = await collectAppSubjectData(SUBJECT);

    expect(result).not.toHaveProperty('framework');
    // LELAÑEA: framework sections PLUS the leaf's, flat and side by side. The
    // property this holds either way is that neither tier shadows the other.
    expect(Object.keys(result).sort()).toEqual(
      [...FRAMEWORK_SUBJECT_DATA_SOURCES.map((source) => source.section), ...LEAF_SECTIONS].sort()
    );
    expect(result.slotValues).toEqual([{ id: 's1', value: 'a captured fact' }]);
    expect(result.facilitationMaps).toEqual([{ id: 'g1', label: 'Onboarding', createdAt: NOW }]);
  });

  it('contributes exactly the leaf sections this fork declares, and no others', async () => {
    // PINNED, not deleted. Upstream this reads "contributes nothing leaf-owned
    // by default", because Daybreak keeps `leaf-data-export.ts` reserved-empty.
    // Lelañea filled it, so emptiness is no longer the property — what is still
    // worth holding is that the leaf adds ONLY what it declared, and that a
    // stray section cannot appear without someone deciding on it.
    const result = await collectAppSubjectData(SUBJECT);

    // The doc's own example key, still absent: nothing arrives by accident.
    expect(Object.keys(result)).not.toContain('bookings');
    expect(Object.keys(result)).toHaveLength(
      FRAMEWORK_SUBJECT_DATA_SOURCES.length + LEAF_SECTIONS.length
    );
    for (const section of LEAF_SECTIONS) {
      expect(Object.keys(result)).toContain(section);
    }
  });

  it('declares every framework model to core’s registry — as a source or an exclusion', async () => {
    // The delegation itself. Core's coverage guard diffs `framework-*.prisma`
    // against this registry, so a model that fails to register is not a quiet
    // gap: it fails the suite by name. What this pins is that the bridge routes
    // the framework tier's declarations there at all — a bridge that collected
    // rows but declared nothing would pass every test above and ship a bundle
    // whose manifest described none of it.
    const { initAppSubjectSources } = await import('@/lib/app/data-export');
    const {
      getAppSubjectSources,
      getAppExcludedSubjectSources,
      __resetAppSubjectSourceRegistryForTests,
    } = await import('@/lib/privacy/subject-source-registry');
    const { FRAMEWORK_EXCLUDED_SOURCES } = await import('@/lib/framework/privacy/export-sources');

    __resetAppSubjectSourceRegistryForTests();
    initAppSubjectSources();

    expect(
      getAppSubjectSources()
        .map((entry) => entry.model)
        .sort()
    ).toEqual(
      [...FRAMEWORK_SUBJECT_DATA_SOURCES.map((source) => source.model), ...LEAF_MODELS].sort()
    );
    expect(getAppExcludedSubjectSources()).toEqual(FRAMEWORK_EXCLUDED_SOURCES);

    __resetAppSubjectSourceRegistryForTests();
  });

  it('propagates a framework failure instead of returning a partial bundle', async () => {
    findMany.facilitationGraph.mockRejectedValue(new Error('db down'));

    await expect(collectAppSubjectData(SUBJECT)).rejects.toThrow('db down');
  });
});
