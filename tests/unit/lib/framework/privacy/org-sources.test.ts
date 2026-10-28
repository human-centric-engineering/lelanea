/**
 * The framework tier's org-export declarations, and the bridge that registers them.
 *
 * Three properties:
 *
 *   1. **Every framework model is declared exactly once** — 18 sources the org
 *      receives in full and one exclusion, the derived node embeddings.
 *   2. **The `lib/app/org-export.ts` bridge lands them in core's registry**
 *      under the real lazy init, so `exportOrgData()` and core's coverage
 *      guard (`tests/unit/lib/privacy/org-sources.test.ts`) both see them.
 *   3. **A throwing leaf init rolls the framework's declarations back too**, and
 *      the export then refuses — the failure the bridge and leaf seam document.
 *
 * @see lib/framework/privacy/org-sources.ts — the declarations
 * @see lib/app/org-export.ts — the bridge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// A delegate per model on demand, so every framework source's `fetch` can run against it.
const prismaMock = vi.hoisted(() => {
  const delegates: Record<string, { findMany: ReturnType<typeof vi.fn> }> = {};
  return new Proxy(delegates, {
    get: (target, key: string) => (target[key] ??= { findMany: vi.fn().mockResolvedValue([]) }),
  });
});
const multi = vi.hoisted(() => ({ on: false }));
const leaf = vi.hoisted(() => ({ init: (): void => undefined }));

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/tenancy/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/context')>()),
  isMultiTenant: () => multi.on,
}));
vi.mock('@/lib/logging', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/app/leaf-org-export', () => ({ initLeafOrgSources: () => leaf.init() }));

const { FRAMEWORK_ORG_DATA_SOURCES, FRAMEWORK_ORG_EXCLUDED_SOURCES } =
  await import('@/lib/framework/privacy/org-sources');
const {
  getAppOrgSources,
  getAppExcludedOrgSources,
  getAccountedAppOrgModels,
  appOrgDeclarationsFailed,
  registerAppOrgSources,
  __resetAppOrgSourceRegistryForTests,
} = await import('@/lib/privacy/org-source-registry');

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
  __resetAppOrgSourceRegistryForTests();
  leaf.init = () => undefined;
  multi.on = false;
  vi.clearAllMocks();
});

describe('the framework’s declarations', () => {
  it('declares every framework model exactly once, as a source or an exclusion', () => {
    const declared = [
      ...FRAMEWORK_ORG_DATA_SOURCES.map((s) => s.model),
      ...FRAMEWORK_ORG_EXCLUDED_SOURCES.map((e) => e.model),
    ];
    expect([...declared].sort()).toEqual([...FRAMEWORK_MODELS].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  it('exports every framework table in full except the derived node embeddings', () => {
    expect(FRAMEWORK_ORG_DATA_SOURCES).toHaveLength(18);
    expect(FRAMEWORK_ORG_DATA_SOURCES.every((s) => s.disposition === 'export')).toBe(true);
    expect(FRAMEWORK_ORG_EXCLUDED_SOURCES.map((e) => e.model)).toEqual(['FrameworkNodeEmbedding']);
  });
});

describe('each source’s query', () => {
  // Core's org-sources guard holds only core's sources to these rules (a fork's `fetch` has no
  // core delegate behind it), so the framework's are held to them here.
  const lowerFirst = (name: string) => name[0].toLowerCase() + name.slice(1);

  it.each(FRAMEWORK_ORG_DATA_SOURCES.map((source) => [source.model, source] as const))(
    '%s: reads its own table, scoped by the org, in a stable order, as full rows',
    async (model, source) => {
      await source.fetch({ orgId: 'cmorg000000000000000other' });
      const delegate = prismaMock[lowerFirst(model)];
      expect(delegate.findMany).toHaveBeenCalledTimes(1);
      const args = delegate.findMany.mock.calls[0][0] as {
        where?: unknown;
        orderBy?: unknown;
        select?: unknown;
        omit?: unknown;
      };
      expect(args.where).toEqual({ orgId: 'cmorg000000000000000other' });
      expect(args.orderBy).toBeDefined();
      // `export` means full rows: a `select` would silently drop a column added tomorrow.
      expect(args.select).toBeUndefined();
      // No framework table holds a secret today; one that does must `omit` it, and this fails.
      expect(args.omit).toBeUndefined();
    }
  );
});

describe('through the real bridge', () => {
  it('registers the framework’s sources and exclusion with core’s registry, unchanged', () => {
    expect(getAppOrgSources()).toEqual([...FRAMEWORK_ORG_DATA_SOURCES]);
    expect(getAppExcludedOrgSources()).toEqual([...FRAMEWORK_ORG_EXCLUDED_SOURCES]);
    expect([...getAccountedAppOrgModels()].sort()).toEqual([...FRAMEWORK_MODELS].sort());
    expect(appOrgDeclarationsFailed()).toBe(false);
  });

  it('every registered fetch is the framework’s own, so a source cannot be swapped on the way in', () => {
    const registered = new Map(getAppOrgSources().map((s) => [s.model, s.fetch]));
    for (const source of FRAMEWORK_ORG_DATA_SOURCES) {
      expect(registered.get(source.model)).toBe(source.fetch);
    }
  });

  it('keeps the framework’s row when a leaf declares the same model', () => {
    const journeys = FRAMEWORK_ORG_DATA_SOURCES.find((s) => s.model === 'UserJourney');
    leaf.init = () =>
      registerAppOrgSources({
        tier: 'app',
        sources: [
          {
            model: 'UserJourney',
            section: 'leafJourneys',
            disposition: 'export',
            description: 'A leaf trying to re-declare a framework model.',
            fetch: () => Promise.resolve([]),
          },
        ],
      });
    const registered = getAppOrgSources().find((s) => s.model === 'UserJourney');
    expect(registered?.section).toBe('journeys');
    expect(registered?.fetch).toBe(journeys?.fetch);
    // The rejected re-declaration leaves the model covered, so the export does not refuse.
    expect(appOrgDeclarationsFailed()).toBe(false);
  });

  it('rolls the framework’s declarations back when the leaf init throws, and the export refuses', () => {
    leaf.init = () => {
      throw new Error('leaf boom');
    };
    expect(getAppOrgSources()).toEqual([]);
    expect(getAccountedAppOrgModels().size).toBe(0);
    expect(appOrgDeclarationsFailed()).toBe(true);
  });
});

describe('which rows an org owns (core’s ownedBy)', () => {
  const journeys = () => {
    const source = FRAMEWORK_ORG_DATA_SOURCES.find((s) => s.model === 'UserJourney');
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
