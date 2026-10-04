/**
 * A person's voice leanings, read and written (f-leanings t-135).
 *
 * The one service for them: settings reads and writes through it, and so will
 * the prompt path (t-136) and `set_leaning` (t-137). The vocabulary is
 * `lib/app/voice/leanings.ts`.
 *
 * ## Where each part lives
 *
 * - **The person's setting** is a Daybreak data slot per dial, insert-only, so a
 *   change is a new version and "that was too much" can be answered from the
 *   history (owner ruling 1, 4 Oct 2026). Written through Daybreak's
 *   `appendSlotValue`; GDPR export and erasure already cover the table.
 * - **The bounds** are on the voice overlay set, beside the lines they bound,
 *   revisioned with it (owner ruling 2). Edited by t-138.
 *
 * ## The reader accepts only our shape
 *
 * Nothing on a slot value proves who wrote it: the AI's `fill_slot` takes any
 * source type, and restricting its writes would stop it inventing slots, which
 * the owner needs it to keep doing. So the reader walks a dial's history
 * newest-first and takes the newest version this module wrote, by its exact
 * shape (`isOurLeaningVersion`). Anything else is skipped and the person's last
 * real setting holds. The AI is also never shown these slots: they are
 * `hidden`, which keeps them out of its vocabulary and its read-back. Until
 * Daybreak can mark a slot capture may not write, that is best effort rather
 * than a guarantee, and it is recorded on t-135.
 *
 * ## Bounds clamp on read, never on the stored value
 *
 * A stored stop outside today's bounds is shown and applied at the nearest
 * allowed stop, and is left as it is: loosening the bound later gives the
 * person back what they chose. A write is clamped before it is stored, because
 * that is what the person can see they chose.
 *
 * ## Fails closed
 *
 * Bounds that are missing or fail their schema lock every dial at rest: a
 * filter nobody configured shades nothing. The read says so, so settings can.
 *
 * @see lib/app/voice/leanings.ts — keys, stops, bounds schema
 * @see .context/app/voice.md — "The person's leanings"
 */

