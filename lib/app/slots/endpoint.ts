/**
 * The slot-definition editor's paths, in one place (f-slots t-71).
 *
 * Same reasoning as `lib/app/safety/endpoint.ts`: `lib/api/endpoints.ts` is
 * Sunrise-owned, and the editor is a client component that must not import the
 * Prisma-backed modules these routes call.
 */

/** The taxonomy as an admin reads it — every definition, active and retired. `GET`. */
export const SLOT_DEFINITIONS_ENDPOINT = '/api/v1/admin/app/slots';

/** Add a definition. `POST`. A slug is never edited, only added and retired. */
export const SLOT_DEFINITION_CREATE_ENDPOINT = SLOT_DEFINITIONS_ENDPOINT;

/** One definition: `PUT` rewords it. The slug is in the path and is not writable. */
export function slotDefinitionEndpoint(slug: string): string {
  return `${SLOT_DEFINITIONS_ENDPOINT}/${encodeURIComponent(slug)}`;
}

/** Retire or restore one definition. `PUT { version, isActive }`. */
export function slotDefinitionActiveEndpoint(slug: string): string {
  return `${slotDefinitionEndpoint(slug)}/active`;
}

/** Every past version of one definition, newest first. `GET`. */
export function slotDefinitionHistoryEndpoint(slug: string): string {
  return `${slotDefinitionEndpoint(slug)}/history`;
}

/**
 * What a taxonomy file would do, without doing it. `POST { mode, file }`.
 *
 * Its own route rather than a flag on the one below, so the preview cannot
 * write by a mistyped field — and so the test that the two agree is a test of
 * two callers of one planner rather than of one handler branching.
 */
export const SLOT_TAXONOMY_UPLOAD_PREVIEW_ENDPOINT = `${SLOT_DEFINITIONS_ENDPOINT}/upload/preview`;

/** Apply a taxonomy file. `POST { mode, file }`. */
export const SLOT_TAXONOMY_UPLOAD_ENDPOINT = `${SLOT_DEFINITIONS_ENDPOINT}/upload`;

/** Where an admin edits them. The nav seam and the page both name it here. */
export const SLOT_DEFINITIONS_PAGE = '/admin/app/slots';
