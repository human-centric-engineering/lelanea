/**
 * The golden set's pointer row as seed material (f-content-seeds t-88).
 *
 * Only the two things the platform's dataset cannot hold: which authored
 * version is current, and the provenance block shown to whoever reads the set.
 * The prompts go to `AiDataset` / `AiDatasetCase` through
 * `projectGoldenSetCases`, and the control's instructions onto the control
 * agent — both by the same seed unit, `004-voice-golden-set.ts`.
 *
 * This module is where the file is still imported; its callers are that seed
 * and tests.
 */

import { getVoiceGoldenSet } from '@/lib/app/content';

/** What the seed writes: the pointer, at revision 1. */
export interface GoldenSetSeed {
  id: string;
  title: string;
  version: string;
  locale: string;
  provenance: { status: string; awaitingSignOffFrom: string; note: string };
}

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
