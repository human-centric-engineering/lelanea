/**
 * What an admin may write to her register overlays and to the golden set
 * (f-content-seeds t-92).
 *
 * The stored shapes are the seed file's (`lib/app/content/schemas.ts`), so the
 * editor cannot save anything the export would then refuse to write, or the
 * read path (`toVoiceOverlays`) refuse to serve. The bounds are on typos, not
 * on what she may say: an overlay is a handful of beats, a prompt a few lines.
 *
 * @see lib/app/voice/overlays-admin.ts
 * @see lib/app/voice/golden-set-editor.ts
 */

import { z } from 'zod';

import { GOLDEN_SET_REQUIRED_KINDS, voiceSituationSchema } from '@/lib/app/content/schemas';

const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty.`)
    .max(max, `${label} is longer than ${max} characters.`);

/** Beats: each entry one line of the block, joined with a newline where it reaches a prompt. */
const beats = (label: string) =>
  z
    .array(text(`Each line of ${label}`, 1_000))
    .min(1, `${label} needs at least one line.`)
    .max(30, `${label} may have at most 30 lines.`);

/** The revision the admin read. A save naming an older one is refused 409. */
const revisionRead = z.number().int().positive();

// ─── Overlays ───────────────────────────────────────────────────────────────

/** A situation key, as a chat request's `contextId` carries it, and as a path segment. */
export const situationKeySchema = voiceSituationSchema.max(
  60,
  'A situation key is at most 60 characters.'
);

/** Everything about an overlay but its key and its place in the order. */
export const overlayEditSchema = z.strictObject({
  label: text('The label', 120),
  /** The file's `when`: a note to a reviewer, never sent to the model. */
  when: text('When it applies', 600),
  heading: text('The heading', 200),
  lines: beats('the overlay'),
  exemplarQuery: text('The exemplar search', 500),
});

export const overlaySaveSchema = overlayEditSchema.extend({ revision: revisionRead });

/** A new situation: its key, once, and the words. It is added at the end. */
export const overlayCreateSchema = overlayEditSchema.extend({ situation: situationKeySchema });

/**
 * The set's two blocks that belong to no one situation. Both reach the model
 * on every voice turn: `coreOnly` when no overlay matched, `exemplars` around
 * every passage of hers.
 */
export const overlaySetEditSchema = z.strictObject({
  exemplars: z.strictObject({
    heading: text('The heading', 200),
    originLabel: text('The origin label', 120),
    lines: beats('the exemplar block'),
    noneFoundNote: text('The note when nothing is found', 600),
    unavailableNote: text('The note when the writing cannot be searched', 600),
  }),
  coreOnly: z.strictObject({
    heading: text('The heading', 200),
    lines: beats('the core-only block'),
  }),
});

export const overlaySetSaveSchema = overlaySetEditSchema.extend({ revision: revisionRead });

/** A sign-off names the revision it read, so nobody signs off words they did not see. */
export const voiceSignOffSchema = z.strictObject({ revision: revisionRead });

/** Put an earlier revision's words back, as a new revision. */
export const voiceRestoreSchema = z.strictObject({
  revision: z.number().int().positive(),
  revisionRead,
});

// ─── The golden set ─────────────────────────────────────────────────────────

/**
 * The golden set is locked on its dataset's `contentHash` rather than a
 * revision: a dataset case has no revision column, and the hash is exactly
 * "the prompts as the admin read them".
 */
const contentHashRead = z.string().regex(/^[0-9a-f]{64}$/, 'contentHash is the hash you read.');

/** A prompt's key, as a path segment and as the comparison surface addresses it. */
export const promptKeySchema = voiceSituationSchema.max(
  60,
  'A prompt key is at most 60 characters.'
);

/** What a prompt asks and what it is there to test. */
export const goldenPromptEditSchema = z.strictObject({
  kind: z.enum(GOLDEN_SET_REQUIRED_KINDS),
  /** What the answer should show: shown beside both arms to whoever reads them. */
  probe: text('What it tests', 1_000),
  prompt: text('The prompt', 2_000),
});

export const goldenPromptSaveSchema = goldenPromptEditSchema.extend({
  contentHash: contentHashRead,
});

export const goldenPromptCreateSchema = goldenPromptSaveSchema.extend({ key: promptKeySchema });

/** Start the next version from the current one's prompts. Names the pointer revision read. */
export const goldenSetNewVersionSchema = z.strictObject({ revision: revisionRead });

/** A removal names the hash it read, in the query string. */
export const contentHashQuerySchema = contentHashRead;

export type OverlayEdit = z.infer<typeof overlayEditSchema>;
export type OverlayCreate = z.infer<typeof overlayCreateSchema>;
export type OverlaySetEdit = z.infer<typeof overlaySetEditSchema>;
export type GoldenPromptEdit = z.infer<typeof goldenPromptEditSchema>;
