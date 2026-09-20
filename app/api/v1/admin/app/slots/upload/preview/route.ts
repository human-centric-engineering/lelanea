/**
 * What a taxonomy file would do, without doing it (f-slots t-71).
 *
 * `POST { mode, file }` → the plan. Reads the stored rows and writes nothing.
 *
 * **Its own route rather than a flag on the apply below.** A `preview: true`
 * field is one mistyped key away from writing, and the property this pair has to
 * have — that the preview is the plan that runs — is easier to hold with two
 * thin handlers over one `planTaxonomyUpload()` than with one handler that
 * branches. Nothing here decides anything: the planner does, and apply calls the
 * same function.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`. No per-flow cap. This
 * parses a JSON body and runs one `findMany` — the body-size ceiling the
 * platform applies to every route is what bounds it, and an admin previewing
 * repeatedly is the flow working.
 *
 * @see lib/app/slots/definitions-admin.ts
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validateRequestBody } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { previewTaxonomyUpload } from '@/lib/app/slots/definitions-admin';
import { slotTaxonomyUploadSchema } from '@/lib/app/slots/validation';

export const POST = withAdminAuth(async (request: NextRequest) => {
  const log = await getRouteLogger(request);
  const { mode, file } = await validateRequestBody(request, slotTaxonomyUploadSchema);
  const plan = await previewTaxonomyUpload(file, mode);

  log.info('Slot taxonomy upload previewed', {
    mode,
    creates: plan.creates.length,
    updates: plan.updates.length,
    retirements: plan.retirements.length,
    skippedRetired: plan.skippedRetired.length,
    absentFromFile: plan.absentFromFile.length,
  });
  return successResponse({ plan });
});
