/**
 * Parity: `/api/v1/app/content/journey-structure` returns exactly the records
 * the web pages render from (f-content-seeds t-87).
 *
 * The pages call the journey service directly rather than fetching their own
 * API (the owner's API-first ruling: the API is the contract, composition
 * belongs to the client). What makes that safe for a native client is this
 * test:
 *
 * - the API's payload is deep-equal to what `getJourneyStructure()` — the call
 *   the home page and the module pages make — returns;
 * - it carries the journey's `version`, every tier and module its `revision`,
 *   and an ETag over exactly that record;
 * - everything the map drawer and the module pages show about a module or a tier
 *   (its title, display number, label, intent, number and tier) is in the API
 *   record, keyed by the same id;
 * - a change to a row changes both sides together, and changes the ETag.
 *
 * Both sides read the same fake store (the rows the real seed writes, through
 * the real projection), so a divergence can only come from the route or the
 * page path adding, dropping or reshaping something on the way.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this runs the real `leaf-bootstrap` seam
 * ---------------------------------------------------------------------------
 * `initLeafApp()` registers Lelañea's seventeen modules so the map view can be
 * built, and the counts asserted are hers. A fork with a different journey pins
 * its own counts and keeps the parity cases, which hold for any journey.
 *
 * @see app/api/v1/app/content/journey-structure/route.ts
 * @see lib/app/content/journey-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPublishedMap } = vi.hoisted(() => ({ getPublishedMap: vi.fn() }));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({ getPublishedMap }));
vi.mock('@/lib/db/client', () => ({
  prisma: { appWaitlistEntry: { findMany: vi.fn(async () => []) } },
}));
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);

import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/content/journey-structure/route';
import { computeETag } from '@/lib/api/etag';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import type { JourneyStructure } from '@/lib/app/content/journey-view';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { getJourneyMap } from '@/lib/app/journey/map';
import { JOURNEY_MAP_SLUG, buildJourneyMapDefinition } from '@/lib/app/journey/map-definition';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';
import { __resetErasureCleanupHooksForTests } from '@/lib/privacy/erasure-hooks';
import { fakeJourneyStore } from '@/tests/helpers/app/content-stores';

const store = fakeJourneyStore();

beforeEach(async () => {
  store.reset();
  // Registration replaces by slug, so a repeat is safe; the erasure hook is
  // reset because it refuses a second registration under its name.
  __resetErasureCleanupHooksForTests();
  await initLeafApp();
  getPublishedMap.mockResolvedValue({
    slug: JOURNEY_MAP_SLUG,
    version: 1,
    definition: buildJourneyMapDefinition(),
  });
});

async function fromApi() {
  const response = await GET({
    headers: new Headers(),
    url: 'http://localhost:3000/api/v1/app/content/journey-structure',
  } as unknown as NextRequest);
  // JSON is the wire. Parse it, so the comparison is against what a native
  // client receives, not against an object that never left the process.
  const body = (await response.json()) as { data: JourneyStructure };
  return { etag: response.headers.get('ETag'), structure: body.data };
}

/** What the pages render from, as it would reach a client over the wire. */
async function fromPages(): Promise<JourneyStructure> {
  return JSON.parse(JSON.stringify(await getJourneyStructure())) as JourneyStructure;
}

describe('API and page parity, the journey', () => {
  it('the API returns exactly the record the pages render from', async () => {
    const api = await fromApi();

    expect(api.structure).toEqual(await fromPages());
    expect(api.structure.modules).toHaveLength(17);
    expect(api.structure.tiers).toHaveLength(5);
  });

  it('with its version, a revision on every tier and module, and an ETag over exactly that record', async () => {
    const api = await fromApi();
    const pages = await getJourneyStructure();

    expect(api.structure.collection.version).toBe(pages.collection.version);
    expect(api.structure.tiers.every((tier) => tier.revision === 1)).toBe(true);
    expect(api.structure.modules.every((entry) => entry.revision === 1)).toBe(true);
    expect(api.etag).toBe(computeETag(pages));
  });

  it('everything the map drawer and the module pages show is in the API, by the same key', async () => {
    const api = await fromApi();
    const map = await getJourneyMap();
    const modulesBySlug = new Map(api.structure.modules.map((m) => [moduleSlugFromId(m.id), m]));
    const tiersById = new Map(api.structure.tiers.map((tier) => [tier.id, tier]));

    expect(map?.modules).toHaveLength(17);
    for (const shown of map!.modules) {
      expect(modulesBySlug.get(shown.slug)).toMatchObject({
        title: shown.title,
        displayNumber: shown.displayNumber,
        number: shown.number,
        tier: shown.tier,
      });
    }
    for (const shown of map!.tiers) {
      expect(tiersById.get(shown.id)).toMatchObject({
        label: shown.label,
        intent: shown.intent,
        order: shown.order,
      });
    }
  });

  it('moves together when a row changes: new record on both sides, new ETag', async () => {
    const before = await fromApi();

    store.editModule('module_01_values', { title: 'Values, edited' });

    const after = await fromApi();
    const map = await getJourneyMap();

    expect(after.etag).not.toBe(before.etag);
    expect(after.structure).toEqual(await fromPages());
    expect(after.structure.modules[1]).toMatchObject({ title: 'Values, edited', revision: 2 });
    expect(map?.modules[1]?.title).toBe('Values, edited');
  });
});
