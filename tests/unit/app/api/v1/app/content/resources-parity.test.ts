/**
 * Parity: `/api/v1/app/content/resources` and `/resources/:key` return exactly
 * the records every other reader of the library is served (f-content-seeds
 * t-87).
 *
 * The drawer is a client of `/resources/:key` already, so it renders what the
 * route returns. The library's server-side readers — the offering in the voice
 * block and the suggestion chips — call `getResourcesLibrary()` directly. This
 * proves they all see one record:
 *
 * - the library route's payload is deep-equal to `getResourcesLibrary()`, and
 *   each selection route's to `selectResourcesFor()`;
 * - it carries the collection's `version`, a `revision` on every film, reading
 *   and key of words, and an ETag over exactly that record;
 * - every resource the voice block offers the model is in the API, by id;
 * - a change to a row changes every side together, and changes the ETag.
 *
 * @see app/api/v1/app/content/resources/route.ts
 * @see lib/app/content/resource-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);
vi.mock('@/lib/app/content/resource-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeResourceStore()
);

import { NextRequest } from 'next/server';
import { GET as getLibraryRoute } from '@/app/api/v1/app/content/resources/route';
import { GET as getSelectionRoute } from '@/app/api/v1/app/content/resources/[key]/route';
import { auth } from '@/lib/auth/config';
import { computeETag } from '@/lib/api/etag';
import { getResourcesLibrary, selectResourcesFor } from '@/lib/app/content/resource-store';
import type { ResourcesLibrary, ResourcesSelection } from '@/lib/app/content/resources';
import { loadResourceOffering } from '@/lib/app/resources/offering';
import { mockAuthenticatedUser } from '@/tests/helpers/auth';
import {
  fakeJourneyStore,
  fakeResourceStore,
  filmRow,
  readingRow,
} from '@/tests/helpers/app/content-stores';

const journey = fakeJourneyStore();
const store = fakeResourceStore();

beforeEach(() => {
  journey.reset();
  store.reset();
  // A library with something in it, so the parity is over films and readings
  // and not only over two empty lists.
  store.addResource(filmRow('the-quiet', { relatesTo: 'module_01_values' }));
  store.addResource(readingRow('the-heart'));
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function libraryFromApi() {
  const response = await getLibraryRoute(
    new NextRequest('https://lelanea.com/api/v1/app/content/resources')
  );
  const body = (await response.json()) as { data: ResourcesLibrary };
  return { etag: response.headers.get('ETag'), library: body.data };
}

async function selectionFromApi(key: string) {
  const response = await getSelectionRoute(
    new NextRequest(`https://lelanea.com/api/v1/app/content/resources/${key}`),
    { params: Promise.resolve({ key }) }
  );
  const body = (await response.json()) as { data: ResourcesSelection };
  return { etag: response.headers.get('ETag'), selection: body.data };
}

describe('API and reader parity, the resource library', () => {
  it('the library route returns exactly the record every server reader is served', async () => {
    const api = await libraryFromApi();

    expect(api.library).toEqual(wire(await getResourcesLibrary()));
    expect(api.library.films.map((f) => f.id)).toEqual(['the-quiet']);
    expect(api.library.readings.map((r) => r.id)).toEqual(['the-heart']);
  });

  it.each(['values', 'boundaries', 'journey', 'situations', 'default'])(
    '/resources/%s returns exactly the selection the service makes',
    async (key) => {
      const api = await selectionFromApi(key);

      expect(api.selection).toEqual(wire(await selectResourcesFor(key)));
      expect(api.etag).toBe(computeETag(await selectResourcesFor(key)));
    }
  );

  it('with its version, a revision on every item, and an ETag over exactly that record', async () => {
    const api = await libraryFromApi();

    expect(api.library.collection.version).toBe('0.1');
    expect([...api.library.films, ...api.library.readings].every((i) => i.revision === 1)).toBe(
      true
    );
    expect(Object.values(api.library.words).every((w) => w.revision === 1)).toBe(true);
    expect(api.etag).toBe(computeETag(await getResourcesLibrary()));
  });

  it('every resource the voice block offers the model is in the API, by id', async () => {
    const api = await libraryFromApi();
    const offered = [...(await loadResourceOffering()).matchAll(/^- (\S+) \(/gm)].map((m) => m[1]);

    expect(offered).toEqual(['the-quiet', 'the-heart']);
    const ids = new Set([...api.library.films, ...api.library.readings].map((item) => item.id));
    for (const id of offered) expect(ids.has(id)).toBe(true);
  });

  it('moves together when a row changes: new record on every side, new ETag', async () => {
    const before = await libraryFromApi();
    const selectionBefore = await selectionFromApi('values');

    store.editResource('the-quiet', { title: 'The quiet, edited' });

    const after = await libraryFromApi();
    const selectionAfter = await selectionFromApi('values');
    expect(after.etag).not.toBe(before.etag);
    expect(selectionAfter.etag).not.toBe(selectionBefore.etag);
    expect(after.library).toEqual(wire(await getResourcesLibrary()));
    expect(after.library.films[0]).toMatchObject({ title: 'The quiet, edited', revision: 2 });
    expect(await loadResourceOffering()).toContain('The quiet, edited');
  });
});
