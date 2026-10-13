/**
 * Framework "module" prompt-context contributor.
 *
 * Registered into core's context-builder seam by `initFramework()` so a chat request with
 * `contextType: "module"` gets a `LOCKED CONTEXT` block for the addressed module. It composes:
 *  - the module's **config-relevant context** — its name + one-line description from the code
 *    registry (§5.4; user-agnostic, shared across users) — f-guidance **t-4**; and
 *  - the user's **fresh slots** — the current values of this module's *open* declared slots for
 *    the requesting user — f-guidance **t-4b**.
 *
 * The per-user half is guarded by the core seam widening (f-guidance t-4b): a contributor now
 * receives the request's `userId` and `buildContext` caches **per `(type, id, userId)`**, so one
 * user's slots are never served to another. When no `userId` is supplied (a shared/non-user
 * context request), only the user-agnostic module context is returned. `hidden` (system-only)
 * slots are not injected here; `special_category` values are already masked at rest by capture.
 */

import type { ContextRequest } from '@/lib/orchestration/chat/context-builder';
import { isEmbedUserId } from '@/lib/embed/auth';
import { logger } from '@/lib/logging';
import { getRegisteredModules } from '@/lib/framework/modules/registry';
import { getSlotHeads } from '@/lib/framework/data-slots/values';

/** The chat `contextType` the framework owns (client-facing, on the chat request). */
export const MODULE_CONTEXT_TYPE = 'module';

/** Body returned when the addressed slug is not a registered module (mirrors core's
 *  `pattern`-not-found case — a clear "why it's empty", not a blank block). */
export const MODULE_CONTEXT_UNAVAILABLE = 'No framework module context is available yet.';

/**
 * Load prompt context for a framework module by id (its slug): its name + description (from the
 * code registry — user-agnostic), plus — when `request.userId` is present — the user's current
 * values for the module's *open* declared slots. Returns the "unavailable" body for an
 * unregistered slug.
 */
export async function loadModuleContext(id: string, request?: ContextRequest): Promise<string> {
  const definition = getRegisteredModules().find((m) => m.slug === id);
  if (definition === undefined) return MODULE_CONTEXT_UNAVAILABLE;

  const parts = [`Module: ${definition.name}`, definition.description];

  // Per-user fresh slots (t-4b) — only for a per-user request (a user-scoped cache entry), so
  // no cross-user leak. Inject the module's *open*, non-`special_category` declared slots:
  // `hidden` slots are system-only, and the strictest `special_category` tier is left to
  // on-demand `get_state` (defense-in-depth, on top of capture's masking-at-rest).
  const userId = request?.userId;
  // An anonymous embed widget visitor (`embed_<hash>`, Sunrise #705, t-765) holds no slots, so skip
  // the read rather than query for them as if they were a user who has captured nothing. (The
  // `get_state` tool refuses a visitor outright; a context contributor has no refusal to return.)
  if (userId !== undefined && !isEmbedUserId(userId) && definition.slotDefinitions !== undefined) {
    const injectableSlugs = definition.slotDefinitions
      .filter((slot) => slot.visibility !== 'hidden' && slot.sensitivity !== 'special_category')
      .map((slot) => slot.slug);
    if (injectableSlugs.length > 0) {
      try {
        const heads = await getSlotHeads(userId, { slotSlugs: injectableSlugs });
        if (heads.length > 0) {
          parts.push('', 'What is currently known about the user in this module:');
          for (const head of heads) parts.push(`- ${head.slotSlug}: ${head.value}`);
        }
      } catch (err) {
        // A transient slot-read failure must NOT lose the reliable, user-agnostic module
        // context (t-4's guarantee) — degrade to name + description rather than throwing out
        // to `buildContext`'s contributor-catch, which would blank the whole context block.
        logger.warn('loadModuleContext: slot read failed; module context without fresh slots', {
          moduleSlug: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  return parts.join('\n');
}
