/**
 * The voice overlays as seed material (f-content-seeds t-88).
 *
 * `seed-data/drafted/lelanea_voice_overlays.json` is no longer read at request
 * time. `lib/app/voice/overlays.ts` and `lib/app/voice/context-contributor.ts`
 * read `app_voice_overlay_set` and `app_voice_overlay` through
 * `@/lib/app/content/voice-overlay-store`. This module is where the file is
 * still imported; its callers are the seed
 * (`prisma/seeds/app-lelanea/019-voice-overlays.ts`) and tests.
 *
 * **The file stays a drafted proposal.** It was written in her register rather
 * than transcribed from her, and the owner's ruling (2026-09-21) is that it
 * remains a seed draft labelled as an unsigned proposal. That is what the
 * `provenance` block carries into the row, and why every row is seeded
 * `draft`: nothing here claims she has approved it.
 *
 * What is seeded is what was served: the file's `sourceFiles`, `notes`,
 * `textFormat` and `reviewNotes` are working notes about the words and are not
 * written to a row.
 */

import rawVoiceOverlays from '@/seed-data/drafted/lelanea_voice_overlays.json';
import { voiceOverlaysFileSchema, type VoiceOverlaysFile } from '@/lib/app/content/schemas';
// From the view, NOT the store: the store is mocked with an async factory in
// `context-contributor.test.ts`, and that factory imports the fake-store
// helper, which imports this module — so a store import here closes a cycle
// through a factory already in flight and vitest deadlocks (0% CPU, no
// output). The view imports neither of them. See its docblock on the constant.
import {
  VOICE_OVERLAY_SET_ID,
  type VoiceOverlayRow,
  type VoiceOverlaySetRow,
} from '@/lib/app/content/voice-overlay-view';

/** What the seed writes: the set and its overlays, at revision 1. */
export interface VoiceOverlaySeed {
  set: Omit<VoiceOverlaySetRow, 'revision' | 'status'>;
  overlays: Omit<VoiceOverlayRow, 'revision' | 'status'>[];
}

/** The overlays file, validated. Seeds and tests only. */
export function readVoiceOverlaysFile(): VoiceOverlaysFile {
  return voiceOverlaysFileSchema.parse(rawVoiceOverlays);
}

/** The rows the seed writes, built from the file. */
export function buildVoiceOverlaySeed(
  file: VoiceOverlaysFile = readVoiceOverlaysFile()
): VoiceOverlaySeed {
  return {
    set: {
      // The reader's constant, NOT `file.fingerprint.id`, which the schema
      // allows to be any lowercase slug. `seedVoiceOverlays` keys its
      // write-once check off `seed.set.id` rather than the table being empty,
      // so taking the id from the file meant renaming `fingerprint.id` seeded a
      // SECOND set row, logged "Seeded 4 voice overlays", and left every turn
      // throwing `ContentNotSeededError` against an id nothing had written.
      // `buildGoldenSetSeed` pins its id for the same reason; the equality is
      // pinned in `voice-overlay-seed.test.ts` (found by /code-review).
      id: VOICE_OVERLAY_SET_ID,
      title: file.fingerprint.title,
      version: file.fingerprint.version,
      locale: file.fingerprint.locale,
      provenance: {
        status: file.fingerprint.provenance.status,
        awaitingSignOffFrom: file.fingerprint.provenance.awaitingSignOffFrom,
        note: file.fingerprint.provenance.note,
      },
      exemplars: {
        heading: file.exemplars.heading,
        originLabel: file.exemplars.originLabel,
        lines: [...file.exemplars.lines],
        noneFoundNote: file.exemplars.noneFoundNote,
        unavailableNote: file.exemplars.unavailableNote,
      },
      coreOnly: { heading: file.coreOnly.heading, lines: [...file.coreOnly.lines] },
    },
    overlays: file.overlays.map((overlay, index) => ({
      situation: overlay.situation,
      // 1-based and authored order, so a reordering in the file is a visible
      // change to a column rather than a silent one to a row's neighbours.
      position: index + 1,
      label: overlay.label,
      reviewerNote: overlay.when,
      heading: overlay.heading,
      lines: [...overlay.lines],
      exemplarQuery: overlay.exemplarQuery,
    })),
  };
}
