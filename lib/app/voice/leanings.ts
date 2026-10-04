/**
 * The eleven voice leanings: what they are, where they can rest, and the bounds
 * that hold them (f-leanings t-135; product description §3.4, §5, §7.3).
 *
 * A leaning is a person's own setting for how Lelañea Fulton's voice is
 * reproduced for them: plainer, more spacious, less devotional. It is a filter
 * over her voice, never a replacement for it, and it never reaches the core
 * (§12 "Preferences filter, they never override").
 *
 * Pure, with no database import, because the settings view renders from it on
 * the client. The store is `lib/app/voice/leanings-store.ts`.
 *
 * ## Five stops, and rest is her voice unshaded
 *
 * Owner ruling 4 (4 Oct 2026): each dial has five positions — strongly toward
 * the left pole, toward it, rest, toward the right pole, strongly toward it —
 * stored as `-2 … 2`. Only positions that change what she says are offered, so
 * the control shows exactly what the filter does (`B31`). Rest is `0` for every
 * dial and every person: it is her voice with no leaning applied, not a
 * midpoint somebody chose. The prototype's resting values (38, 46, 62…) were a
 * picture of a shape, never a setting, and do not carry over.
 *
 * ## Stored as data slots, read only in our shape
 *
 * Owner ruling 1: a leaning is a Daybreak data slot, one per dial, so every
 * change is a new version rather than an overwrite. The slots are written only
 * by this app's own writer, in one fixed shape ({@link LEANING_SOURCE_TYPE},
 * {@link LEANING_REASONING_NOTES}, a stop as `valueJson`). The reader accepts a
 * version only in that shape, because nothing on a slot value proves who wrote
 * it: the AI's `fill_slot` may choose any source type. See the store.
 *
 * @see lib/app/voice/leanings-store.ts — reads, writes, bounds
 * @see .context/app/voice.md — "The person's leanings"
 */

import { z } from 'zod';

import type { SlotDefinitionInput } from '@/lib/framework/data-slots';

/** The keys, in the prototype's order. A key is immutable: it names a slot. */
export const LEANING_KEYS = [
  'abstraction',
  'devotion',
  'directness',
  'encouragement',
  'length',
  'warmth',
  'pace',
  'questions',
  'imagery',
  'playfulness',
  'formality',
] as const;

export type LeaningKey = (typeof LEANING_KEYS)[number];

export interface LeaningDimension {
  key: LeaningKey;
  /** The pole at `-2`. */
  left: string;
  /** The pole at `2`. */
  right: string;
}

/** The eleven, as §3.4 names them, in the order settings shows them. */
export const LEANING_DIMENSIONS: readonly LeaningDimension[] = [
  { key: 'abstraction', left: 'Philosophical', right: 'Grounded and practical' },
  { key: 'devotion', left: 'Spiritual and devotional', right: 'Secular and plain' },
  { key: 'directness', left: 'Gentle', right: 'Direct, and further, challenging' },
  { key: 'encouragement', left: 'Encouraging', right: 'Neutral and unsentimental' },
  { key: 'length', left: 'Verbose and exploratory', right: 'Concise and spare' },
  { key: 'warmth', left: 'Empathetic and warm', right: 'Cool and analytical' },
  { key: 'pace', left: 'Energetic', right: 'Slow and spacious' },
  { key: 'questions', left: 'Question-led', right: 'Guidance-led' },
  { key: 'imagery', left: 'Story and metaphor', right: 'Literal' },
  { key: 'playfulness', left: 'Playful', right: 'Serious' },
  { key: 'formality', left: 'Formal', right: 'Familiar' },
];

/** Every position a dial can take, left to right. */
export const LEANING_STOPS = [-2, -1, 0, 1, 2] as const;
export type LeaningStop = (typeof LEANING_STOPS)[number];

/** Her voice with nothing applied. */
export const LEANING_REST: LeaningStop = 0;

export const leaningKeySchema = z.enum(LEANING_KEYS);
export const leaningStopSchema = z.union([
  z.literal(-2),
  z.literal(-1),
  z.literal(0),
  z.literal(1),
  z.literal(2),
]);

export function isLeaningKey(value: unknown): value is LeaningKey {
  return leaningKeySchema.safeParse(value).success;
}

export function isLeaningStop(value: unknown): value is LeaningStop {
  return leaningStopSchema.safeParse(value).success;
}

// ─── Slots ──────────────────────────────────────────────────────────────────

/** The slot group every leaning is filed under. The taxonomy refuses it. */
export const LEANING_SLOT_GROUP = 'leanings';

/** Every leaning slot's slug starts with this. The taxonomy refuses it too. */
export const LEANING_SLOT_PREFIX = 'leaning_';

export function leaningSlotSlug(key: LeaningKey): string {
  return `${LEANING_SLOT_PREFIX}${key}`;
}

/** Whether a slug belongs to a leaning, by prefix: true for a slug no dial has. */
export function isLeaningSlotSlug(slug: string): boolean {
  return slug.startsWith(LEANING_SLOT_PREFIX);
}

/** The key a leaning slot is for, or `null` when it is not one of the eleven. */
export function leaningKeyOfSlug(slug: string): LeaningKey | null {
  if (!isLeaningSlotSlug(slug)) return null;
  const key = slug.slice(LEANING_SLOT_PREFIX.length);
  return isLeaningKey(key) ? key : null;
}

/**
 * The source type every leaning version carries. The person set it, so
 * `user_confirmed` is the honest one of Daybreak's vocabulary; it does not, by
 * itself, prove anything (see the file header).
 */
export const LEANING_SOURCE_TYPE = 'user_confirmed';

/** Full confidence: this is what the person said, not a reading of them. */
export const LEANING_CONFIDENCE = 10;

