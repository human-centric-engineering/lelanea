/**
 * The golden set: the prompts every change to her voice is heard through
 * (f-content-seeds t-89).
 *
 * Seed input. `prisma/seeds/app-lelanea/004-voice-golden-set.ts` projects
 * `prompts` onto `AiDataset` / `AiDatasetCase` rows and `control` onto the bare
 * arm's agent; after that the dataset is the set, and the pointer row on
 * `app_voice_content` says which authored version it came from.
 *
 * **Callers: seed 004 and the smoke scripts, and tests.** Nothing under `app/`, `components/` or the
 * rest of `lib/` may reach this module — the lint boundary in
 * `lib/app/eslint.config.mjs` stops a file import and
 * `tests/unit/lib/app/content/runtime-import-graph.test.ts` stops a reachable
 * one. This lived on `lib/app/content/index.ts` until t-89, which is how
 * `lelanea_voice_golden_set.json` came to be bundled into every build that
 * imported the barrel for a type or for `findPlaceholders` — 347 import paths
 * reached it, one of them a client component.
 *
 * **Parsed once, on demand.** The accessor validates the file the first time it
 * is called and memoises the result for the life of the process, so a malformed
 * file throws from the accessor rather than at import time. Both the parse and
 * the view projected from it are frozen: there is one copy per process, so a
 * write to it would rewrite the authored words for every later caller.
 *
 * @see lib/app/content/voice-core-view.ts — the shapes
 * @see .context/app/voice.md
 */

import rawVoiceGoldenSet from '@/seed-data/drafted/lelanea_voice_golden_set.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import { voiceGoldenSetFileSchema, type VoiceGoldenSetFile } from '@/lib/app/content/schemas';
import type { VoiceGoldenSet } from '@/lib/app/content/voice-core-view';

// The projected view, memoised alongside the parse.
let voiceGoldenSetView: VoiceGoldenSet | null = null;
let voiceGoldenSetCache: VoiceGoldenSetFile | null = null;

function voiceGoldenSetFile(): VoiceGoldenSetFile {
  voiceGoldenSetCache ??= deepFreezeParsed(voiceGoldenSetFileSchema.parse(rawVoiceGoldenSet));
  return voiceGoldenSetCache;
}

/**
 * The golden set: the prompts, the dataset they are seeded as, and the control.
 *
 * `collection.version` is the golden set's OWN version, not the fingerprint's.
 * The two move independently on purpose — re-authoring the probe set is not a
 * change to how she sounds, and a shared version would make each look like the
 * other had changed.
 */
export function getVoiceGoldenSet(): VoiceGoldenSet {
  if (voiceGoldenSetView) return voiceGoldenSetView;

  const file = voiceGoldenSetFile();
  voiceGoldenSetView = deepFreezeParsed({
    collection: {
      id: file.goldenSet.id,
      title: file.goldenSet.title,
      version: file.goldenSet.version,
      locale: file.goldenSet.locale,
    },
    provenance: file.goldenSet.provenance,
    dataset: {
      name: file.dataset.name,
      description: file.dataset.description,
      tags: file.dataset.tags,
    },
    control: {
      name: file.control.name,
      description: file.control.description,
      systemInstructions: file.control.systemInstructions,
    },
    prompts: file.prompts.map((entry) => ({
      key: entry.key,
      kind: entry.kind,
      probe: entry.probe,
      prompt: entry.prompt,
    })),
  });
  return voiceGoldenSetView;
}
