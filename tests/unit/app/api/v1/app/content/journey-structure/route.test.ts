/**
 * Unit Tests: GET /api/v1/app/content/journey-structure
 *
 * The public shape of the work: five tiers, seventeen modules, their phases.
 *
 * @see app/api/v1/app/content/journey-structure/route.ts
 */

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/content/journey-structure/route';

interface StructureBody {
  success: true;
  data: {
    collection: { title: string; subtitle: string; version: string };
    tiers: { id: string; modules: string[] }[];
    modules: { id: string; tier: string }[];
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
});