/**
 * How a version came to be, one fixed sentence per way. The reader accepts
 * only these, so a version the AI wrote through `fill_slot` (which writes its
 * own sentence) is skipped. `asked` is written by `set_leaning` (t-137).
 */
export const LEANING_REASONING_NOTES = {
  settings: 'The person set this leaning in Settings.',
  asked: 'The person asked for this leaning in conversation.',
} as const;

export type LeaningSetVia = keyof typeof LEANING_REASONING_NOTES;

const LEANING_NOTES: ReadonlySet<string> = new Set(Object.values(LEANING_REASONING_NOTES));

/** Whether a stored version is one this app's writer produced. */
export function isOurLeaningVersion(row: {
  sourceType: string;
  reasoningNote: string;
  valueJson: unknown;
}): row is { sourceType: string; reasoningNote: string; valueJson: LeaningStop } {
  return (
    row.sourceType === LEANING_SOURCE_TYPE &&
    LEANING_NOTES.has(row.reasoningNote) &&
    isLeaningStop(row.valueJson)
  );
}

/**
 * The eleven slot definitions, handed to Daybreak beside the taxonomy (see
 * `lib/app/slots/global-provider.ts`). Code-owned, not taxonomy rows: an admin
 * can't edit or retire them, because the dials, the pole lines and the bounds
 * are all keyed on them.
 *
 * **`hidden`, on purpose.** The person sees and changes a leaning in Settings,
 * not as a note. `hidden` is the one flag that keeps a slot out of every place
 * the AI's capture reaches or the notes panel shows: the AI's slot vocabulary,
 * its `get_state` read-back, the notes panel and the memory index. The notes
 * panel and the memory index also refuse the prefix, so neither depends on this
 * projection having run.
 */
export function leaningSlotDefinitions(): SlotDefinitionInput[] {
  return LEANING_DIMENSIONS.map((dimension) => ({
    slug: leaningSlotSlug(dimension.key),
    group: LEANING_SLOT_GROUP,
    description: `The person's own setting for how Lelañea's voice leans between "${dimension.left}" and "${dimension.right}", from -2 (fully toward the first) to 2 (fully toward the second), 0 being her voice unshaded. Set by the person in Settings or by asking; never inferred.`,
    visibility: 'hidden',
    mode: 'targeted',
    dataType: 'number',
    sensitivity: 'standard',
    priorityWeight: 0,
  }));
}

/** The plain-language form a version stores beside its stop. */
export function describeLeaning(dimension: LeaningDimension, stop: LeaningStop): string {
  switch (stop) {
    case -2:
      return `Strongly toward ${dimension.left}`;
    case -1:
      return `Toward ${dimension.left}`;
    case 1:
      return `Toward ${dimension.right}`;
    case 2:
      return `Strongly toward ${dimension.right}`;
    default:
      return 'At rest';
  }
}

export function leaningDimension(key: LeaningKey): LeaningDimension {
  const dimension = LEANING_DIMENSIONS.find((candidate) => candidate.key === key);
  // Unreachable: LEANING_DIMENSIONS lists every key, and a test pins it.
  if (!dimension) throw new Error(`No leaning dimension "${key}"`);
  return dimension;
}

// ─── Bounds ─────────────────────────────────────────────────────────────────

/**
 * One dial's bounds: the furthest stop each way, and whether the AI may
 * suggest moving it (t-137). Locked is `min = max = 0`: there is no separate
 * flag to disagree with the range.
 *
 * Rest is always inside the range, so a person can always go back to her voice
 * unshaded, and a bound can never pin someone away from it.
 */
export const leaningDialBoundsSchema = z
  .strictObject({
    min: z.union([z.literal(-2), z.literal(-1), z.literal(0)]),
    max: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    suggest: z.boolean(),
  })
  .readonly();

/**
 * The bounds, as stored on the voice overlay set (owner ruling 2) and as the
 * overlays file carries them. Every dial is required, so an edit can't drop one
 * silently.
 */
export const leaningBoundsSchema = z
  .strictObject({
    /** Whether the AI may suggest a change at all. Each dial's `suggest` narrows it. */
    suggest: z.boolean(),
    dials: z.strictObject(
      Object.fromEntries(LEANING_KEYS.map((key) => [key, leaningDialBoundsSchema])) as Record<
        LeaningKey,
        typeof leaningDialBoundsSchema
      >
    ),
  })
  .readonly();

export type LeaningDialBounds = z.infer<typeof leaningDialBoundsSchema>;
export type LeaningBounds = z.infer<typeof leaningBoundsSchema>;

/** Whether the person may move this dial at all. */
export function isLocked(bounds: LeaningDialBounds): boolean {
  return bounds.min === 0 && bounds.max === 0;
}

/** A stop pulled inside the bounds. */
export function clampLeaning(stop: LeaningStop, bounds: LeaningDialBounds): LeaningStop {
  if (stop < bounds.min) return bounds.min;
  if (stop > bounds.max) return bounds.max;
  return stop;
}

// ─── The API's body ─────────────────────────────────────────────────────────

/** `PATCH /api/v1/app/leanings`: one dial, one stop. */
export const leaningChangeSchema = z.strictObject({
  key: leaningKeySchema,
  stop: leaningStopSchema,
});

export type LeaningChange = z.infer<typeof leaningChangeSchema>;

/**
 * One dial as the API returns it, for the settings view to validate the
 * response with rather than trust its type (`LeaningDialView` in the store).
 */
export const leaningDialResultSchema = z.object({
  outcome: z.enum(['written', 'unchanged']),
  dial: z.object({
    key: leaningKeySchema,
    stored: leaningStopSchema,
    position: leaningStopSchema,
    min: leaningStopSchema,
    max: leaningStopSchema,
    locked: z.boolean(),
  }),
});
