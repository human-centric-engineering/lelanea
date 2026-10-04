/**
 * The leanings' vocabulary and bounds (f-leanings t-135): pure, so these run
 * with no database.
 *
 * @see lib/app/voice/leanings.ts
 */

import { describe, it, expect } from 'vitest';

import {
  LEANING_DIMENSIONS,
  LEANING_KEYS,
  LEANING_REASONING_NOTES,
  LEANING_SLOT_GROUP,
  LEANING_SOURCE_TYPE,
  LEANING_STOPS,
  clampLeaning,
  describeLeaning,
  isLocked,
  isOurLeaningVersion,
  leaningBoundsSchema,
  leaningChangeSchema,
  leaningDialBoundsSchema,
  leaningKeyOfSlug,
  leaningSlotDefinitions,
  leaningSlotSlug,
} from '@/lib/app/voice/leanings';
import { readVoiceOverlaysFile } from '@/lib/app/content/seed-input/voice-overlay-seed';

describe('the eleven dimensions', () => {
  it('cover every key once, in the order settings shows them', () => {
    expect(LEANING_DIMENSIONS.map((dimension) => dimension.key)).toEqual([...LEANING_KEYS]);
    expect(LEANING_KEYS).toHaveLength(11);
  });

  it('name §3.4’s poles, the left one first', () => {
    expect(LEANING_DIMENSIONS[0]).toEqual({
      key: 'abstraction',
      left: 'Philosophical',
      right: 'Grounded and practical',
    });
    expect(LEANING_DIMENSIONS.find((d) => d.key === 'questions')).toMatchObject({
      left: 'Question-led',
      right: 'Guidance-led',
    });
  });

  it('have five stops with rest in the middle', () => {
    expect([...LEANING_STOPS]).toEqual([-2, -1, 0, 1, 2]);
  });
});

describe('the slots', () => {
  it('map a key to its slug and back, and refuse a slug no dial has', () => {
    expect(leaningSlotSlug('length')).toBe('leaning_length');
    expect(leaningKeyOfSlug('leaning_length')).toBe('length');
    expect(leaningKeyOfSlug('leaning_unknown')).toBeNull();
    expect(leaningKeyOfSlug('length')).toBeNull();
  });

  it('are hidden, numeric and in their own group, so capture and the notes panel never show them', () => {
    const definitions = leaningSlotDefinitions();

    expect(definitions).toHaveLength(11);
    for (const definition of definitions) {
      expect(definition).toMatchObject({
        group: LEANING_SLOT_GROUP,
        visibility: 'hidden',
        dataType: 'number',
        sensitivity: 'standard',
      });
      expect(definition.slug.startsWith('leaning_')).toBe(true);
    }
  });
});

describe('which stored versions are ours', () => {
  const ours = {
    sourceType: LEANING_SOURCE_TYPE,
    reasoningNote: LEANING_REASONING_NOTES.settings,
    valueJson: 1,
  };

  it('accepts what the writer writes, from settings or by asking', () => {
    expect(isOurLeaningVersion(ours)).toBe(true);
    expect(isOurLeaningVersion({ ...ours, reasoningNote: LEANING_REASONING_NOTES.asked })).toBe(
      true
    );
  });

  it('refuses a version in any other shape, as a fill_slot write would be', () => {
    // Each differs from ours in one field only, so each refusal is that field's.
    expect(isOurLeaningVersion({ ...ours, sourceType: 'direct' })).toBe(false);
    expect(
      isOurLeaningVersion({ ...ours, reasoningNote: 'They said they like short answers.' })
    ).toBe(false);
    expect(isOurLeaningVersion({ ...ours, valueJson: 3 })).toBe(false);
    expect(isOurLeaningVersion({ ...ours, valueJson: '1' })).toBe(false);
    expect(isOurLeaningVersion({ ...ours, valueJson: null })).toBe(false);
  });
});

describe('bounds', () => {
  it('always keep rest inside the range, so nobody can be pinned away from her voice', () => {
    expect(leaningDialBoundsSchema.safeParse({ min: -2, max: 2, suggest: true }).success).toBe(
      true
    );
    expect(leaningDialBoundsSchema.safeParse({ min: 1, max: 2, suggest: true }).success).toBe(
      false
    );
    expect(leaningDialBoundsSchema.safeParse({ min: -2, max: -1, suggest: true }).success).toBe(
      false
    );
  });

  it('read locked as a range of rest alone', () => {
    expect(isLocked({ min: 0, max: 0, suggest: false })).toBe(true);
    expect(isLocked({ min: 0, max: 1, suggest: false })).toBe(false);
  });

  it('clamp a stop to the nearest allowed one', () => {
    const bounds = { min: -1, max: 1, suggest: true } as const;
    expect(clampLeaning(2, bounds)).toBe(1);
    expect(clampLeaning(-2, bounds)).toBe(-1);
    expect(clampLeaning(0, bounds)).toBe(0);
  });

  it('require every dial, so an edit can’t drop one silently', () => {
    const { dials } = readVoiceOverlaysFile().leanings!;
    const { questions: _dropped, ...ten } = dials;

    expect(leaningBoundsSchema.safeParse({ suggest: true, dials: ten }).success).toBe(false);
  });

  it('as drafted: everything moves, but nothing stops her asking questions or turns her cold', () => {
    const bounds = leaningBoundsSchema.parse(readVoiceOverlaysFile().leanings);

    // §7.3's own examples: "plainer, but not to stop asking questions", and
    // "nothing may switch off how she handles distress".
    expect(bounds.dials.questions).toMatchObject({ min: -2, max: 1 });
    expect(bounds.dials.warmth).toMatchObject({ min: -2, max: 1 });
    const free = LEANING_KEYS.filter((key) => key !== 'questions' && key !== 'warmth');
    expect(free).toHaveLength(9);
    for (const key of free) expect(bounds.dials[key]).toMatchObject({ min: -2, max: 2 });
    expect(bounds.suggest).toBe(true);
  });
});

describe('the words a version stores', () => {
  it('say which way and how far', () => {
    const length = LEANING_DIMENSIONS.find((d) => d.key === 'length')!;
    expect(describeLeaning(length, -2)).toBe('Strongly toward Verbose and exploratory');
    expect(describeLeaning(length, 1)).toBe('Toward Concise and spare');
    expect(describeLeaning(length, 0)).toBe('At rest');
  });
});

describe('the API’s body', () => {
  it('takes one known dial and one stop, and nothing else', () => {
    expect(leaningChangeSchema.safeParse({ key: 'length', stop: 2 }).success).toBe(true);
    expect(leaningChangeSchema.safeParse({ key: 'length', stop: 3 }).success).toBe(false);
    expect(leaningChangeSchema.safeParse({ key: 'tone', stop: 1 }).success).toBe(false);
    expect(
      leaningChangeSchema.safeParse({ key: 'length', stop: 1, userId: 'someone' }).success
    ).toBe(false);
  });
});
