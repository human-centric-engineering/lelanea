/**
 * The voice overlays' projection (f-content-seeds t-88): the served shape built
 * from stored rows, and what it refuses to serve.
 *
 * Pure functions, no database import — so the cases build rows by hand rather
 * than through the seed, and a row this module SHOULD reject (an unknown
 * status, a malformed JSON column, two overlays claiming the same situation) is
 * expressible without a schema upstream stopping it first. The success path
 * (a real seeded set, in reading order) is also exercised through
 * `voice-overlay-store.test.ts`, which calls this projection with rows built by
 * the real seed builder; these cases fill in the branches that only a
 * deliberately malformed row can reach.
 *
 * @see lib/app/content/voice-overlay-view.ts
 * @see lib/app/content/voice-overlay-store.ts — the store that calls these
 */

import { describe, expect, it } from 'vitest';
import {
  toVoiceOverlay,
  toVoiceOverlays,
  type VoiceOverlayRow,
  type VoiceOverlaySetRow,
} from '@/lib/app/content/voice-overlay-view';

function overlayRow(overrides: Partial<VoiceOverlayRow> = {}): VoiceOverlayRow {
  return {
    situation: 'first_message',
    position: 1,
    label: 'First message',
    reviewerNote: 'Use when opening a conversation.',
    heading: 'Opening beats',
    lines: ['Beat one.'],
    exemplarQuery: 'first contact',
    status: 'draft',
    revision: 1,
    ...overrides,
  };
}

function setRow(overrides: Partial<VoiceOverlaySetRow> = {}): VoiceOverlaySetRow {
  return {
    id: 'lelanea_voice_fingerprint_overlays',
    title: "Her fingerprint's overlays",
    version: '1.0',
    locale: 'en-US',
    provenance: {
      status: 'drafted',
      awaitingSignOffFrom: 'her',
      note: 'A proposal, not yet hers.',
    },
    exemplars: {
      heading: 'In her words',
      originLabel: 'From her writing',
      lines: ['A line drawn from the corpus.'],
      noneFoundNote: 'Nothing matched this search.',
      unavailableNote: 'The search could not run.',
    },
    coreOnly: { heading: 'Her core voice', lines: ['A core beat.'] },
    status: 'draft',
    revision: 1,
    ...overrides,
  };
}

describe('toVoiceOverlay', () => {
  it('serves the reviewer note as `when`, and everything else straight from the row', () => {
    const overlay = toVoiceOverlay(
      overlayRow({ situation: 'crisis', reviewerNote: 'Only a reviewer should see this.' })
    );

    expect(overlay).toMatchObject({
      situation: 'crisis',
      when: 'Only a reviewer should see this.',
      status: 'draft',
    });
  });

  it('throws on a status outside the known vocabulary', () => {
    expect(() => toVoiceOverlay(overlayRow({ status: 'published' }))).toThrow(
      /unknown status "published"/
    );
  });
});

describe('toVoiceOverlays', () => {
  it('sorts the overlays by position, whatever order the rows arrive in', () => {
    const rows = [
      overlayRow({ situation: 'second', position: 2 }),
      overlayRow({ situation: 'first', position: 1 }),
    ];

    const overlays = toVoiceOverlays(setRow(), rows);

    expect(overlays.overlays.map((overlay) => overlay.situation)).toEqual(['first', 'second']);
  });

  it('throws on a malformed provenance block', () => {
    expect(() => toVoiceOverlays(setRow({ provenance: { status: 'drafted' } }), [])).toThrow(
      /failed validation on read/
    );
  });

  it('throws on a malformed exemplars block', () => {
    expect(() => toVoiceOverlays(setRow({ exemplars: { heading: 'In her words' } }), [])).toThrow(
      /failed validation on read/
    );
  });

  it('throws on a core-only body with no lines', () => {
    expect(() =>
      toVoiceOverlays(setRow({ coreOnly: { heading: 'Her core voice', lines: [] } }), [])
    ).toThrow(/failed validation on read/);
  });

  it('throws on a set whose own status is outside the known vocabulary', () => {
    expect(() => toVoiceOverlays(setRow({ status: 'live' }), [])).toThrow(
      /failed validation on read/
    );
  });

  it('throws when two overlays claim the same situation — a selection bug, not a display one', () => {
    const rows = [
      overlayRow({ situation: 'crisis', position: 1 }),
      overlayRow({ situation: 'crisis', position: 2 }),
    ];

    expect(() => toVoiceOverlays(setRow(), rows)).toThrow(/"crisis" is listed twice/);
  });
});
