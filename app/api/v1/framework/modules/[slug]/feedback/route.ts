/**
 * Module feedback — the plain user-facing feedback endpoint (f-engagement t-2, spec §4.3).
 *
 * POST /api/v1/framework/modules/:slug/feedback
 *
 * The UI-driven counterpart to the `record_feedback` capability: a signed-in user submits
 * a 1–5 rating (+ optional comment) for a module. Records it as a `module.feedback` event
 * on the shared engagement stream via the same emit seam. The module slug is the URL path
 * (the sanctioned "explicit module" path — authenticated, scoped by its own URL), so an
 * unknown slug is a 404 rather than a junk event in the stream.
 *
 * `withAuth` (the caller records their OWN feedback — `session.user.id`, no cross-user
 * write) + the automatic per-session `/api/v1/**` rate limit from `proxy.ts`; a plain
 * write needs no handler sub-cap (those are for expensive flows — see the rate-limit
 * policy). A framework-owned route (under the `framework` API segment) so it may import
 * `@/lib/framework/*` on the framework side of the tier boundary.
 */

import { z } from 'zod';
import { withAuth } from '@/lib/auth/guards';
import { validateRequestBody } from '@/lib/api/validation';
import { successResponse } from '@/lib/api/responses';
import { getRouteLogger } from '@/lib/api/context';
import { NotFoundError } from '@/lib/api/errors';
import { moduleExists } from '@/lib/framework/modules/queries';
import { recordModuleEngagement, ENGAGEMENT_EVENT_TYPE } from '@/lib/framework/engagement';

const feedbackRequestSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(1).max(2000).optional(),
});

export const POST = withAuth<{ slug: string }>(
  async (request, session, { params }) => {
    const log = await getRouteLogger(request);
    const { slug } = await params;
    const body = await validateRequestBody(request, feedbackRequestSchema);

    // Reject an unknown module before writing, so an arbitrary slug can't inject a junk
    // `module.feedback` event into the engagement stream.
    if (!(await moduleExists(slug))) {
      throw new NotFoundError(`Module "${slug}" not found`);
    }

    await recordModuleEngagement({
      userId: session.user.id,
      moduleSlug: slug,
      type: ENGAGEMENT_EVENT_TYPE.moduleFeedback,
      payload: {
        rating: body.rating,
        ...(body.comment !== undefined ? { comment: body.comment } : {}),
      },
    });

    log.info('Module feedback recorded', {
      moduleSlug: slug,
      userId: session.user.id,
      rating: body.rating,
    });

    return successResponse({ recorded: true });
  },
  {
    // Ownership: self-scoped by construction — see RouteOwnership in lib/auth/guards.ts.
    ownership: {
      decidedBy: 'self',
      because:
        "The only row this writes is a module.feedback engagement event keyed on the caller's own id; the module slug is a public URL segment, not a subject.",
    },
  }
);
