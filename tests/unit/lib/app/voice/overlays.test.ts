/**
 * Selecting a register is a lookup, and it stays one.
 *
 * The overlay a person meets must not depend on a similarity score, a locale, or
 * which order the rows happen to be in. This file pins that: exact match on a
 * normalised key, `null` for anything unknown, and no behaviour at all that
 * could be described as "closest".
 *
 * The vocabulary itself is read back out of the store rather than typed here,
 * so adding a fifth situation is a row and nothing else — a hardcoded list in a
 * test is the second authoring path the content seam exists to prevent, and it
 * would go stale silently.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this mocks the store, not the seam
 * ---------------------------------------------------------------------------
 * Since t-88 the overlays are `app_voice_overlay` rows, so the fake store is
 * what stands in for the database. It is still built from the REAL authored
 * file through the REAL seed builder and the REAL projection, so this file
 * still asserts against her actual words rather than a fixture someone wrote
 * to make the test pass.
 *
 * **What a fork should expect.** Upstream there is no overlay table and no
 * `voice-overlay-store`, so this fails at import. That is the seam being
 * unfilled, not a defect.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/app/content/voice-overlay-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeVoiceOverlayStore()
);

import {
  selectOverlay,
  selectOverlayFrom,
  normaliseSituation,
  knownSituations,
} from '@/lib/app/voice/overlays';
import { getVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import { fakeVoiceOverlayStore } from '@/tests/helpers/app/content-stores';

beforeEach(() => fakeVoiceOverlayStore().reset());

describe('selectOverlay', () => {
  it('returns the overlay stored for each situation the rows declare', async () => {
    const content = await getVoiceOverlays();
    // fp6: the table is non-empty, so the loop below is not vacuously green.
    expect(content.overlays.length).toBeGreaterThan(0);

    for (const overlay of content.overlays) {
      await expect(selectOverlay(overlay.situation)).resolves.toEqual(overlay);
    }
  });

  it('returns null for a situation nobody authored', async () => {
    await expect(selectOverlay('a-situation-nobody-authored')).resolves.toBeNull();
  });

  it('returns null rather than the first overlay for an empty key', async () => {
    // The dangerous shape is a selector that falls through to `overlays[0]`: an
    // unknown situation would then quietly get the FIRST register in the table,
    // which is a wrong answer that looks exactly like a right one.
    await expect(selectOverlay('')).resolves.toBeNull();
    await expect(selectOverlay('   ')).resolves.toBeNull();
  });

  it('does not read the table at all for an empty key', async () => {
    const store = fakeVoiceOverlayStore();
    store.getVoiceOverlays.mockClear();

    await selectOverlay('   ');

    // Every core-only turn takes this path, so it must not cost a query.
    expect(store.getVoiceOverlays).not.toHaveBeenCalled();
  });

  it('tolerates the padding and case a hand-typed contextId arrives with', async () => {
    const [first] = (await getVoiceOverlays()).overlays;

    await expect(selectOverlay(`  ${first.situation.toUpperCase()}  `)).resolves.toEqual(first);
  });

  it('does not repair a key beyond trimming and lower-casing', async () => {
    const [first] = (await getVoiceOverlays()).overlays;

    // Under-scores are not hyphens and a prefix is not a match. Anything more
    // forgiving is the fuzzy matching this module exists not to do — and would
    // make which register a person meets depend on how close their key was.
    await expect(selectOverlay(first.situation.replaceAll('-', '_'))).resolves.toBeNull();
    await expect(selectOverlay(first.situation.slice(0, 3))).resolves.toBeNull();
    await expect(selectOverlay(`${first.situation}-extra`)).resolves.toBeNull();
  });

  it('is stable: the same key selects the same overlay every time', async () => {
    const [first] = (await getVoiceOverlays()).overlays;

    // Identity is no longer the assertion — each read builds a fresh object
    // from the rows — so this pins the thing that actually matters: the same
    // key resolves to the same overlay, twice running.
    await expect(selectOverlay(first.situation)).resolves.toEqual(
      await selectOverlay(first.situation)
    );
  });

  it('follows the row, not the file: an edited overlay is what gets selected', async () => {
    const [first] = (await getVoiceOverlays()).overlays;
    fakeVoiceOverlayStore().editOverlay(first.situation, { heading: 'Edited in the database.' });

    const selected = await selectOverlay(first.situation);

    expect(selected?.heading).toBe('Edited in the database.');
    expect(selected?.heading).not.toBe(first.heading);
  });

  it('stops selecting a situation whose row was removed', async () => {
    const [first] = (await getVoiceOverlays()).overlays;
    fakeVoiceOverlayStore().removeOverlay(first.situation);

    await expect(selectOverlay(first.situation)).resolves.toBeNull();
  });
});

describe('selectOverlayFrom', () => {
  it('matches against an already-read set, so one turn needs one read', async () => {
    const content = await getVoiceOverlays();
    const store = fakeVoiceOverlayStore();
    store.getVoiceOverlays.mockClear();

    for (const overlay of content.overlays) {
      expect(selectOverlayFrom(content, overlay.situation)).toEqual(overlay);
    }

    expect(store.getVoiceOverlays).not.toHaveBeenCalled();
  });

  it('applies the same normalisation and the same refusals as the reading form', async () => {
    const content = await getVoiceOverlays();
    const [first] = content.overlays;

    expect(selectOverlayFrom(content, `  ${first.situation.toUpperCase()}  `)).toEqual(first);
    expect(selectOverlayFrom(content, '')).toBeNull();
    expect(selectOverlayFrom(content, `${first.situation}-extra`)).toBeNull();
  });
});

describe('normaliseSituation', () => {
  it('trims and lower-cases, and does nothing else', () => {
    expect(normaliseSituation('  First-Meeting ')).toBe('first-meeting');
    expect(normaliseSituation('first meeting')).toBe('first meeting');
  });
});

describe('knownSituations', () => {
  it('is the stored vocabulary, in authored order', async () => {
    const content = await getVoiceOverlays();

    await expect(knownSituations()).resolves.toEqual(
      content.overlays.map((overlay) => overlay.situation)
    );
  });

  it('is every key a route could pin — each one selectable', async () => {
    for (const situation of await knownSituations()) {
      await expect(selectOverlay(situation)).resolves.not.toBeNull();
    }
  });
});

describe('an unseeded database', () => {
  it('refuses rather than falling back to the bundled file', async () => {
    fakeVoiceOverlayStore().empty();

    // There is no floor beneath the rows since t-88. A selector that answered
    // from the file here would be serving words nobody signed off.
    await expect(selectOverlay('first-meeting')).rejects.toThrow(/019-voice-overlays/);
  });
});
