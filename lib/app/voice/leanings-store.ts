/**
 * A person's voice leanings, read and written (f-leanings t-135), and the ones
 * a turn applies (t-136).
 *
 * The one service for them: settings reads and writes through it, the turn
 * seam and the prompt read through it, and so will `set_leaning` (t-137). The
 * vocabulary is `lib/app/voice/leanings.ts`; which pole lines a turn carries is
 * `lib/app/voice/leanings-select.ts`.
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
 * ## Decided once, at the claim, like the register
 *
 * The turn seam reads {@link readLeaningInputs} beside `resolveRegister`,
 * applies the register's source ({@link leaningsFrom}), and stamps the result
 * on the turn row (`app_turn.leanings`). The prompt reads the register and the
 * leanings back from that row together ({@link promptStampFor}) rather than
 * deciding again, so the pole lines a reply was given and the leanings its
 * account names are one value.
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
import { getVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import { hasRegister, resolveRegister } from '@/lib/app/voice/register-store';
import {
  parseRegister,
  parseRegisterSource,
  type Register,
  type RegisterSource,
} from '@/lib/app/voice/register';
import type { VoiceOverlays } from '@/lib/app/content/voice-overlay-view';
import {
  parseLeaningsStamp,
  selectLeanings,
  type LeaningPosition,
  type LeaningsStamp,
} from '@/lib/app/voice/leanings-select';
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

// ─── A turn's leanings ──────────────────────────────────────────────────────

/** What selection reads for a turn: the person's dials, and the rows there are. */
export interface LeaningInputs {
  dials: LeaningPosition[];
  content: Pick<VoiceOverlays, 'overlays'>;
}

/** Inputs that select nothing: no framing row, so no leaning applies. */
const NOTHING_TO_APPLY: Pick<VoiceOverlays, 'overlays'> = { overlays: [] };

/**
 * What a turn on `seat` selects its leanings from, or `null` for a seat that
 * has none. Never throws: a read that fails selects nothing, which is her voice
 * unshaded, and is logged.
 *
 * Read apart from the register so the turn seam can run it beside
 * `resolveRegister` rather than after it; {@link leaningsFrom} applies the
 * register's source once both are in. With every dial at rest the overlays are
 * not read at all: nothing could be selected from them.
 *
 * Only the seat with a register has leanings. That is the seat a person keeps
 * coming back to, and it is the one where the crisis hold has its input: the
 * onboarding seat reads no recent crisis, so it could not hold a hard pole.
 */
export async function readLeaningInputs(
  userId: string,
  seat: string
): Promise<LeaningInputs | null> {
  if (!hasRegister(seat) || userId === '') return null;
  try {
    const view = await getLeanings(userId);
    const dials = view.dials.map((dial) => ({
      key: dial.key,
      stop: dial.position,
      min: dial.min,
      max: dial.max,
    }));
    if (dials.every((dial) => dial.stop === LEANING_REST)) {
      return { dials, content: NOTHING_TO_APPLY };
    }
    return { dials, content: await getVoiceOverlays() };
  } catch (err) {
    logger.error('readLeaningInputs: could not be read; this turn applies none', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { dials: [], content: NOTHING_TO_APPLY };
  }
}

/** The leanings `inputs` select under a register of `registerSource`; null for none. */
export function leaningsFrom(
  inputs: LeaningInputs | null,
  registerSource: RegisterSource | null
): LeaningsStamp | null {
  return inputs === null ? null : selectLeanings({ ...inputs, registerSource });
}

/**
 * The leanings a turn on `seat` applies, or `null` for a seat that has none.
 * Never throws. {@link readLeaningInputs} then {@link leaningsFrom}, for a
 * caller that already has the register's source.
 */
export async function resolveLeanings(
  userId: string,
  seat: string,
  registerSource: RegisterSource | null
): Promise<LeaningsStamp | null> {
  return leaningsFrom(await readLeaningInputs(userId, seat), registerSource);
}

/** The register and leanings a prompt is given, as one decision. */
export interface PromptStamp {
  register: Register | null;
  leanings: LeaningsStamp | null;
}

/**
 * The register and leanings the prompt is given: the ones the turn now running
 * on the seat was claimed with, read in one go so the two are one decision.
 * Never throws; both null for a seat with no register.
 *
 * With no such row (a turn that reached the agent some other way, or a cache
 * build outside a turn), whatever the row lacks is decided here as a claim
 * would decide it, from one `resolveRegister`: the leanings are held against
 * the same register they are composed under, never against a second reading
 * of it. A claim from before leanings keeps its register, and its leanings are
 * decided against that register's source.
 */
export async function promptStampFor(userId: string, seat: string): Promise<PromptStamp> {
  if (!hasRegister(seat) || userId === '') return { register: null, leanings: null };
  let claimed: {
    register: Register | null;
    source: RegisterSource | null;
    leanings: LeaningsStamp | null;
  } = {
    register: null,
    source: null,
    leanings: null,
  };
  try {
    const running = await prisma.appTurn.findFirst({
      where: { userId, seat, status: 'running' },
      orderBy: { startedAt: 'desc' },
      select: { register: true, registerSource: true, leanings: true },
    });
    claimed = {
      register: parseRegister(running?.register),
      source: parseRegisterSource(running?.registerSource),
      leanings: parseLeaningsStamp(running?.leanings),
    };
  } catch (err) {
    logger.error('promptStampFor: the turn row could not be read; deciding again', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (claimed.register !== null && claimed.leanings !== null) {
    return { register: claimed.register, leanings: claimed.leanings };
  }
  if (claimed.register !== null) {
    // A source this build cannot read is held against as `fallback`: the
    // register may have been a crisis hold, so the harder poles stay at rest.
    return {
      register: claimed.register,
      leanings: await resolveLeanings(userId, seat, claimed.source ?? 'fallback'),
    };
  }

  // Nothing usable claimed: both decided here. Leanings stamped beside a
  // register this build cannot read are not trusted, because they were held
  // against that register's source, not this one. The dials are read beside
  // the register, as at the claim.
  const [resolved, inputs] = await Promise.all([
    resolveRegister(userId, seat),
    readLeaningInputs(userId, seat),
  ]);
  return {
    register: resolved?.register ?? null,
    leanings: leaningsFrom(inputs, resolved?.source ?? null),
  };
}