import { ConflictError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { isRecord } from '@/lib/utils';
import { appendSlotValue, type SlotValueProvenance } from '@/lib/framework/data-slots';
import { VOICE_OVERLAY_SET_ID } from '@/lib/app/content/voice-overlay-view';
import {
  LEANING_CONFIDENCE,
  LEANING_DIMENSIONS,
  LEANING_REASONING_NOTES,
  LEANING_REST,
  LEANING_SOURCE_TYPE,
  clampLeaning,
  describeLeaning,
  isLocked,
  isOurLeaningVersion,
  leaningBoundsSchema,
  leaningDimension,
  leaningKeyOfSlug,
  leaningSlotSlug,
  type LeaningBounds,
  type LeaningDialBounds,
  type LeaningKey,
  type LeaningSetVia,
  type LeaningStop,
} from '@/lib/app/voice/leanings';

/** Every dial at rest and locked: what unconfigured bounds mean. */
const LOCKED_AT_REST: LeaningDialBounds = { min: 0, max: 0, suggest: false };

/** One dial, as settings shows it and the prompt path will read it. */
export interface LeaningDialView {
  key: LeaningKey;
  left: string;
  right: string;
  /** What the person last set, in our shape, or rest when they never have. */
  stored: LeaningStop;
  /** `stored` pulled inside today's bounds: what applies. */
  position: LeaningStop;
  min: LeaningStop;
  max: LeaningStop;
  locked: boolean;
  /** Whether the AI may suggest moving this dial (t-137). */
  suggest: boolean;
}

export interface LeaningsView {
  /** `false` when the bounds are missing or unreadable, so every dial is locked at rest. */
  configured: boolean;
  dials: LeaningDialView[];
}

// ─── Bounds ─────────────────────────────────────────────────────────────────

/**
 * Today's bounds, or `null` when they cannot be read: the set is not seeded,
 * or its stored bounds fail their schema. Never throws for either.
 */
export async function readLeaningBounds(): Promise<LeaningBounds | null> {
  const set = await prisma.appVoiceOverlaySet.findFirst({
    where: { slug: VOICE_OVERLAY_SET_ID },
    select: { leanings: true },
  });
  if (!set) return null;
  const parsed = leaningBoundsSchema.safeParse(set.leanings);
  if (!parsed.success) {
    // No values in the log: the bounds are config, but the issue paths are
    // enough to find the bad field, and nothing more is needed.
    logger.error(
      'readLeaningBounds: stored leaning bounds fail their schema — every dial locked at rest',
      {
        issues: parsed.error.issues.map((issue) => issue.path.join('.')),
      }
    );
    return null;
  }
  return parsed.data;
}

function dialBounds(bounds: LeaningBounds | null, key: LeaningKey): LeaningDialBounds {
  if (!bounds) return LOCKED_AT_REST;
  const dial = bounds.dials[key];
  return { ...dial, suggest: bounds.suggest && dial.suggest };
}

// ─── Reads ──────────────────────────────────────────────────────────────────

/**
 * The newest version of each dial this module wrote, by slug. A dial with
 * none is absent.
 *
 * The whole history of eleven slugs, which is small: a version is a deliberate
 * change by the person, not a turn's capture. A history read rather than
 * `getSlotHeads`, because the head may be a version somebody else wrote (see
 * the file header) — the same direct read `lib/app/slots/notes.ts` makes.
 */
async function readStoredStops(
  userId: string
): Promise<Map<LeaningKey, { stop: LeaningStop; version: number }>> {
  const rows = await prisma.slotValue.findMany({
    where: {
      userId,
      slotSlug: { in: LEANING_DIMENSIONS.map((dimension) => leaningSlotSlug(dimension.key)) },
    },
    select: {
      slotSlug: true,
      version: true,
      valueJson: true,
      sourceType: true,
      reasoningNote: true,
    },
    orderBy: [{ slotSlug: 'asc' }, { version: 'desc' }],
  });

  const stops = new Map<LeaningKey, { stop: LeaningStop; version: number }>();
  for (const row of rows) {
    const key = leaningKeyOfSlug(row.slotSlug);
    if (!key || stops.has(key)) continue;
    if (isOurLeaningVersion(row)) stops.set(key, { stop: row.valueJson, version: row.version });
  }
  return stops;
}

/** The person's eleven dials, with today's bounds applied. */
export async function getLeanings(userId: string): Promise<LeaningsView> {
  const [bounds, stored] = await Promise.all([readLeaningBounds(), readStoredStops(userId)]);
  return {
    configured: bounds !== null,
    dials: LEANING_DIMENSIONS.map((dimension) => {
      const limits = dialBounds(bounds, dimension.key);
      const stop = stored.get(dimension.key)?.stop ?? LEANING_REST;
      return {
        key: dimension.key,
        left: dimension.left,
        right: dimension.right,
        stored: stop,
        position: clampLeaning(stop, limits),
        min: limits.min,
        max: limits.max,
        locked: isLocked(limits),
        suggest: limits.suggest,
      };
    }),
  };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface SetLeaningInput {
  userId: string;
  key: LeaningKey;
  stop: LeaningStop;
  via: LeaningSetVia;
  /** Where the request came from, when it came from a conversation (t-137). */
  provenance?: SlotValueProvenance;
}

export interface SetLeaningResult {
  outcome: 'written' | 'unchanged';
  dial: LeaningDialView;
  /** The version written, or the stored one's when nothing changed; `null` before any. */
  version: number | null;
}

/**
 * Set one dial. Clamped to today's bounds before it is stored; refused for a
 * locked dial and when the bounds can't be read. A stop equal to the stored one
 * writes nothing. Each write is a new version.
 *
 * @throws ConflictError `leaning_locked` | `leanings_unavailable`
 */
export async function setLeaning(input: SetLeaningInput): Promise<SetLeaningResult> {
  const bounds = await readLeaningBounds();
  if (!bounds) {
    throw new ConflictError('Leanings can’t be changed just now. Try again later.', {
      reason: 'leanings_unavailable',
    });
  }
  const limits = dialBounds(bounds, input.key);
  if (isLocked(limits)) {
    // Printed by the settings view, so it names her rather than "she".
    throw new ConflictError('Lelañea keeps this one where it is.', { reason: 'leaning_locked' });
  }

  const dimension = leaningDimension(input.key);
  const stop = clampLeaning(input.stop, limits);
  const view = (stored: LeaningStop): LeaningDialView => ({
    key: dimension.key,
    left: dimension.left,
    right: dimension.right,
    stored,
    position: clampLeaning(stored, limits),
    min: limits.min,
    max: limits.max,
    locked: false,
    suggest: limits.suggest,
  });

  // The version reported is the one this reading took, never the head: the
  // head may be a version somebody else wrote, which the reader ignores.
  const before = (await readStoredStops(input.userId)).get(input.key);
  if ((before?.stop ?? LEANING_REST) === stop) {
    return { outcome: 'unchanged', dial: view(stop), version: before?.version ?? null };
  }

  const written = await appendOnce({
    userId: input.userId,
    slotSlug: leaningSlotSlug(input.key),
    value: describeLeaning(dimension, stop),
    valueJson: stop,
    confidence: LEANING_CONFIDENCE,
    sourceType: LEANING_SOURCE_TYPE,
    reasoningNote: LEANING_REASONING_NOTES[input.via],
    provenance: input.provenance ?? {},
  });
  return { outcome: 'written', dial: view(stop), version: written.version };
}

/**
 * One retry on a unique violation: two writes to one dial at once compute the
 * same next version, and the loser re-reads the head and takes the one after.
 * The same shape `fill_slot` and the discovery store use.
 */
async function appendOnce(input: Parameters<typeof appendSlotValue>[0]) {
  try {
    return await appendSlotValue(input);
  } catch (err) {
    // Daybreak's `(userId, slotSlug, version)` backstop, as the discovery store reads it.
    if (isRecord(err) && err.code === 'P2002') {
      return appendSlotValue(input);
    }
    throw err;
  }
}
