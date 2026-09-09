/**
 * Unit Tests: GET /api/v1/app/content/documents/:id
 *
 * One foundational document, blocks and all. Covers the 200 payload including
 * the render metadata the cadence renderer needs, the 304, and the 404 an
 * unknown id must produce rather than an empty document.
 *
 * @see app/api/v1/app/content/documents/[id]/route.ts
 */

import { describe, it, expect } from 'vitest';
import type { NextRequest } from 'next/server';
import { GET } from '@/app/api/v1/app/content/documents/[id]/route';

interface DocumentBody {
  success: true;
  data: {
    collection: { version: string };
    document: {
      id: string;
      renderStyle: string | null;
      renderNote: string | null;
      placeholders: string[];
      requiresAcknowledgement: boolean;
      blocks: { type: string }[];
    };
  };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string };
}

function createRequest(id: string, headers: Record<string, string> = {}) {
  return {
    request: {
      headers: new Headers(headers),
      url: `http://localhost:3000/api/v1/app/content/documents/${id}`,
    } as unknown as NextRequest,
    context: { params: Promise.resolve({ id }) },
  };
}

describe('GET /api/v1/app/content/documents/:id', () => {
  it('returns the document with its blocks in authored order', async () => {
    const { request, context } = createRequest('the_mission');

    const response = await GET(request, context);
    const body = (await response.json()) as DocumentBody;

    expect(response.status).toBe(200);
    expect(body.data.document.id).toBe('the_mission');
    expect(body.data.document.blocks.length).toBeGreaterThan(0);
  });

  it('keeps the cadence instruction with the welcome statement', async () => {
    const { request, context } = createRequest('the_initiation');

    const body = (await (await GET(request, context)).json()) as DocumentBody;

    expect(body.data.document.renderStyle).toBe('cadence');
    expect(body.data.document.renderNote).toMatch(/do not merge them/i);
    expect(body.data.document.placeholders).toEqual(['{{first_name}}']);
  });

  it('tells a client that the Terms of Use must be acknowledged', async () => {
    const { request, context } = createRequest('terms_of_use');

    const body = (await (await GET(request, context)).json()) as DocumentBody;

    expect(body.data.document.requiresAcknowledgement).toBe(true);
  });

  it('answers 304 when the client already has this document', async () => {
    const first = createRequest('the_mission');
    const etag = (await GET(first.request, first.context)).headers.get('ETag')!;

    const second = createRequest('the_mission', { 'If-None-Match': etag });
    const response = await GET(second.request, second.context);

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('does not answer 304 for a different document holding another ETag', async () => {
    const mission = createRequest('the_mission');
    const etag = (await GET(mission.request, mission.context)).headers.get('ETag')!;

    const creator = createRequest('about_the_creator', { 'If-None-Match': etag });
    const response = await GET(creator.request, creator.context);

    expect(response.status).toBe(200);
  });

  it('answers 404 for an unknown document id', async () => {
    const { request, context } = createRequest('the_manifesto');

    const response = await GET(request, context);
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
