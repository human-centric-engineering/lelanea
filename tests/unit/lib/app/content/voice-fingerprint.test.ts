/**
 * The seventh authored file: the always-on core of the voice fingerprint.
 *
 * It reads the REAL `content/lelanea_voice_fingerprint.json` through the
 * accessor that ships, for the same reason `schemas.test.ts` does: a fixture
 * would test the schema against itself, and the coupling to what is actually
 * authored is the whole value.
 *
 * What this file is for, over and above "it parses":
 *
 * - **Provenance cannot go quiet.** This is the only content file that was
 *   DRAFTED rather than transcribed, and the difference matters to anyone who
 *   puts it in front of a model. The provenance block is asserted to be served
 *   rather than withheld, and asserted to still be awaiting her sign-off — which
 *   is a case that is MEANT to be edited, once, on the day she signs it off.
 * - **The version is orderable.** An evaluation attributes an output to a
 *   fingerprint version; "v2 draft" cannot be compared to anything.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * Every case here is about Lelañea's authored core, not a platform contract. A
 * fork that replaces `content/` with its own material has no
 * `lelanea_voice_fingerprint.json` and should expect the whole file to fail.
 *
 * Rewrite it against your own core rather than deleting it: the coupling to real
 * authored text is the entire value, and the provenance case in particular is
 * what stops a drafted file passing itself off as a transcribed one. If your
 * fork ships no voice fingerprint at all, delete the file and the schema
 * together — a file left behind asserting an absent seam is worse than neither.
 *
 * @see lib/app/content/schemas.ts — `voiceFingerprintFileSchema`
 * @see tests/unit/lib/app/voice/fingerprint.test.ts — what the core becomes
 */

import { describe, it, expect } from 'vitest';
import { getVoiceFingerprint } from '@/lib/app/content';
import { voiceFingerprintFileSchema } from '@/lib/app/content/schemas';

/** A file that satisfies every rule, to mutate in the drift cases below. */
function validFingerprintFile() {
  return {
    fingerprint: {
      id: 'f',
      title: 'T',
      layer: 'core',
      version: '1.0',
      locale: 'en-US',
      textFormat: 'plain',
      provenance: {
        status: 'drafted_from_corpus',
        awaitingSignOffFrom: 'Lelañea Fulton',
        note: 'n',
      },
      sourceFiles: [],
      notes: [],
    },
    identity: { heading: 'Who you are', lines: ['a'] },
    cadence: { heading: 'How you sound', lines: ['a'], reachesFor: ['x'], avoids: ['y'] },
    grounding: { heading: 'How you ground', lines: ['a'] },
    boundaries: { heading: 'What you decline', lines: ['a'], howYouDecline: ['a'] },
    reviewNotes: [],
  };
}

describe('the authored core', () => {
  it('parses, with all four blocks carrying beats', () => {
    const core = getVoiceFingerprint();

    expect(core.identity.lines.length).toBeGreaterThan(0);
    expect(core.cadence.lines.length).toBeGreaterThan(0);
    expect(core.grounding.lines.length).toBeGreaterThan(0);
    expect(core.boundaries.lines.length).toBeGreaterThan(0);
    expect(core.boundaries.howYouDecline.length).toBeGreaterThan(0);
  });

  it('names the words she reaches for and the ones she avoids', () => {
    // Both halves, because the second is the telling one and is the half a
    // drafting pass is most likely to drop.
    const { cadence } = getVoiceFingerprint();

    expect(cadence.reachesFor.length).toBeGreaterThan(0);
    expect(cadence.avoids.length).toBeGreaterThan(0);
  });

  it('carries an orderable version', () => {
    expect(getVoiceFingerprint().collection.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it('serves its provenance rather than withholding it', () => {
    // `reviewNotes` are working notes about the words and are deliberately not
    // served. Provenance is not that: it is a fact about the artefact that every
    // caller putting it in front of a model needs to be able to read.
    const { provenance } = getVoiceFingerprint();

    expect(provenance.status).toBe('drafted_from_corpus');
    expect(provenance.note).toBeTruthy();
  });

  it('is still awaiting her sign-off', () => {
    // THIS CASE IS MEANT TO BE EDITED — once, on the day Lelañea signs the core
    // off. Until then it is the thing standing between a drafted file and the
    // six transcriptions beside it, and deleting it would make that difference
    // invisible. See `.context/app/voice.md`.
    expect(getVoiceFingerprint().provenance.awaitingSignOffFrom).toBe('Lelañea Fulton');
  });

  it('is memoised, so the same frozen object is handed out every time', () => {
    expect(getVoiceFingerprint()).toBe(getVoiceFingerprint());
    expect(Object.isFrozen(getVoiceFingerprint().identity.lines)).toBe(true);
  });
});

describe('drift fails loudly', () => {
  it('accepts the shape the loader expects', () => {
    expect(() => voiceFingerprintFileSchema.parse(validFingerprintFile())).not.toThrow();
  });

  it('rejects an unknown key rather than dropping it', () => {
    const file = { ...validFingerprintFile(), overlays: [] };

    expect(() => voiceFingerprintFileSchema.parse(file)).toThrow();
  });

  it('rejects a block with a heading and no beats', () => {
    const file = validFingerprintFile();
    file.identity.lines = [];

    expect(() => voiceFingerprintFileSchema.parse(file)).toThrow();
  });

  it('rejects a version that cannot be ordered', () => {
    const file = validFingerprintFile();
    file.fingerprint.version = 'v2 draft';

    expect(() => voiceFingerprintFileSchema.parse(file)).toThrow(/major\.minor/);
  });

  it('rejects a file that claims to be an overlay', () => {
    // Overlays are a later layer with a different shape and different rules
    // about what may reach the core. A file that parsed as both would be read by
    // the loader as a core.
    const file = validFingerprintFile();
    file.fingerprint.layer = 'overlay';

    expect(() => voiceFingerprintFileSchema.parse(file)).toThrow();
  });

  it('rejects a file with no provenance', () => {
    const file: Record<string, unknown> = validFingerprintFile();
    delete (file.fingerprint as Record<string, unknown>).provenance;

    expect(() => voiceFingerprintFileSchema.parse(file)).toThrow();
  });
});
