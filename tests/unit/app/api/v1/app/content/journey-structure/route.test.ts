/**
 * Unit Tests: GET /api/v1/app/content/journey-structure
 *
 * The public shape of the work: five tiers, seventeen modules, their phases.
 * Served from the journey's rows (t-87), faked here by the rows the seed
 * writes; `journey-structure-parity.test.ts` proves the route and the pages
 * agree.
 *
 * @see app/api/v1/app/content/journey-structure/route.ts
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);

import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/content/journey-structure/route';
import { fakeJourneyStore } from '@/tests/helpers/app/content-stores';

const store = fakeJourneyStore();
beforeEach(() => store.reset());

interface StructureBody {
  success: true;
  data: {
    collection: { title: string; subtitle: string; version: string };
    tiers: { id: string; modules: string[] }[];
    modules: { id: string; tier: string; title: string; revision: number }[];
  };
}

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    url: 'http://localhost:3000/api/v1/app/content/journey-structure',
  } as unknown as NextRequest;
}

describe('GET /api/v1/app/content/journey-structure', () => {
  it('returns the five tiers and the seventeen modules', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as StructureBody;

    expect(response.status).toBe(200);
    expect(body.data.tiers).toHaveLength(5);
    expect(body.data.modules).toHaveLength(17);
  });

  it('keeps every module reachable from the tier that lists it', async () => {
    const body = (await (await GET(createRequest())).json()) as StructureBody;
    const listed = body.data.tiers.flatMap((tier) => tier.modules);

    expect([...listed].sort()).toEqual(body.data.modules.map((entry) => entry.id).sort());
  });

  it('carries the authored journey title and subtitle', async () => {
    const body = (await (await GET(createRequest())).json()) as StructureBody;

    expect(body.data.collection.title).toBeTruthy();
    expect(body.data.collection.subtitle).toBeTruthy();
  });

  it('answers 304 when the client already has this version', async () => {
    const etag = (await GET(createRequest())).headers.get('ETag')!;

    const response = await GET(createRequest({ 'If-None-Match': etag }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('sends the same cache directive on the 200 and the 304', async () => {
    const ok = await GET(createRequest());
    const notModified = await GET(createRequest({ 'If-None-Match': ok.headers.get('ETag')! }));

    expect(ok.headers.get('Cache-Control')).toBe('private, no-cache');
    expect(notModified.headers.get('Cache-Control')).toBe(ok.headers.get('Cache-Control'));
  });

  it('withholds the editorial review notes', async () => {
    const body = (await (await GET(createRequest())).json()) as StructureBody & {
      data: Record<string, unknown>;
    };

    expect(body.data).not.toHaveProperty('reviewNotes');
  });

  it('serves the row, not the file: an edited title is what the route returns', async () => {
    store.editModule('module_11_curiosity_of_self', { title: 'Curiosity, edited' });

    const body = (await (await GET(createRequest())).json()) as StructureBody;
    const edited = body.data.modules.find((entry) => entry.id === 'module_11_curiosity_of_self');

    expect(edited).toMatchObject({ title: 'Curiosity, edited', revision: 2 });
  });

  it('answers 500, not an empty journey, when the database was never seeded', async () => {
    store.empty();

    const response = await GET(createRequest());

    expect(response.status).toBe(500);
  });
});
