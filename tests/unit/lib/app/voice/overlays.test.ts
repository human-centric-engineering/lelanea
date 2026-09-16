/**
 * Selecting a register is a lookup, and it stays one.
 *
 * The overlay a person meets must not depend on a similarity score, a locale, or
 * which order the file happens to be in. This file pins that: exact match on a
 * normalised key, `null` for anything unknown, and no behaviour at all that
 * could be described as "closest".
 *
 * The vocabulary itself is read back out of the authored file rather than typed
 * here, so adding a fifth situation is an edit to
 * `content/lelanea_voice_overlays.json` and nothing else — a hardcoded list in a
 * test is the second authoring path the content seam exists to prevent, and it
 * would go stale silently.
 */

import { describe, it, expect } from 'vitest';
import { selectOverlay, normaliseSituation, knownSituations } from '@/lib/app/voice/overlays';
import { getVoiceOverlays } from '@/lib/app/content';

const CONTENT = getVoiceOverlays();

describe('selectOverlay', () => {
  it('returns the overlay authored for each situation the file declares', () => {
    // fp6: the file is non-empty, so the loop below is not vacuously green.
    expect(CONTENT.overlays.length).toBeGreaterThan(0);

    for (const overlay of CONTENT.overlays) {
      expect(selectOverlay(overlay.situation)).toEqual(overlay);
    }
  });

  it('returns null for a situation nobody authored', () => {
    expect(selectOverlay('a-situation-nobody-authored')).toBeNull();
  });

  it('returns null rather than the first overlay for an empty key', () => {
    // The dangerous shape is a selector that falls through to `overlays[0]`: an
    // unknown situation would then quietly get the FIRST register in the file,
    // which is a wrong answer that looks exactly like a right one.
    expect(selectOverlay('')).toBeNull();
    expect(selectOverlay('   ')).toBeNull();
  });

  it('tolerates the padding and case a hand-typed contextId arrives with', () => {
    const first = CONTENT.overlays[0];

    expect(selectOverlay(`  ${first.situation.toUpperCase()}  `)).toEqual(first);
  });

  it('does not repair a key beyond trimming and lower-casing', () => {
    const first = CONTENT.overlays[0];

    // Under-scores are not hyphens and a prefix is not a match. Anything more
    // forgiving is the fuzzy matching this module exists not to do — and would
    // make which register a person meets depend on how close their key was.
    expect(selectOverlay(first.situation.replaceAll('-', '_'))).toBeNull();
    expect(selectOverlay(first.situation.slice(0, 3))).toBeNull();
    expect(selectOverlay(`${first.situation}-extra`)).toBeNull();
  });

  it('is stable: the same key selects the same overlay every time', () => {
    const first = CONTENT.overlays[0];

    expect(selectOverlay(first.situation)).toBe(selectOverlay(first.situation));
  });
});

describe('normaliseSituation', () => {
  it('trims and lower-cases, and does nothing else', () => {
    expect(normaliseSituation('  First-Meeting ')).toBe('first-meeting');
    expect(normaliseSituation('first meeting')).toBe('first meeting');
  });
});

describe('knownSituations', () => {
  it('is the authored vocabulary, in authored order', () => {
    expect(knownSituations()).toEqual(CONTENT.overlays.map((overlay) => overlay.situation));
  });

  it('is every key a route could pin — each one selectable', () => {
    for (const situation of knownSituations()) {
      expect(selectOverlay(situation)).not.toBeNull();
    }
  });
});
