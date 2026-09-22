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
 * Source: `app_foundational_document`, through the same service the pages call
 * (`lib/app/content/document-store.ts`). Every block carries its `section` key
 * (or `null`), and the document lists its keys in `sections`. This is the whole
 * document: which sections a client shows is that client's decision. The
 * parity test (`documents-parity.test.ts`) proves this is exactly the record the
 * web pages render from.
 *
 * The ETag is computed over the whole payload, including `revision`, so any
 * edit to the row changes it.
 *
 * The id is not validated against a pattern before lookup. It is a primary-key
 * lookup through Prisma's parameterised query, so an unknown id is a plain 404
 * and there is nothing to inject into.
 */

import type { NextRequest } from 'next/server';
import { successResponse, errorResponse } from '@/lib/api/responses';
import { ErrorCodes, handleAPIError } from '@/lib/api/errors';
import { computeETag, checkConditional } from '@/lib/api/etag';
import { getRouteLogger } from '@/lib/api/context';
import {
  getFoundationalCollectionMeta,
  getFoundationalDocument,
} from '@/lib/app/content/document-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const log = await getRouteLogger(request);

  // Await params (Next.js 16 requirement)
  const { id } = await params;

  try {
    const document = await getFoundationalDocument(id);
    if (!document) {
      // Truncated: the id is an unvalidated path segment and any anonymous
      // caller can push an arbitrary-length string through here at the section
      // cap. The longest real id is 24 characters, so 64 loses nothing real.
      log.warn('Unknown foundational document requested', { documentId: id.slice(0, 64) });
      return errorResponse('Document not found', {
        code: ErrorCodes.NOT_FOUND,
        status: 404,
      });
    }

    const payload = {
      collection: await getFoundationalCollectionMeta(),
      document,
    };

    const etag = computeETag(payload);
    const notModified = checkConditional(request, etag);
    if (notModified) return notModified;

    log.info('Foundational document served', {
      documentId: id,
      blocks: document.blockCount,
      revision: document.revision,
    });

    return successResponse(payload, undefined, {
      headers: { ETag: etag },
    });
  } catch (error) {
    return handleAPIError(error);
  }
}
