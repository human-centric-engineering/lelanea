/**
 * Which pole lines a turn carries: a person's leanings applied as selection
 * (f-leanings t-136; product description §5 "User preference is a filter").
 *
 * A leaning never instructs numerically (owner ruling 3, 4 Oct 2026). Each
 * dial set off rest selects one authored overlay row, written in her register
 * for that pole and stop, and the rows are ADDED to the turn's block. Nothing
 * is removed: the core rides on the agent's profile and is out of reach, and
 * the register overlay, the exemplar framing and every safety line in them
 * are composed exactly as they would be with no leaning set
 * (`composeVoiceContext`). The exhaustive test over every extreme combination
 * holds that.
 *
 * ## The rows
 *
 * Pole lines are `app_voice_overlay` rows, so they are edited, revisioned and
 * signed off at /admin/app/voice like every other overlay. Each is named by
 * {@link leaningSituation}: `leaning-<key>-<left|right>`, and `-strong` at
 * `±2`. Each stop selects exactly one row, so a strong row stands alone rather
 * than adding to the mild one. One more row, {@link LEANING_FRAMING_SITUATION},
 * is the heading the poles sit under, and says in her register that a leaning
 * shades the register, never overrides the core, and gives way to the moment.
 * **With no framing row, no leaning applies**: the precedence it states is the
 * part that keeps a pole line safe, so a pole never reaches a prompt without it.
 *
 * None of these is a situation a request can select: `selectOverlayFrom`
 * refuses the prefix, so an admin chat asking for `leaning-warmth-right` gets
 * the core-only block, not a pole line in place of a register.
 *
 * ## Held at rest when something hard is here
 *
 * Under a `safety` or `fallback` register (a recent crisis, or a crisis check
 * that could not be read), the harder poles select nothing: direct and
 * challenging, neutral and unsentimental, cool and analytical, energetic, and
 * playful. Code, not data, for the reason the register's own crisis hold is
 * code: it is the one deterministic bound, and an edit on the Voice page must
 * not be able to loosen it. A held dial is named in the turn's account.
 *
 * Pure, and client-safe: the account under a reply reads the stamp's shape from
 * here.
 *
 * @see lib/app/voice/leanings-store.ts — `readLeaningInputs`, `promptStampFor`
 * @see lib/app/voice/context-contributor.ts — where the rows are composed
 * @see .context/app/voice.md — "The person's leanings"
 */

import { z } from 'zod';

import type { VoiceOverlay, VoiceOverlays } from '@/lib/app/content/voice-overlay-view';
import {
  LEANING_DIMENSIONS,
  LEANING_REST,
  leaningKeySchema,
  leaningStopSchema,
  type LeaningKey,
  type LeaningStop,
} from '@/lib/app/voice/leanings';
import type { RegisterSource } from '@/lib/app/voice/register';

/** Every leaning row's situation starts with this. No register or seat does. */
export const LEANING_SITUATION_PREFIX = 'leaning-';

/** The row the pole lines sit under. */
export const LEANING_FRAMING_SITUATION = `${LEANING_SITUATION_PREFIX}framing`;

export type LeaningSide = 'left' | 'right';

/** Which pole a stop leans toward, or `null` at rest. */
export function leaningSide(stop: LeaningStop): LeaningSide | null {
  if (stop === LEANING_REST) return null;
  return stop < 0 ? 'left' : 'right';
}

/** The row a stop selects, or `null` at rest. */
export function leaningSituation(key: LeaningKey, stop: LeaningStop): string | null {
  const side = leaningSide(stop);
  if (side === null) return null;
  const strong = Math.abs(stop) === 2 ? '-strong' : '';
  return `${LEANING_SITUATION_PREFIX}${key}-${side}${strong}`;
}

/** The dial and stop a pole row is for, or `null` for anything else (the framing included). */
export function leaningOfSituation(situation: string): AppliedLeaning | null {
  for (const dimension of LEANING_DIMENSIONS) {
    for (const stop of [-2, -1, 1, 2] as const) {
      if (leaningSituation(dimension.key, stop) === situation) return { key: dimension.key, stop };
    }
  }
  return null;
}

/** Whether a situation is a leaning row (a pole or the framing), by prefix. */
export function isLeaningSituation(situation: string): boolean {
  return situation.startsWith(LEANING_SITUATION_PREFIX);
}

/**
 * The poles held at rest under {@link HOLDING_SOURCES}: the ones that would be
 * hard on someone who is struggling.
 */
export const HELD_WHEN_HARD: ReadonlyMap<LeaningKey, LeaningSide> = new Map([
  ['directness', 'right'],
  ['encouragement', 'right'],
  ['warmth', 'right'],
  ['pace', 'left'],
  ['playfulness', 'left'],
]);

/** The register sources under which {@link HELD_WHEN_HARD} holds. */
export const HOLDING_SOURCES: ReadonlySet<RegisterSource> = new Set(['safety', 'fallback']);

