/**
 * Authored Content — One Foundational Document
 *
 * GET /api/v1/app/content/documents/:id — the document's blocks, in authored
 * order, plus the metadata a renderer needs (`renderStyle`, `renderNote`,
 * `placeholders`, `requiresAcknowledgement`).
 *
 * Authentication: none — same reasoning as the index route. Caching likewise:
 * an ETag and the platform default, not a `public` directive (see there).
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
import { getFoundationalCollectionMeta, getFoundationalDocument } from '@/lib/app/content';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const log = await getRouteLogger(request);

  // Await params (Next.js 16 requirement)
  const { id } = await params;

  const document = getFoundationalDocument(id);
  if (!document) {
    // Truncated: the id is an unvalidated path segment and any anonymous caller
    // can push an arbitrary-length string through here at the section cap. Seven
    // ids are valid and the longest is 24 characters, so 64 loses nothing real.
    log.warn('Unknown foundational document requested', { documentId: id.slice(0, 64) });
    return errorResponse('Document not found', {
      code: ErrorCodes.NOT_FOUND,
      status: 404,
    });
  }

  const payload = {
    collection: getFoundationalCollectionMeta(),
    document,
  };

  const etag = computeETag(payload);
  const notModified = checkConditional(request, etag);
  if (notModified) return notModified;

  log.info('Foundational document served', { documentId: id, blocks: document.blockCount });

  return successResponse(payload, undefined, {
    headers: { ETag: etag },
  });
}
