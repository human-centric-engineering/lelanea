/**
 * What a content file would do, without doing it (f-content-seeds t-91).
 *
 * `POST { file }` → the plan: what would be created, changed and removed (or
 * retired), what is unchanged, and any refusal that would stop the apply.
 * Reads the stored rows and writes nothing.
 *
 * Its own route rather than a flag on the apply, as the slot preview is: a
 * `preview: true` is one mistyped key away from writing. Both routes call the
 * same planner, which is what makes the preview the plan that runs.
 *
 * The body is capped (`MAX_IMPORT_BYTES`) before it is parsed and refused with
 * `413 FILE_TOO_LARGE`; the platform has no ceiling for JSON bodies. Rate
 * limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/content/admin/keyed-import.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { withAdminAuth } from '@/lib/auth/guards';
import { collectionHandlers } from '@/lib/app/content/admin/registry';
import { readImportBody } from '@/lib/app/content/admin/shared';

export const POST = withAdminAuth<{ collection: string }>(
  async (request: NextRequest, _session, { params }) => {
    const log = await getRouteLogger(request);
    const { collection } = await params;
    const handlers = collectionHandlers(collection);
    const { file } = await readImportBody(request);
    const plan = await handlers.preview(file);

    log.info('Content import previewed', {
      collection,
      writesNothing: plan.writesNothing,
      refusals: plan.refusals.length,
    });
    return successResponse({ plan });
  }
);
