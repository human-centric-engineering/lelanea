/**
 * Authored Content — One Foundational Document
 *
 * GET /api/v1/app/content/documents/:id — the document's blocks, in authored
 * order, plus the metadata a renderer needs (`renderStyle`, `renderNote`,
 * `placeholders`, `requiresAcknowledgement`).
 *
 * Authentication: none — same reasoning as the index route.
 *
 * Rate limiting: inherited from the `/api/v1/**` section cap in
 * `lib/security/rate-limit-policy.ts`.
 *
 * The id is not validated against a pattern before lookup: the loader resolves
 * it against a fixed set of seven authored documents, so an unknown id is a
 * plain 404 rather than a validation error. There is no database and nothing to
 * inject into.
 */

import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ErrorCodes } from '@/lib/api/errors';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import { getFoundationalDocument, listFoundationalDocuments } from '@/lib/app/content';
import { PUBLIC_CONTENT_CACHE_CONTROL } from '@/lib/app/content/http';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const log = await getRouteLogger(request);

  // Await params (Next.js 16 requirement)
  const { id } = await params;

  const document = getFoundationalDocument(id);
  if (!document) {
    log.warn('Unknown foundational document requested', { documentId: id });
    return errorResponse('Document not found', {
      code: ErrorCodes.NOT_FOUND,
      status: 404,
    });
  }

  const payload = {
    collection: listFoundationalDocuments().collection,
    document,
  };

  const etag = computeETag(payload);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  log.info('Foundational document served', { documentId: id, blocks: document.blockCount });

  return successResponse(payload, undefined, {
    headers: { ETag: etag, 'Cache-Control': PUBLIC_CONTENT_CACHE_CONTROL },
  });
}
