/**
 * The waitlist route's path, in one place.
 *
 * `lib/api/endpoints.ts` is where Sunrise keeps this for its own routes, and
 * the convention it states — "import from here instead of hardcoding paths in
 * components" — is the right one. That file is Sunrise-owned, so adding a leaf
 * route to it would buy a divergence row for a string constant. This is the
 * leaf's own, and it lives beside the flow it names rather than in a second
 * central table nobody remembers to look in.
 *
 * Its own module rather than a member of `./service`, because the form is a
 * client component and `./service` imports Prisma.
 */
export const WAITLIST_ENDPOINT = '/api/v1/app/waitlist';
