/**
 * The voice fingerprint's always-on core, read from the drafted file
 * (f-content-seeds t-89).
 *
 * Seed input. `prisma/seeds/app-lelanea/003-voice-fingerprint.ts` projects these
 * four blocks onto the three inheritable `AiAgentProfile` columns through
 * `lib/app/voice/fingerprint.ts`, and reconciles them on every run because the
 * core is the one collection with no editable surface yet.
 *
 * **Callers: seed 003 and the smoke scripts, and tests.** Nothing under `app/`, `components/` or the
 * rest of `lib/` may reach this module — the lint boundary in
 * `lib/app/eslint.config.mjs` stops a file import and
 * `tests/unit/lib/app/content/runtime-import-graph.test.ts` stops a reachable
 * one. This lived on `lib/app/content/index.ts` until t-89, which is how
 * `lelanea_voice_fingerprint.json` came to be bundled into every build that
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

import rawVoiceFingerprint from '@/seed-data/drafted/lelanea_voice_fingerprint.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import { voiceFingerprintFileSchema, type VoiceFingerprintFile } from '@/lib/app/content/schemas';
import type { VoiceFingerprintCore } from '@/lib/app/content/voice-core-view';

// The projected view, memoised alongside the parse.
let voiceFingerprintView: VoiceFingerprintCore | null = null;
let voiceFingerprintCache: VoiceFingerprintFile | null = null;

function voiceFingerprintFile(): VoiceFingerprintFile {
  voiceFingerprintCache ??= deepFreezeParsed(voiceFingerprintFileSchema.parse(rawVoiceFingerprint));
  return voiceFingerprintCache;
}

/**
 * The always-on core of how she sounds: identity, cadence, how she grounds a
 * claim, and what she declines.
 *
 * Not a screen payload. `prisma/seeds/app-lelanea/003-voice-fingerprint.ts`
 * projects this onto the three inheritable profile columns through
 * `lib/app/voice/fingerprint.ts` and writes the result; it reconciles on every
 * run because the core has no editable surface yet.
 *
 * Read the `provenance` block before putting this in front of anyone. The six
 * files under `content/` are Lelañea's own documents; this one was drafted from
 * them in her register and is a proposal until she has signed it off.
 */
export function getVoiceFingerprint(): VoiceFingerprintCore {
  if (voiceFingerprintView) return voiceFingerprintView;

  const file = voiceFingerprintFile();
  voiceFingerprintView = deepFreezeParsed({
    collection: {
      id: file.fingerprint.id,
      title: file.fingerprint.title,
      version: file.fingerprint.version,
      locale: file.fingerprint.locale,
    },
    provenance: file.fingerprint.provenance,
    identity: { heading: file.identity.heading, lines: file.identity.lines },
    cadence: {
      heading: file.cadence.heading,
      lines: file.cadence.lines,
      reachesForLabel: file.cadence.reachesForLabel,
      reachesFor: file.cadence.reachesFor,
      avoidsLabel: file.cadence.avoidsLabel,
      avoids: file.cadence.avoids,
    },
    grounding: { heading: file.grounding.heading, lines: file.grounding.lines },
    boundaries: {
      heading: file.boundaries.heading,
      lines: file.boundaries.lines,
      howYouDeclineHeading: file.boundaries.howYouDeclineHeading,
      howYouDecline: file.boundaries.howYouDecline,
    },
  });
  return voiceFingerprintView;
}
