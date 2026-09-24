/**
 * The crisis resource admin surface's paths, in one place (f-safety t-63).
 *
 * Same reasoning as `lib/app/agent/endpoint.ts`: `lib/api/endpoints.ts` is
 * Sunrise-owned, and the admin component is a client component that must not
 * import the Prisma-backed modules these routes call.
 */

/** Everything as stored, and whether the tables are the source yet. `GET`. */
export const CRISIS_RESOURCES_ENDPOINT = '/api/v1/admin/app/safety/resources';

/** The shared copy and the directory. `PUT` replaces it. */
export const CRISIS_COPY_ENDPOINT = `${CRISIS_RESOURCES_ENDPOINT}/copy`;

/** Sign the shared copy off at a version. `POST { version }`. */
export const CRISIS_COPY_SIGN_OFF_ENDPOINT = `${CRISIS_COPY_ENDPOINT}/sign-off`;

/** Add a region. `POST`. */
export const CRISIS_REGIONS_ENDPOINT = `${CRISIS_RESOURCES_ENDPOINT}/regions`;

/** One region: `PUT` replaces its number and services, `DELETE` stops listing it. */
export function crisisRegionEndpoint(region: string): string {
  return `${CRISIS_REGIONS_ENDPOINT}/${encodeURIComponent(region)}`;
}

/** Sign one region off at a version. `POST { version }`. */
export function crisisRegionSignOffEndpoint(region: string): string {
  return `${crisisRegionEndpoint(region)}/sign-off`;
}

/** Where an admin edits them. The nav seam and the page both name it here. */
export const CRISIS_RESOURCES_PAGE = '/admin/app/safety';

/** The crisis resource as a file, and the import (f-content-seeds t-92). */
export const CRISIS_FILE_ENDPOINTS = {
  export: `${CRISIS_RESOURCES_ENDPOINT}/export`,
  preview: `${CRISIS_RESOURCES_ENDPOINT}/import/preview`,
  apply: `${CRISIS_RESOURCES_ENDPOINT}/import`,
} as const;
