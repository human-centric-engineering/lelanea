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

/** The slug of the module a pathname is on, or `null` when it is not a module page. */
export function moduleSlugFromPath(pathname: string): string | null {
  if (!pathname.startsWith(`${MODULES_PATH_PREFIX}/`)) return null;
  const rest = pathname.slice(MODULES_PATH_PREFIX.length + 1);
  const slug = rest.split('/')[0];
  return slug ? slug : null;
}

/** The browser-local key remembering the last module visited (the Workspace nav item reads it). */
export const LAST_MODULE_STORAGE_KEY = 'lelanea.workspace.lastModule';
