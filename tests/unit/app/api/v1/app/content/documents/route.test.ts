/**
 * Unit Tests: GET /api/v1/app/content/documents
 *
 * The public index of foundational documents. Covers the 200 payload, the
 * conditional-GET 304, the cache directive on both (they must agree — an
 * earlier draft marked the 200 `public` while the 304 kept the platform
 * default, so the first revalidation silently undid the override), and what the
 * envelope must not leak.
 *
 * @see app/api/v1/app/content/documents/route.ts
 */

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/content/documents/route';

interface IndexBody {
  success: true;
  data: {
    collection: { id: string; title: string; version: string; locale: string };
    documents: { id: string; requiresAcknowledgement: boolean; blockCount: number }[];
  };
}

function createRequest(headers: Record<string, string> = {}): NextRequest {
  return {
    headers: new Headers(headers),
    url: 'http://localhost:3000/api/v1/app/content/documents',
  } as unknown as NextRequest;
}

describe('GET /api/v1/app/content/documents', () => {
  it('returns the seven documents in authored reading order', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as IndexBody;

    expect(response.status).toBe(200);
    expect(body.data.documents.map((document) => document.id)).toEqual([
      'the_initiation',
      'the_heart_behind_lelanea',
      'the_mission',
      'about_the_creator',
      'the_lineage_of_lelanea',
      'disclaimer',
      'terms_of_use',
    ]);
  });

  it('carries the collection version so a client can tell copy apart', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as IndexBody;

    expect(body.data.collection.version).toBeTruthy();
    expect(body.data.collection.locale).toBe('en-US');
  });

  it('sends a weak ETag and keeps the platform’s private cache directive', async () => {
    const response = await GET(createRequest());

    expect(response.headers.get('ETag')).toMatch(/^W\/"/);
    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
  });

  it('sends the same cache directive on the 200 and the 304', async () => {
    // An earlier draft marked the 200 `public` while `checkConditional` sent
    // the private default on the 304 (it hard-codes it, and lib/api/etag.ts is
    // Sunrise-owned). RFC 9111 §4.3.4 has a cache update its stored headers
    // from the 304, so the first revalidation silently undid the override. No
    // test compared the two, which is why it survived; this one does.
    const ok = await GET(createRequest());
    const etag = ok.headers.get('ETag')!;

    const notModified = await GET(createRequest({ 'If-None-Match': etag }));

    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('Cache-Control')).toBe(ok.headers.get('Cache-Control'));
  });

  it('answers 304 with an empty body when the client already has this version', async () => {
    const etag = (await GET(createRequest())).headers.get('ETag')!;

    const response = await GET(createRequest({ 'If-None-Match': etag }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
    expect(response.headers.get('ETag')).toBe(etag);
  });

  it('answers 200 when the client holds a stale ETag', async () => {
    const response = await GET(createRequest({ 'If-None-Match': 'W/"stale"' }));

    expect(response.status).toBe(200);
  });

  it('does not ship the prose, the review notes, or source-file provenance', async () => {
    const response = await GET(createRequest());
    const body = (await response.json()) as IndexBody & { data: Record<string, unknown> };

    expect(body.data).not.toHaveProperty('reviewNotes');
    expect(body.data.documents[0]).not.toHaveProperty('blocks');
    expect(body.data.documents[0]).not.toHaveProperty('sourceFile');
  });
});
