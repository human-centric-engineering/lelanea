/**
 * My journey record, to keep (f-journey-record t-145; §3.16: "exportable").
 *
 * `GET /api/v1/app/journey-record/export`: everything I have kept, as one
 * Markdown document, oldest first. Drafts are left out, because they are not in
 * the record yet. This is the person's own copy of their record, not the GDPR
 * bundle, which carries every row we hold (`lib/app/leaf-data-export.ts`).
 *
 * Authentication: required. Rate limiting: the `/api/v1/**` section cap.
 *
 * @see lib/app/journey-record/record.ts — `exportJourneyRecordMarkdown`
 */

import { getRouteLogger } from '@/lib/api/context';
import { withAuth } from '@/lib/auth/guards';
import { exportJourneyRecordMarkdown } from '@/lib/app/journey-record/record';
import { JOURNEY_RECORD_OWNERSHIP } from '@/lib/app/journey-record/ownership';

export const GET = withAuth(async (request, session) => {
  const log = await getRouteLogger(request);
  const { markdown, entries } = await exportJourneyRecordMarkdown(session.user.id);
  const day = new Date().toISOString().slice(0, 10);

  log.info('Own journey record exported', { userId: session.user.id, entries });

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="lelanea-journey-${day}.md"`,
      // Personal data, one copy per request: nothing between here and the
      // browser should keep it.
      'Cache-Control': 'private, no-store',
    },
  });
}, JOURNEY_RECORD_OWNERSHIP);
