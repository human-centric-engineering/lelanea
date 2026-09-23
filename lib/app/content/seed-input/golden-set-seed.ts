/**
 * The golden set's pointer row as seed material (f-content-seeds t-88).
 *
 * Only the two things the platform's dataset cannot hold: which authored
 * version is current, and the provenance block shown to whoever reads the set.
 * The prompts go to `AiDataset` / `AiDatasetCase` through
 * `projectGoldenSetCases`, and the control's instructions onto the control
 * agent — both by the same seed unit, `004-voice-golden-set.ts`.
 *
 * Its callers are that seed and tests. The shape it builds is declared in
 * `lib/app/content/voice-core-view.ts`, because `golden-set-store.ts` reads the
 * row back and no runtime module may import anything from this folder (t-89).
 */

import { getVoiceGoldenSet } from '@/lib/app/content/seed-input/voice-golden-set';
import type { GoldenSetSeed } from '@/lib/app/content/voice-core-view';

export type { GoldenSetSeed };

/** The pointer row the seed writes, built from the authored set. */
export function buildGoldenSetSeed(goldenSet = getVoiceGoldenSet()): GoldenSetSeed {
  return {
    id: 'lelanea_voice_golden_set',
    title: goldenSet.collection.title,
    version: goldenSet.collection.version,
    locale: goldenSet.collection.locale,
    provenance: {
      status: goldenSet.provenance.status,
      awaitingSignOffFrom: goldenSet.provenance.awaitingSignOffFrom,
      note: goldenSet.provenance.note,
    },
  };
}
