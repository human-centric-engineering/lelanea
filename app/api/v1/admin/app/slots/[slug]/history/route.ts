/**
 * Every past version of one slot definition (f-slots t-71).
 *
 * `GET` — newest first, each a full snapshot of the wording as it stood, not a
 * diff. This is the read `app_slot_definition_revision` exists for, and the
 * answer to "what did this slot mean when that answer was given?": the newest
 * revision whose `changedAt` is at or before the value's `capturedAt`.
 *
 * **Do not read the current definition to explain an old answer.** That is the
 * wording as it stands today, and the whole point of the history is that those
 * differ.
 *
 * Rate limiting: the `admin` section tier from `proxy.ts`.
 *
 * @see lib/app/slots/definitions-admin.ts
 * @see .context/app/slots.md
 */

import type { NextRequest } from 'next/server';

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam } from '@/lib/api/validation';
import { withAdminAuth } from '@/lib/auth/guards';
import { listSlotDefinitionHistory } from '@/lib/app/slots/definitions-admin';
import { slotSlugSchema } from '@/lib/app/slots/validation';

export const GET = withAdminAuth<{ slug: string }>(
  async (request: NextRequest, _session, { params }) => {
    const log = await getRouteLogger(request);
    const slug = validatePathParam((await params).slug, slotSlugSchema, {
      label: 'slot slug',
      field: 'slug',
    });
    const revisions = await listSlotDefinitionHistory(slug);

    log.info('Slot definition history fetched', { slug, revisions: revisions.length });
    return successResponse({ slug, revisions });
  }
);
