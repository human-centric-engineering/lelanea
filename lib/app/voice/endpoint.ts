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

/** Where a comparison is queued and listed. */
export const VOICE_COMPARISON_ENDPOINT = '/api/v1/admin/app/voice/comparisons';

/** What a run would use and roughly cost, read once before anything is queued. */
export const VOICE_PREFLIGHT_ENDPOINT = '/api/v1/admin/app/voice/preflight';

/** Where two arms' answers are read back, side by side. */
export const VOICE_COMPARISON_PAGE = '/admin/app/voice';

// ─── Her register overlays (f-content-seeds t-92) ───────────────────────────

const OVERLAYS = '/api/v1/admin/app/voice/overlays';

/** The set and its overlays as stored. `GET`. */
export const VOICE_OVERLAYS_ENDPOINT = OVERLAYS;

/** The set's framing: `PUT` saves it. Its `/history`, `/restore` and `/sign-off` sit under it. */
export const VOICE_OVERLAY_SET_ENDPOINT = `${OVERLAYS}/set`;

/** Add a situation. `POST`. */
export const VOICE_OVERLAY_SITUATIONS_ENDPOINT = `${OVERLAYS}/situations`;

/** One situation: `PUT` saves it, `DELETE ?revision=N` removes it. */
export function voiceOverlayEndpoint(situation: string): string {
  return `${VOICE_OVERLAY_SITUATIONS_ENDPOINT}/${encodeURIComponent(situation)}`;
}

/** The overlays as a file, and the import. */
export const VOICE_OVERLAYS_FILE_ENDPOINTS = {
  export: `${OVERLAYS}/export`,
  preview: `${OVERLAYS}/import/preview`,
  apply: `${OVERLAYS}/import`,
} as const;

// ─── The golden set (f-content-seeds t-92) ──────────────────────────────────

const GOLDEN_SET = '/api/v1/admin/app/voice/golden-set';

/** The current version and its prompts. `GET`. */
export const GOLDEN_SET_ENDPOINT = GOLDEN_SET;

/** Add a prompt. `POST`. */
export const GOLDEN_SET_PROMPTS_ENDPOINT = `${GOLDEN_SET}/prompts`;

/** One prompt: `PUT` saves it, `DELETE ?contentHash=…` removes it. */
export function goldenPromptEndpoint(key: string): string {
  return `${GOLDEN_SET_PROMPTS_ENDPOINT}/${encodeURIComponent(key)}`;
}

/** Start the next version from the current one's prompts. `POST { revision }`. */
export const GOLDEN_SET_VERSIONS_ENDPOINT = `${GOLDEN_SET}/versions`;

/** The golden set as a file, and the import. */
export const GOLDEN_SET_FILE_ENDPOINTS = {
  export: `${GOLDEN_SET}/export`,
  preview: `${GOLDEN_SET}/import/preview`,
  apply: `${GOLDEN_SET}/import`,
} as const;
