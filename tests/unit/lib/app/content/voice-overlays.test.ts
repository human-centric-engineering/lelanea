/**
 * The eighth authored file: the voice fingerprint's context-selected overlays.
 *
 * It reads the REAL `seed-data/drafted/lelanea_voice_overlays.json` through the
 * seed builder that ships (`buildVoiceOverlaySeed`), for the same reason its
 * sibling does: a fixture would test the schema against itself, and the
 * coupling to what is actually authored is the whole value.
 *
 * Since t-88 the overlays are read at request time from
 * `app_voice_overlay_set` / `app_voice_overlay` through
 * `@/lib/app/content/voice-overlay-store`'s `getVoiceOverlays()` — async, and
 * with no in-process memoisation, because the read happens per request behind
 * the context builder's own 60s cache. This file is not about that runtime
 * accessor; it is about the FILE the seed still writes from, so it asserts
 * against `buildVoiceOverlaySeed()` projected the same way the store projects
 * a seeded row (`toVoiceOverlays`), matching what
 * `tests/helpers/app/content-stores.ts`'s `seededVoiceOverlayRows()` builds for
 * every other suite that fakes this store.
 *
 * What this file is for, over and above "it parses":
 *
 * - **Provenance cannot go quiet.** This is the SECOND drafted file beside six
 *   transcribed ones, and the same rule applies: the block is served rather than
 *   withheld, and it still names who has yet to sign it off. That case is MEANT
 *   to be edited, once, on the day she signs these off.
 * - **Nothing the model reads is a TypeScript literal.** Every heading, label
 *   and line — including the origin label that makes a retrieved passage safe to
 *   show — is authored here. A case below pins each of them present, because the
 *   tempting shortcut when adding a fifth situation is to put the new copy in the
 *   loader where it is one line away from working.
 * - **Situations are addressable.** A situation key travels as a request's
 *   `contextId`; one with a space or a capital in it would be authored and
 *   unreachable, and the failure is a silent fall back to core-only.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * Every case here is about Lelañea's authored overlays, not a platform contract.
 * A fork with its own `content/` has no `lelanea_voice_overlays.json` and should
 * expect the whole file to fail. Rewrite it against your own overlays rather than
 * deleting it; if your fork ships none, delete the file and the schema together.
 *
 * @see lib/app/content/schemas.ts — `voiceOverlaysFileSchema`
 * @see lib/app/content/seed-input/voice-overlay-seed.ts — the seed builder this file exercises
 * @see tests/unit/lib/app/voice/overlays.test.ts — how one is selected
 */

import { describe, it, expect } from 'vitest';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { toVoiceOverlays, type VoiceOverlays } from '@/lib/app/content/voice-overlay-view';
import { voiceOverlaysFileSchema } from '@/lib/app/content/schemas';

/**
 * The authored file, projected exactly as the store projects a seeded row —
 * i.e. what `getVoiceOverlays()` returns once the seed has run. Built fresh
 * per call (no memoisation to preserve — see the deleted case below).
 */
function authoredOverlays(): VoiceOverlays {
  const seed = buildVoiceOverlaySeed();
  return toVoiceOverlays(
    { ...seed.set, status: 'draft', revision: 1 },
    seed.overlays.map((overlay) => ({ ...overlay, status: 'draft', revision: 1 }))
  );
}

