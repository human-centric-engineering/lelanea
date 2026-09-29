/**
 * The org-export seam Daybreak carries in core (Hub t-134, §34 f-framework-tenancy).
 *
 * Two properties, each the reason the seam is safe to carry:
 *
 *   1. **Behaviour-neutral at rest** (B19). With an empty contribution from the
 *      `lib/app/data-export.ts` bridge, `getOrgDataSources()` /
 *      `getOrgExcludedSources()` return exactly core's `ORG_DATA_SOURCES` /
 *      `ORG_EXCLUDED_SOURCES` — same entries, same order — so vanilla Sunrise
 *      behaviour is unchanged by the seam existing.
 *   2. **The framework's contribution arrives, after core's.** The real bridge
 *      delivers the framework tier's 18 sources and one exclusion, appended to
 *      core's, and every framework model is declared exactly once.
 *
 * The per-source rules (scoped by org, stable order, full rows) are enforced for
 * the framework's entries by core's own coverage guard,
 * `tests/unit/lib/privacy/org-sources.test.ts`, which reads through these getters.
 *
 * @see lib/privacy/org-sources.ts — the seam
 * @see lib/framework/privacy/org-sources.ts — the framework's contribution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const contribution = vi.hoisted(() => ({
  current: null as null | { sources: unknown[]; excluded: unknown[] },
}));

const prismaMock = vi.hoisted(() => ({
  userJourney: { findMany: vi.fn().mockResolvedValue([]) },
}));
const multi = vi.hoisted(() => ({ on: false }));

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/tenancy/context', () => ({ isMultiTenant: () => multi.on }));
vi.mock('@/lib/app/data-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/data-export')>();
  return {
    ...actual,
    collectAppOrgSources: () => contribution.current ?? actual.collectAppOrgSources(),
  };
});

const { ORG_DATA_SOURCES, ORG_EXCLUDED_SOURCES, getOrgDataSources, getOrgExcludedSources } =
  await import('@/lib/privacy/org-sources');
const { frameworkOrgSources } = await import('@/lib/framework/privacy/org-sources');

const FRAMEWORK_MODELS = [
  'SlotDefinition',
  'SlotValue',
  'FacilitationGraph',
  'FacilitationGraphVersion',
  'UserJourney',
  'UserNodeState',
  'JourneyEvent',
  'FacilitationAgentBinding',
  'FacilitationPolicy',
  'StructureChangeProposal',
  'FrameworkConversationEval',
  'FrameworkNodeEmbedding',
  'FrameworkJourneyNudge',
  'Module',
  'ModuleVersion',
  'ModuleKnowledgeDocument',
  'ModuleKnowledgeTag',
  'ModuleWorkflowBinding',
  'ModuleAgentBinding',
];

beforeEach(() => {
  contribution.current = null;
  multi.on = false;
  prismaMock.userJourney.findMany.mockClear();
});

describe('the org-export seam, at rest', () => {
  it('returns exactly core’s sources, in order, when the bridge contributes nothing', () => {
    contribution.current = { sources: [], excluded: [] };
    expect(getOrgDataSources()).toEqual(ORG_DATA_SOURCES);
    expect(getOrgDataSources().map((s) => s.model)).toEqual(ORG_DATA_SOURCES.map((s) => s.model));
  });

  it('returns exactly core’s exclusions when the bridge contributes nothing', () => {
    contribution.current = { sources: [], excluded: [] };
    expect(getOrgExcludedSources()).toEqual(ORG_EXCLUDED_SOURCES);
  });

  it('never mutates core’s lists when a contribution is appended', () => {
    const coreSources = ORG_DATA_SOURCES.length;
    const coreExcluded = ORG_EXCLUDED_SOURCES.length;
    getOrgDataSources();
    getOrgExcludedSources();
    expect(ORG_DATA_SOURCES).toHaveLength(coreSources);
    expect(ORG_EXCLUDED_SOURCES).toHaveLength(coreExcluded);
  });
});

describe('the framework’s contribution, through the real bridge', () => {
  it('appends the framework’s sources after core’s', () => {
    const all = getOrgDataSources();
    expect(all.slice(0, ORG_DATA_SOURCES.length)).toEqual(ORG_DATA_SOURCES);
    expect(all.slice(ORG_DATA_SOURCES.length)).toEqual(frameworkOrgSources().sources);
  });

  it('declares every framework model exactly once, as a source or an exclusion', () => {
    const { sources, excluded } = frameworkOrgSources();
    const declared = [...sources.map((s) => s.model), ...excluded.map((e) => e.model)];
    expect([...declared].sort()).toEqual([...FRAMEWORK_MODELS].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('exports every framework table in full except the derived node embeddings', () => {
    const { sources, excluded } = frameworkOrgSources();
    expect(sources.every((s) => s.disposition === 'export')).toBe(true);
    expect(excluded.map((e) => e.model)).toEqual(['FrameworkNodeEmbedding']);
    expect(getOrgExcludedSources().map((e) => e.model)).toContain('FrameworkNodeEmbedding');
  });
});

describe('which rows an org owns (core’s ownedBy rule, restated)', () => {
  const journeys = () => {
    const source = frameworkOrgSources().sources.find((s) => s.model === 'UserJourney');
    if (!source) throw new Error('UserJourney source missing');
    return source;
  };
  const whereOfLastCall = () =>
    (prismaMock.userJourney.findMany.mock.calls.at(-1)?.[0] as { where: unknown }).where;

  it('gives the install org its NULL-org rows at single (written before the chokepoint stamped them)', async () => {
    await journeys().fetch({ orgId: 'install' });
    expect(whereOfLastCall()).toEqual({ OR: [{ orgId: 'install' }, { orgId: null }] });
  });

  it('scopes any other org strictly at single', async () => {
    await journeys().fetch({ orgId: 'cmorg000000000000000other' });
    expect(whereOfLastCall()).toEqual({ orgId: 'cmorg000000000000000other' });
  });

  it('scopes even the install org strictly at multi, where a NULL org is nobody’s', async () => {
    multi.on = true;
    await journeys().fetch({ orgId: 'install' });
    expect(whereOfLastCall()).toEqual({ orgId: 'install' });
  });
});
