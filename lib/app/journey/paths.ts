/**
 * Where a module lives in the shell, in one place.
 *
 * The drawer links to it, the module page is it, and the Workspace nav item
 * resolves to the last one visited — three places that would otherwise each
 * spell the prefix. Portable (no `next/*`), so `lib/app/**` may hold it.
 */

export const MODULES_PATH_PREFIX = '/app/modules';

export function modulePath(slug: string): string {
  return `${MODULES_PATH_PREFIX}/${slug}`;
}

/** The browser-local key remembering the last module visited (the Workspace nav item reads it). */
export const LAST_MODULE_STORAGE_KEY = 'lelanea.workspace.lastModule';

/**
 * The browser-local key holding the last few modules opened, most recent first
 * — what the topbar's `recently` strip reads.
 *
 * Separate from `LAST_MODULE_STORAGE_KEY` rather than derived from it: that one
 * answers "where does the Workspace nav item go", which is a single value and
 * has its own meaning. A list that happened to have one entry would answer both
 * questions by accident, and the day the strip wants to drop an entry the nav
 * item would follow it.
 *
 * Per browser, like everything else about where a reader has been, because
 * there is no per-user journey yet to hold it.
 */
export const RECENTS_STORAGE_KEY = 'lelanea.workspace.recents';

/** How many the strip keeps. The design shows a handful and scrolls the rest. */
export const RECENTS_MAX = 5;

/** One entry in that list: enough to draw a pill and link it back. */
export interface RecentModule {
  slug: string;
  /** `01 · Values`, the same label the conversation's way back uses. */
  label: string;
  /** The arc it belongs to, for the pill's dot. */
  tier: string;
}
