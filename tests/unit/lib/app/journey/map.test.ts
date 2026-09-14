/**
 * The map projection: the published graph joined with the authored structure,
 * and the one failure it must report rather than hide.
 *
 * The framework's published-map reader is mocked; the registry is the real
 * in-memory one, filled by the real `initLeafApp()`, and the definition is the
 * real one from `buildJourneyMapDefinition()` — so the happy path proves the
 * three sources agree, not that a fixture agrees with itself.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` and `leaf-bootstrap` seams
 * ---------------------------------------------------------------------------
 * The counts are Lelañea's. A fork with a different journey pins its own.
 *
 * @see lib/app/journey/map.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { getPublishedMap } = vi.hoisted(() => ({ getPublishedMap: vi.fn() }));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({ getPublishedMap }));
vi.mock('@/lib/db/client', () => ({
  prisma: { appWaitlistEntry: { findMany: vi.fn(async () => []) } },
}));

import { APIError } from '@/lib/api/errors';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { getJourneyMap, JOURNEY_MAP_INCONSISTENT } from '@/lib/app/journey/map';
import { JOURNEY_MAP_SLUG, buildJourneyMapDefinition } from '@/lib/app/journey/map-definition';
import { LELANEA_MODULE_COUNT } from '@/lib/app/modules/definitions';
import { __resetModuleRegistryForTests } from '@/lib/framework/modules/registry';
import { __resetErasureCleanupHooksForTests } from '@/lib/privacy/erasure-hooks';

const definition = buildJourneyMapDefinition();

function published(overrides: Partial<typeof definition> = {}) {
  return { slug: JOURNEY_MAP_SLUG, version: 3, definition: { ...definition, ...overrides } };
}

beforeEach(async () => {
  vi.clearAllMocks();
  __resetModuleRegistryForTests();
  __resetErasureCleanupHooksForTests();
  await initLeafApp();
});

describe('getJourneyMap', () => {
  it('is null when nothing is published — the pre-seed state, not an error', async () => {
    getPublishedMap.mockResolvedValue(null);
    await expect(getJourneyMap()).resolves.toBeNull();
    expect(getPublishedMap).toHaveBeenCalledWith(JOURNEY_MAP_SLUG);
  });

  it('projects five tiers and seventeen modules, every one open, in numbered order', async () => {
    getPublishedMap.mockResolvedValue(published());

    const map = await getJourneyMap();

    expect(map).toMatchObject({ slug: JOURNEY_MAP_SLUG, version: 3 });
    expect(map?.tiers.map((t) => t.id)).toEqual([
      'onboarding',
      'foundations',
      'inner_authority',
      'embodied_relationship',
      'integration_and_expansion',
    ]);
    expect(map?.tiers[1]).toMatchObject({ label: 'Foundations', order: 1 });
    expect(map?.tiers[1]?.intent).toMatch(/inner compass/);
    expect(map?.modules).toHaveLength(LELANEA_MODULE_COUNT);
    expect(map?.modules.map((m) => m.number)).toEqual([...Array(17).keys()]);
    expect(map?.modules.every((m) => m.state === 'open')).toBe(true);
    expect(map?.modules[11]).toEqual({
      slug: 'curiosity-of-self',
      number: 11,
      displayNumber: '11',
      title: 'Curiosity of self (work of Byron Katie)',
      tier: 'embodied_relationship',
      state: 'open',
    });
  });

  it('reports a module the code does not register, rather than dropping it', async () => {
    __resetModuleRegistryForTests(); // the map names seventeen; the code now registers none
    getPublishedMap.mockResolvedValue(published());

    const error = await getJourneyMap().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(APIError);
    const api = error as APIError;
    expect(api.code).toBe(JOURNEY_MAP_INCONSISTENT);
    expect(api.status).toBe(500);
    expect(api.details).toMatchObject({ map: JOURNEY_MAP_SLUG, version: 3 });
    const problems = (api.details as { problems: string[] }).problems;
    expect(problems).toHaveLength(LELANEA_MODULE_COUNT);
    expect(problems).toContain('module "values" is not registered');
  });

  it('reports a module node the authored structure does not know', async () => {
    getPublishedMap.mockResolvedValue(
      published({
        nodes: [
          ...definition.nodes,
          {
            key: 'ghost',
            type: 'module',
            moduleSlug: 'ghost',
            region: 'tier:foundations',
            completionMode: 'once',
          },
        ],
      })
    );

    const error = (await getJourneyMap().catch((e: unknown) => e)) as APIError;
    const problems = (error.details as { problems: string[] }).problems;
    expect(problems).toEqual([
      'module "ghost" is not registered',
      'module "ghost" is not in the authored structure',
    ]);
  });

  it('reports a region that is not an authored tier', async () => {
    getPublishedMap.mockResolvedValue(
      published({
        nodes: [...definition.nodes, { key: 'tier:limbo', type: 'region', completionMode: 'once' }],
      })
    );

    const error = (await getJourneyMap().catch((e: unknown) => e)) as APIError;
    expect((error.details as { problems: string[] }).problems).toEqual([
      'region "tier:limbo" is not an authored tier',
    ]);
  });
});
