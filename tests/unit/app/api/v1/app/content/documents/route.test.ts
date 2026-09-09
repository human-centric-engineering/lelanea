/**
 * Unit Tests: GET /api/v1/app/content/documents
 *
 * The public index of foundational documents. Covers the 200 payload, the
 * conditional-GET 304, the public cache directive (this is the one content
 * surface a CDN may hold), and what the envelope must not leak.
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

  it('sends a weak ETag and a publicly cacheable, always-revalidated directive', async () => {
    const response = await GET(createRequest());

    expect(response.headers.get('ETag')).toMatch(/^W\/"/);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
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
