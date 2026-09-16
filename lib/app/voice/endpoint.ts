/**
 * The designation surface's paths, in one place.
 *
 * Same reasoning as `lib/app/waitlist/endpoint.ts`: `lib/api/endpoints.ts` is
 * where Sunrise keeps this for its own routes and the convention it states —
 * import from here rather than hardcoding paths in components — is the right
 * one, but that file is Sunrise-owned and adding a leaf route to it would buy a
 * divergence row for a string constant.
 *
 * Its own module rather than a member of `./designation-admin`, because the
 * table is a client component and that module imports Prisma.
 */
export const DESIGNATION_ADMIN_ENDPOINT = '/api/v1/admin/app/knowledge/designations';

/** Where an admin designates her documents. The nav seam and the page both name it here. */
export const DESIGNATION_ADMIN_PAGE = '/admin/app/knowledge';
