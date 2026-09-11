/**
 * The waitlist's paths — public write, admin read, admin export — in one place.
 *
 * `lib/api/endpoints.ts` is where Sunrise keeps this for its own routes, and
 * the convention it states — "import from here instead of hardcoding paths in
 * components" — is the right one. That file is Sunrise-owned, so adding a leaf
 * route to it would buy a divergence row for a string constant. This is the
 * leaf's own, and it lives beside the flow it names rather than in a second
 * central table nobody remembers to look in.
 *
 * Its own module rather than a member of `./service`, because the form and the
 * admin table are client components and `./service` imports Prisma.
 */
export const WAITLIST_ENDPOINT = '/api/v1/app/waitlist';

/**
 * The admin list route, and the CSV export beside it.
 *
 * Two paths rather than one with `?format=csv`. The approvals-history route
 * takes the single-route shape and the conversations export takes this one; the
 * deciding difference is that a bulk read of other people's email addresses is a
 * different ACT from paging a table, not a different rendering of it. Separating
 * them means the export carries its own per-flow rate limit and its own log
 * line, and the list route keeps one response shape.
 */
export const WAITLIST_ADMIN_ENDPOINT = '/api/v1/admin/app/waitlist';
export const WAITLIST_ADMIN_EXPORT_ENDPOINT = '/api/v1/admin/app/waitlist/export';

/** Where an admin reads the list. The nav seam and the page both name it here. */
export const WAITLIST_ADMIN_PAGE = '/admin/app/waitlist';
