/**
 * The data-slot taxonomy, as a file (f-slots t-71).
 *
 * `GET` — a JSON attachment in the same format the upload beside it accepts,
 * so export → edit → import is a real round trip rather than two formats that
 * happen to resemble each other. The store parses what it is about to return
 * with the seed's own schema, so a file this route hands out is a file the
 * import will take.
 *
 * ## Its own route, and no per-flow rate limit
 *
 * A separate route rather than `?format=file` on the list, following
 * `app/api/v1/admin/app/waitlist/export/route.ts`: a bulk read is a different
 * act from paging a table, and separating them gives it its own log line.
 *
 * **What does not transfer from that precedent is its `exportLimiter`.** There
 * the sub-cap exists because each download is a complete copy of other people's
 * email addresses and stated intentions leaving the building. This file holds
 * the questions, not the answers — no personal data at all, which is the same
 * reason both definition tables are EXCLUSIONS in `lib/app/leaf-data-export.ts`.
 * The `admin` section tier from `proxy.ts` is the right and only cap; adding a
 * second one here would be a guard against a hazard this route does not have.
 *
 * `no-store` because the response is a point-in-time snapshot: a cached copy
 * would be a stale taxonomy presented as the current one. The platform's JSON
 * helper sets a directive by default, but this returns a raw `Response`, which
 * would otherwise carry none — and RFC 9111 §4.2.2 lets a shared cache store
 * that and guess its own expiry.
 *
 * @see lib/app/slots/definitions-admin.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { withAdminAuth } from '@/lib/auth/guards';
import { exportTaxonomyFile, taxonomyExportFilename } from '@/lib/app/slots/definitions-admin';

export const GET = withAdminAuth(async (request: NextRequest) => {
  const log = await getRouteLogger(request);
  const now = new Date();
  const file = await exportTaxonomyFile(now);
  const filename = taxonomyExportFilename(now);

  log.info('Data-slot taxonomy exported', {
    slots: file.slots.length,
    groups: file.groups.length,
  });

  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  });
});