/** A file that satisfies every rule, to mutate in the drift cases below. */
function validOverlaysFile() {
  return {
    fingerprint: {
      id: 'o',
      title: 'T',
      layer: 'overlays',
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
    overlays: [
      {
        situation: 'first-meeting',
        label: 'L',
        when: 'w',
        heading: 'H',
        lines: ['a'],
        exemplarQuery: 'q',
      },
    ],
    exemplars: {
      heading: 'H',
      originLabel: 'O',
      lines: ['a'],
      noneFoundNote: 'n',
      unavailableNote: 'u',
    },
    coreOnly: { heading: 'H', lines: ['a'] },
    reviewNotes: [],
  };
}

describe('the authored overlays', () => {
  it('parses, with every overlay carrying beats and a query', () => {
    const content = authoredOverlays();

    expect(content.overlays.length).toBeGreaterThan(0);
    for (const overlay of content.overlays) {
      expect(overlay.lines.length).toBeGreaterThan(0);
      expect(overlay.exemplarQuery.trim().length).toBeGreaterThan(0);
    }
  });

  it('authors every string the prompt shows, the origin label included', () => {
    const content = authoredOverlays();

    // The one string here that is a safety property rather than copy: it is what
    // tells the model her writing from the person's.
    expect(content.exemplars.originLabel.trim().length).toBeGreaterThan(0);
    expect(content.exemplars.heading.trim().length).toBeGreaterThan(0);
    expect(content.exemplars.lines.length).toBeGreaterThan(0);
    expect(content.exemplars.noneFoundNote.trim().length).toBeGreaterThan(0);
    expect(content.exemplars.unavailableNote.trim().length).toBeGreaterThan(0);
    expect(content.coreOnly.heading.trim().length).toBeGreaterThan(0);
    expect(content.coreOnly.lines.length).toBeGreaterThan(0);
  });

  it('gives every situation a key a route can pin and a request can carry', () => {
    for (const overlay of authoredOverlays().overlays) {
      expect(overlay.situation).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      // `contextId` is `z.string().max(100)` on the wire.
      expect(overlay.situation.length).toBeLessThanOrEqual(100);
    }
  });

  it('names each situation once, so no overlay is unreachable', () => {
    const situations = authoredOverlays().overlays.map((overlay) => overlay.situation);

    expect(new Set(situations).size).toBe(situations.length);
  });

  it('carries an orderable version', () => {
    expect(authoredOverlays().collection.version).toMatch(/^\d+\.\d+(\.\d+)?$/);
  });

  it('serves its provenance rather than withholding it', () => {
    const provenance = authoredOverlays().provenance;

    expect(provenance.status).toBe('drafted_from_corpus');
    expect(provenance.note.trim().length).toBeGreaterThan(0);
  });

  it('is still awaiting her sign-off', () => {
    // MEANT TO BE EDITED — once, on the day she signs these overlays off. Until
    // then every line in that file is a proposal in her register, and anything
    // putting it in front of a model should be able to read that.
    expect(authoredOverlays().provenance.awaitingSignOffFrom).toBe('Lelañea Fulton');
  });

  // DELETED (t-88): "is memoised, so the same frozen object is handed out every
  // time". `getVoiceOverlays()` moved to `@/lib/app/content/voice-overlay-store`,
  // is async, and reads `app_voice_overlay_set` / `app_voice_overlay` fresh on
  // every call — the context builder above it already caches the composed block
  // for 60s per `(type, id, userId)` (see the store's own docblock), so a second,
  // in-process memoisation here would only stack a staleness window on top of
  // that one. There is no per-process memoisation left to assert, and faking one
  // would test a property the code no longer has.
});

describe('drift fails loudly', () => {
  it('accepts the shape the loader expects', () => {
    expect(() => voiceOverlaysFileSchema.parse(validOverlaysFile())).not.toThrow();
  });

  it('rejects an unknown key rather than dropping it', () => {
    const file = { ...validOverlaysFile(), somethingNew: true };

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects a duplicate situation, which would make the second unreachable', () => {
    const file = validOverlaysFile();
    file.overlays = [file.overlays[0], { ...file.overlays[0], heading: 'Another' }];

    // Not a tidiness rule: selection is a lookup, so whoever authored the second
    // would have no way to tell from the file that their lines never ship.
    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow(/duplicate situation/);
  });

  it('rejects a situation key a request could never carry', () => {
    const file = validOverlaysFile();
    file.overlays[0].situation = 'First Meeting';

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects an overlay with a heading and no beats', () => {
    const file = validOverlaysFile();
    file.overlays[0].lines = [];

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects an empty exemplar query, which would search her material for nothing', () => {
    const file = validOverlaysFile();
    file.overlays[0].exemplarQuery = '   ';

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects a core-only fallback with nothing to say', () => {
    const file = validOverlaysFile();
    file.coreOnly.lines = [];

    // The fallback body is what stands between an unknown situation and an empty
    // block, so an empty one is the failure this whole branch exists to avoid.
    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('says a different thing for a search that failed and one that found nothing', () => {
    // Two authored sentences because they are two facts. Collapsing them made
    // the block report an empty search result for a search that never ran.
    const content = authoredOverlays();

    expect(content.exemplars.unavailableNote).not.toBe(content.exemplars.noneFoundNote);
  });

  it('rejects an exemplars block with no retrieval-unavailable line', () => {
    const file: Record<string, unknown> = validOverlaysFile();
    delete (file.exemplars as Record<string, unknown>).unavailableNote;

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects an empty origin label', () => {
    const file = validOverlaysFile();
    file.exemplars.originLabel = '';

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects a file that claims to be the core', () => {
    const file = validOverlaysFile();
    file.fingerprint.layer = 'core';

    // The two files are read by different loaders and projected differently.
    // `layer` is what stops one being handed to the other's reader.
    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });

  it('rejects a file with no provenance', () => {
    const file: Record<string, unknown> = validOverlaysFile();
    delete (file.fingerprint as Record<string, unknown>).provenance;

    expect(() => voiceOverlaysFileSchema.parse(file)).toThrow();
  });
});
