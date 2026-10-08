/**
 * Deleting what I said in one module (f-forget-session t-155).
 *
 * - `DELETE /api/v1/app/modules/:slug/exchanges` — no body: delete every turn
 *   of the caller's stamped with the module, with everything derived from it,
 *   as one deleted exchange is. The sessions it touches lose their drafts,
 *   their kept accounts are flagged, and the recaps that looked back on them
 *   go. All or nothing. Nothing stamped with the slug, whether the module does
 *   not exist or the caller said nothing in it since turns were stamped, gets a
 *   404 that says so; a turn still being answered gets a 409 that says to wait.
 *
 * The response says how many exchanges and messages went, and **not** how
 * many note versions, for the reason the exchanges route gives: a count that
 * included a hidden slot would tell the person one exists. The log carries it,
 * for the operator.
 *
 * Authentication: required. Rate limiting: inherited from the `/api/v1/**`
 * section cap in `proxy.ts`. A deletion is a bounded transaction on the
 * caller's own rows, so it gets no per-flow sub-cap.
 *
 * @see lib/app/memory/delete-module.ts
 * @see .context/app/slots.md — "Deleting a module's worth"
 */

import { getRouteLogger } from '@/lib/api/context';
import { successResponse } from '@/lib/api/responses';
import { validatePathParam } from '@/lib/api/validation';
import { withAuth, type WithAuthOptions } from '@/lib/auth/guards';
import { deleteModuleExchanges } from '@/lib/app/memory/delete-module';
import { moduleSlugSchema } from '@/lib/app/memory/validation';

/**
 * Ownership: self-scoped by construction. Deliberately **not** `'policy'`, for
 * the reason the exchanges route gives: an admin widening would hand an
 * operator a delete over someone else's conversation.
 */
const OWNERSHIP: WithAuthOptions = {
  ownership: {
    decidedBy: 'self',
    because:
      "The deletion reads only turns stamped with the caller's own id, and their messages, note versions and accounts under it; another person's turns in the same module are never read.",
  },
};

export const DELETE = withAuth<{ slug: string }>(async (request, session, { params }) => {
  const log = await getRouteLogger(request);
  const { slug: raw } = await params;
  const moduleSlug = validatePathParam(raw, moduleSlugSchema, { label: 'module' });
  const deleted = await deleteModuleExchanges({ userId: session.user.id, moduleSlug });

  log.info("Module's worth deleted by the person who said it", {
    userId: session.user.id,
    moduleSlug,
    exchanges: deleted.exchanges,
    messages: deleted.messages,
    versions: deleted.versions,
    recaps: deleted.recaps,
  });

  return successResponse({ exchanges: deleted.exchanges, messages: deleted.messages });
}, OWNERSHIP);
