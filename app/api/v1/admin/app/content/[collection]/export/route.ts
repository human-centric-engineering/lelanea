/**
 * One content collection as a file (f-content-seeds t-91).
 *
 * `GET` — a JSON attachment in exactly the shape the seed reads, so an export
 * dropped into `content/` or `seed-data/drafted/` is a valid seed input, and
 * importing a fresh export plans no writes. Each service parses what it is
 * about to return with the seed's own schema first, so a file this route hands
 * out is one the import will take.
 *
 * No per-flow rate limit, for the reason the slot export gives: this is her
 * published content, no personal data, so the `admin` section tier from
 * `proxy.ts` is the right and only cap. `no-store` because it is a snapshot.
 *
 * @see lib/app/content/content-files.ts — the rows → file projection
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { withAdminAuth } from '@/lib/auth/guards';
import { collectionHandlers } from '@/lib/app/content/admin/registry';

export const GET = withAdminAuth<{ collection: string }>(
  async (request: NextRequest, _session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection } = await params;
    const { file, filename } = await collectionHandlers(collection).exportFile();

    log.info('Content collection exported', { collection, filename });
    return new Response(JSON.stringify(file, null, 2), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }
);
