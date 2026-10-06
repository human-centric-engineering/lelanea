/**
 * The journey record: my session synopses and my own entries, in one stream
 * (f-journey-record t-145; product description §3.16).
 *
 * - `GET /api/v1/app/journey-record`: the signed-in person's kept record,
 *   newest first, each synopsis with its session's window, plus totals over
 *   the whole record. `?q=`, `?module=`, `?outcome=` and `?kind=` narrow it;
 *   `?drafts=true` adds the synopses waiting for them to approve, edit or
 *   regenerate. One enriched read: the page fetches this and nothing else.
 * - `POST /api/v1/app/journey-record`: `{ body, summary?, withheldFromAgent? }`,
 *   something the person writes themselves, kept as soon as it is written.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap in `proxy.ts`. These are a small read and a single-row insert on
 * the caller's own rows. Caching: `no-store`.
 *
 * @see lib/app/journey-record/record.ts
 * @see .context/app/journey-record.md
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateQueryParams, validateRequestBody } from '@/lib/api/validation';
import { withAuth } from '@/lib/auth/guards';
import { createOwnEntry, getJourneyRecord } from '@/lib/app/journey-record/record';
import { journeyRecordQuerySchema } from '@/lib/app/journey-record/query';
import { JOURNEY_RECORD_OWNERSHIP } from '@/lib/app/journey-record/ownership';
import { ownEntryCreateSchema } from '@/lib/app/journey-record/validation';

export const GET = withAuth(
  async (request: NextRequest, session) => {
    // The route logger carries the full URL, query string and all, on every
    // entry. A search is the person's own words about their life, so the path is
    // all that reaches the log (the notes route found this the hard way).
    const log = (await getRouteLogger(request)).withContext({
      url: `${request.nextUrl.origin}${request.nextUrl.pathname}`,
    });
    const query = validateQueryParams(request.nextUrl.searchParams, journeyRecordQuerySchema);
    const view = await getJourneyRecord(session.user.id, query);

    log.info('Own journey record read', {
      userId: session.user.id,
      total: view.total,
      matched: view.matched,
      drafts: view.drafts,
      searched: query.q !== undefined,
      filtered:
        query.module !== undefined || query.outcome !== undefined || query.kind !== undefined,
    });

    return successResponse(view, undefined, { headers: { 'Cache-Control': 'no-store' } });
  },
  { ownership: JOURNEY_RECORD_OWNERSHIP }
);

export const POST = withAuth(
  async (request: NextRequest, session) => {
    const log = await getRouteLogger(request);
    const body = await validateRequestBody(request, ownEntryCreateSchema);
    const entry = await createOwnEntry(session.user.id, body);

    // Never the words: they are the person's, and durable logs are not erasure-covered.
    log.info('Own journey entry written', {
      userId: session.user.id,
      entryId: entry.id,
      withheldFromAgent: entry.withheldFromAgent,
    });

    return successResponse(entry, undefined, { status: 201 });
  },
  { ownership: JOURNEY_RECORD_OWNERSHIP }
);