/** One dial a turn applied, off rest. */
export const appliedLeaningSchema = z.strictObject({
  key: leaningKeySchema,
  stop: leaningStopSchema.refine((stop) => stop !== LEANING_REST, 'rest is never applied'),
});
export type AppliedLeaning = z.infer<typeof appliedLeaningSchema>;

/**
 * What a turn is stamped with at claim, and what its `done` frame, its
 * transcript read and its account say: the dials applied, in settings order,
 * and the dials the person set that were held at rest because something hard
 * is here. Both empty is "no leaning applied", which is a different fact from
 * no stamp at all (`null`: a seat with no leanings, or a turn from before them).
 */
export const leaningsStampSchema = z.strictObject({
  applied: z.array(appliedLeaningSchema),
  held: z.array(leaningKeySchema),
});
export type LeaningsStamp = z.infer<typeof leaningsStampSchema>;

export const NO_LEANINGS: LeaningsStamp = { applied: [], held: [] };

/** A stored stamp, or `null` when it is not one. Lenient: a row is read, not trusted. */
export function parseLeaningsStamp(value: unknown): LeaningsStamp | null {
  const parsed = leaningsStampSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** One dial as selection reads it: where the person has it, and today's bounds. */
export interface LeaningPosition {
  key: LeaningKey;
  stop: LeaningStop;
  min: LeaningStop;
  max: LeaningStop;
}

export interface SelectLeaningsInput {
  dials: readonly LeaningPosition[];
  /** Why the turn has its register, or null on a seat with none. */
  registerSource: RegisterSource | null;
  /** The overlay rows there are, so a stop with no row is not stamped as applied. */
  content: Pick<VoiceOverlays, 'overlays'>;
}

/**
 * The leanings a turn applies. Pure, so every rule is a table test:
 *
 * - each stop is clamped to its bounds again (the store already did; a stop
 *   that arrives out of bounds still cannot escape them);
 * - rest applies nothing;
 * - under a `safety` or `fallback` register a {@link HELD_WHEN_HARD} pole is
 *   held, and named in `held`;
 * - a stop with no row applies nothing and is not reported as held, and
 *   nothing applies with no framing row.
 *
 * Settings order, so the same dials always compose the same block.
 */
export function selectLeanings(input: SelectLeaningsInput): LeaningsStamp {
  const situations = new Set(input.content.overlays.map((overlay) => overlay.situation));
  if (!situations.has(LEANING_FRAMING_SITUATION)) return NO_LEANINGS;
  const holding = input.registerSource !== null && HOLDING_SOURCES.has(input.registerSource);

  const applied: AppliedLeaning[] = [];
  const held: LeaningKey[] = [];
  for (const dimension of LEANING_DIMENSIONS) {
    const dial = input.dials.find((candidate) => candidate.key === dimension.key);
    if (!dial) continue;
    const stop = clampToBounds(dial);
    const side = leaningSide(stop);
    if (side === null) continue;
    // A stop with no row could never apply, so it is neither applied nor
    // reported as set aside.
    const situation = leaningSituation(dimension.key, stop);
    if (situation === null || !situations.has(situation)) continue;
    if (holding && HELD_WHEN_HARD.get(dimension.key) === side) {
      held.push(dimension.key);
      continue;
    }
    applied.push({ key: dimension.key, stop });
  }
  return { applied, held };
}

/**
 * A dial's stop inside its bounds. A bound on the wrong side of rest (`min`
 * above 0, `max` below it) is read as rest, so rest is always inside, as
 * `leaningDialBoundsSchema` already guarantees for stored bounds.
 */
function clampToBounds(dial: LeaningPosition): LeaningStop {
  const min = Math.min(dial.min, LEANING_REST);
  const max = Math.max(dial.max, LEANING_REST);
  return Math.min(Math.max(dial.stop, min), max) as LeaningStop;
}

/**
 * The rows a stamp selects, framing first, then each applied pole in the
 * stamp's order. Empty when nothing applies, or when the framing row has gone
 * since the claim: a pole never reaches a prompt without it.
 */
export function leaningOverlays(
  content: Pick<VoiceOverlays, 'overlays'>,
  stamp: LeaningsStamp | null
): VoiceOverlay[] {
  if (stamp === null || stamp.applied.length === 0) return [];
  const bySituation = new Map(content.overlays.map((overlay) => [overlay.situation, overlay]));
  const framing = bySituation.get(LEANING_FRAMING_SITUATION);
  if (!framing) return [];
  const poles = stamp.applied.flatMap(({ key, stop }) => {
    const situation = leaningSituation(key, stop);
    const row = situation === null ? undefined : bySituation.get(situation);
    return row ? [row] : [];
  });
  return poles.length === 0 ? [] : [framing, ...poles];
}

/** Two stamps say the same thing. `null` is its own value. */
export function sameLeanings(a: LeaningsStamp | null, b: LeaningsStamp | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
