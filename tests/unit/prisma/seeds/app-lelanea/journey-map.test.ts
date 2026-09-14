/**
 * The journey-map seed unit: the four write branches, and the two things that
 * must happen before any of them.
 *
 * The version service and the seed seam are mocked; the definition is the
 * REAL one from `buildJourneyMapDefinition()`, because the no-op branch's
 * deep-equal is the fp4 property under test and a fixture would prove only
 * that a fixture equals itself.
 *
 * @see prisma/seeds/app-lelanea/001-journey-map.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const syncFrameworkForSeed = vi.fn(async () => {});
const initLeafApp = vi.fn(async () => {});
const createGraph = vi.fn();
const publishDefinition = vi.fn();
const getPublishedMap = vi.fn();
const graphExists = vi.fn();

vi.mock('@/lib/framework/seed', () => ({ syncFrameworkForSeed }));
vi.mock('@/lib/app/leaf-bootstrap', () => ({ initLeafApp }));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({
  createGraph,
  publishDefinition,
  getPublishedMap,
}));
vi.mock('@/lib/framework/facilitation/map/queries', () => ({ graphExists }));

const unit = (await import('@/prisma/seeds/app-lelanea/001-journey-map')).default;
const { buildJourneyMapDefinition, JOURNEY_MAP_SLUG } =
  await import('@/lib/app/journey/map-definition');

const ADMIN = { id: 'svc-1' };
const definition = buildJourneyMapDefinition();

function ctx(admin: { id: string } | null = ADMIN) {
  return {
    prisma: { user: { findFirst: vi.fn(async () => admin) } } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  };
}

/** What `getPublishedMap` returns after a jsonb round-trip: same shape, keys reordered. */
function storedLike(version: number) {
  return {
    slug: JOURNEY_MAP_SLUG,
    version,
    definition: JSON.parse(
      JSON.stringify({
        edges: definition.edges.map((e) => ({ type: e.type, to: e.to, from: e.from })),
        nodes: definition.nodes.map((n) => ({ meta: n.meta, ...n })),
      })
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createGraph.mockResolvedValue({ slug: JOURNEY_MAP_SLUG });
  publishDefinition.mockResolvedValue({ version: { version: 2 } });
  graphExists.mockResolvedValue(false);
  getPublishedMap.mockResolvedValue(null);
});

describe('journey map seed unit', () => {
  it('is a well-formed SeedUnit that re-runs when its inputs change', () => {
    expect(unit.name).toBe('app-lelanea/001-journey-map');
    expect(typeof unit.run).toBe('function');
    expect(unit.hashInputs).toEqual([
      '../../../content/lelanea_module_structure.json',
      '../../../lib/app/content/index.ts',
      '../../../lib/app/content/schemas.ts',
      '../../../lib/app/journey/map-definition.ts',
      '../../../lib/app/modules/definitions.ts',
    ]);
  });

  it('materialises the module rows FIRST, passing the leaf hook, before reading anything', async () => {
    await unit.run(ctx());

    expect(syncFrameworkForSeed).toHaveBeenCalledOnce();
    expect(syncFrameworkForSeed).toHaveBeenCalledWith({ registerLeaf: initLeafApp });
    expect(syncFrameworkForSeed.mock.invocationCallOrder[0]).toBeLessThan(
      getPublishedMap.mock.invocationCallOrder[0]
    );
  });

  it('propagates a sync failure instead of recording the seed as applied', async () => {
    const boom = new Error('db unreachable');
    syncFrameworkForSeed.mockImplementationOnce(() => Promise.reject(boom));
    await expect(unit.run(ctx())).rejects.toBe(boom);
    expect(createGraph).not.toHaveBeenCalled();
  });

  it('fails loudly without a service account to sign the rows', async () => {
    await expect(unit.run(ctx(null))).rejects.toThrow(/service account/);
    expect(createGraph).not.toHaveBeenCalled();
  });

  it('no map → creates it with the definition, published as v1 atomically', async () => {
    await unit.run(ctx());

    expect(createGraph).toHaveBeenCalledOnce();
    expect(createGraph).toHaveBeenCalledWith({
      slug: JOURNEY_MAP_SLUG,
      name: expect.any(String),
      description: expect.any(String),
      definition,
      userId: ADMIN.id,
    });
    expect(publishDefinition).not.toHaveBeenCalled();
  });

  it('map exists but nothing published → publishes pinned to "no version yet"', async () => {
    graphExists.mockResolvedValue(true);

    await unit.run(ctx());

    expect(createGraph).not.toHaveBeenCalled();
    expect(publishDefinition).toHaveBeenCalledOnce();
    expect(publishDefinition).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: JOURNEY_MAP_SLUG,
        definition,
        createdBy: ADMIN.id,
        actorUserId: ADMIN.id,
        expectedBaseVersion: null,
      })
    );
  });

  it('published and equal → writes NOTHING, even though jsonb reordered the keys', async () => {
    getPublishedMap.mockResolvedValue(storedLike(3));

    await unit.run(ctx());

    expect(createGraph).not.toHaveBeenCalled();
    expect(publishDefinition).not.toHaveBeenCalled();
  });

  it('published and different → publishes a new version pinned to the one it compared against', async () => {
    const stale = storedLike(3);
    stale.definition.edges = stale.definition.edges.slice(1); // a spine edge missing
    getPublishedMap.mockResolvedValue(stale);

    await unit.run(ctx());

    expect(createGraph).not.toHaveBeenCalled();
    expect(publishDefinition).toHaveBeenCalledWith(
      expect.objectContaining({ definition, expectedBaseVersion: 3 })
    );
  });

  it('the equality check is real: reverting the builder’s output would publish', async () => {
    const stored = storedLike(3);
    stored.definition.nodes[0].completionMode = 'repeatable';
    getPublishedMap.mockResolvedValue(stored);

    await unit.run(ctx());

    expect(publishDefinition).toHaveBeenCalledOnce();
  });
});
