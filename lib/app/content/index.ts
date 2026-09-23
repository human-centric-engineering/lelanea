/**
 * The one way in to Lelañea's authored content.
 *
 * Nine JSON files under `content/` hold Lelañea Fulton's words. Six are
 * transcriptions of documents she wrote; the voice fingerprint's always-on core
 * and its context-selected overlays were drafted FROM those in her register; and
 * the ninth — the golden set — is the odd one out, holding the prompts a PERSON
 * puts to her rather than words of hers at all. Each of the three carries a
 * `provenance` block saying what it is, because a file that is not a
 * transcription sitting silently beside six that are is the one way this
 * seam could start lying. Nothing
 * outside this folder reads any of them: an ESLint rule in `lib/app/eslint.config.mjs`
 * fails any import of `@/content/*.json` from elsewhere, so a page that wants
 * the mission statement asks for it here instead of pasting it. That is the
 * whole point of the seam — the platform strategy is that authored content is
 * *served*, not compiled into the web build, so a native client later renders
 * the same copy through the same API rather than growing a second pipeline.
 *
 * **Static imports, not `fs`.** `lib/app/**` is the portable extension surface
 * and may not touch Node built-ins (see the ESLint block in the root config), so
 * the files are imported as modules and bundled. They are authored artefacts
 * that change at deploy time; when that stops being true — the first time copy
 * must change without a deploy — the decision on file is to move this behind a
 * database, keeping these function signatures.
 *
 * **That move has started.** Her foundational documents are read from
 * `app_foundational_document` (t-86), through `@/lib/app/content/document-store`
 * under the same names, now async. Only their types are re-exported here (see
 * below). The file seeds the table and is imported only by
 * `foundational-seed.ts`. The journey's text, the discovery questions and the
 * resource library followed in t-87 (`journey-store.ts`, `question-store.ts`,
 * `resource-store.ts`, each seeded from its file by a `*-seed.ts` beside it),
 * and the context-selected voice overlays in t-88 (`voice-overlay-store.ts`).
 * What this module still loads from files is the voice fingerprint's always-on
 * core — projected onto the agent profile by `003-voice-fingerprint`, which
 * reconciles it on every run because it has no editable surface yet — and the
 * golden set, whose prompts reach the database through seed 004 as an
 * `AiDataset` rather than through a table of our own.
 *
 * **Parsed once, on demand.** Each accessor validates its file the first time it
 * is called and memoises the result for the life of the process. A malformed
 * file therefore throws from the accessor rather than at import time, which
 * keeps an unrelated route from failing to load; CI catches it first either way
 * (`tests/unit/lib/app/content/schemas.test.ts` and its siblings parse every
 * real file).
 *
 * **What is deliberately not exposed.** `reviewNotes` (editorial notes to the
 * humans maintaining the copy, e.g. "the effective date is still unfilled") and
 * `sourceFile` provenance are validated but never returned — they are working
 * notes about the words, not the words.
 *
 * Release-2 content (Values module, reference framework, value explorations)
 * lives in `@/lib/app/content/values`, kept out of this module so its 300KB
 * stays out of the bundles that only need a document.
 *
 * @see lib/app/content/schemas.ts — the shapes, and why they are strict
 * @see app/api/v1/app/content — the HTTP surface over these accessors
 */

import rawVoiceFingerprint from '@/seed-data/drafted/lelanea_voice_fingerprint.json';
import rawVoiceGoldenSet from '@/seed-data/drafted/lelanea_voice_golden_set.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';
import {
  voiceFingerprintFileSchema,
  type VoiceFingerprintFile,
  voiceGoldenSetFileSchema,
  type GoldenSetKind,
  type VoiceGoldenSetFile,
} from '@/lib/app/content/schemas';
import type { ContentCollectionMeta } from '@/lib/app/content/document-view';
import type { DeepReadonly } from '@/lib/app/content/journey-view';

// Her foundational documents are served from the database (t-86). Their shapes
// are re-exported here, but their READS are not: they live in
// `@/lib/app/content/document-store`, which imports the database client. This
// module is imported by code that must stay free of the database, such as the
// voice fingerprint (`tests/unit/lib/app/voice/fingerprint.test.ts` walks its
// import closure). Re-exporting the reads here would pull Prisma into all of it.
export {
  ContentNotSeededError,
  type ContentCollectionMeta,
  type FoundationalDocumentDetail,
  type FoundationalDocumentIndex,
  type FoundationalDocumentSummary,
} from '@/lib/app/content/document-view';
export { PLACEHOLDER_PATTERN, findPlaceholders } from '@/lib/app/content/placeholders';
// The journey and the discovery questions are served from the database too
// (t-87): their reads are in `@/lib/app/content/journey-store` and
// `@/lib/app/content/question-store`, and only their shapes are re-exported
// here, for the same reason as the documents'.
export type {
  DeepReadonly,
  JourneyModuleView,
  JourneyPhase,
  JourneyPhaseTier,
  JourneyStructure,
  JourneyTierView,
} from '@/lib/app/content/journey-view';
export type { DiscoveryQuestionSet, DiscoveryQuestionView } from '@/lib/app/content/question-view';

// ============================================================================
// Served shapes
// ============================================================================

/** One named block of the voice core: a heading and its beats, in authored order. */
export interface VoiceCoreSection {
  heading: string;
  /** Each entry is a beat. Joined with a newline, never with a space. */
  lines: readonly string[];
}

/**
 * The always-on core of the voice fingerprint.
 *
 * The one shape in this module that is NOT destined for a screen. It is a prompt
 * ingredient: `lib/app/voice/fingerprint.ts` projects these four blocks onto the
 * three inheritable `AiAgentProfile` columns, and every turn carries them
 * whether or not retrieval finds anything.
 *
 * `provenance` is served rather than withheld — unlike `reviewNotes`, which are
 * working notes about the words. Who has and has not signed this text off is a
 * fact about the artefact that any caller putting it in front of a model, or
 * attributing an output to it, needs to be able to read.
 */
export interface VoiceFingerprintCore {
  collection: ContentCollectionMeta;
  provenance: DeepReadonly<VoiceFingerprintFile['fingerprint']['provenance']>;
  identity: VoiceCoreSection;
  cadence: VoiceCoreSection & {
    readonly reachesForLabel: string;
    readonly reachesFor: readonly string[];
    readonly avoidsLabel: string;
    readonly avoids: readonly string[];
  };
  grounding: VoiceCoreSection;
  boundaries: VoiceCoreSection & {
    readonly howYouDeclineHeading: string;
    readonly howYouDecline: readonly string[];
  };
}

export type {
  VoiceContentStatus,
  VoiceExemplarCopy,
  VoiceOverlay,
  VoiceOverlays,
  VoiceProvenance,
} from '@/lib/app/content/voice-overlay-view';

// ============================================================================
// Parse-once caches
// ============================================================================

/**
 * Both the parse and the projections built from it are frozen.
 *
 * Everything here is built once and shared for the life of the process — the
 * parse, and the views the accessors project from it. That is the right trade
 * for content that changes only on deploy, and it is exactly what makes mutation
 * dangerous: there is one copy, so writing to it rewrites the authored words for
 * every later request. Placeholder substitution is the next thing to be built on
 * this module, and doing it in place on `blocks` would serve a wrong Terms of
 * Use to everyone after the first caller, until the next deploy.
 *
 * Freezing makes that attempt throw (modules are strict mode) instead of
 * silently succeeding, at a one-off cost. Identity is preserved,
 * so the memoisation contract is unchanged.
 */

// Projected views, memoised alongside the parse. Frozen because they are now
// shared across requests rather than rebuilt per call.
let voiceFingerprintView: VoiceFingerprintCore | null = null;
let voiceGoldenSetView: VoiceGoldenSet | null = null;

let voiceFingerprintCache: VoiceFingerprintFile | null = null;
let voiceGoldenSetCache: VoiceGoldenSetFile | null = null;

function voiceFingerprintFile(): VoiceFingerprintFile {
  voiceFingerprintCache ??= deepFreezeParsed(voiceFingerprintFileSchema.parse(rawVoiceFingerprint));
  return voiceFingerprintCache;
}

function voiceGoldenSetFile(): VoiceGoldenSetFile {
  voiceGoldenSetCache ??= deepFreezeParsed(voiceGoldenSetFileSchema.parse(rawVoiceGoldenSet));
  return voiceGoldenSetCache;
}

// ============================================================================
// Voice fingerprint
// ============================================================================

/**
 * The always-on core of how she sounds: identity, cadence, how she grounds a
 * claim, and what she declines.
 *
 * Not a screen payload. `lib/app/voice/fingerprint.ts` is the only caller that
 * should matter — it projects this onto the three inheritable profile columns,
 * and `prisma/seeds/app-lelanea/003-voice-fingerprint.ts` writes the result.
 *
 * Read the `provenance` block before putting this in front of anyone. The six
 * files beside this one are Lelañea's own documents; this one was drafted from
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

/**
 * One prompt of the golden set: what is asked, and what asking it is for.
 *
 * `probe` is a note to whoever reads the comparison — why this prompt is in the
 * set at all — and unlike the overlays' `when` it IS shown on a surface, beside
 * the two answers. Reading two outputs without knowing what the prompt was
 * testing is how a comparison becomes a vibe.
 *
 * `prompt` is the only member that ever reaches a model, and it reaches it as a
 * USER turn. Nothing in this file is instruction.
 */
export interface VoiceGoldenPrompt {
  key: string;
  kind: GoldenSetKind;
  probe: string;
  prompt: string;
}

/**
 * The fixed set every change to her voice is heard through, and the bare model
 * it is heard against.
 *
 * Not a prompt ingredient and not a screen payload — both, which is why the
 * whole file is served. `prisma/seeds/app-lelanea/004-voice-golden-set.ts`
 * projects `prompts` onto dataset rows and `control` onto the bare arm's agent;
 * `lib/app/voice/comparison.ts` queues the two runs and the admin surface reads
 * `probe` back beside their outputs.
 *
 * `provenance` is served for the same reason as the core's and the overlays':
 * these prompts were drafted rather than dictated, and are a proposal until she
 * has read them.
 */
export interface VoiceGoldenSet {
  collection: ContentCollectionMeta;
  provenance: DeepReadonly<VoiceGoldenSetFile['goldenSet']['provenance']>;
  dataset: {
    readonly name: string;
    readonly description: string;
    readonly tags: readonly string[];
  };
  /** The bare arm's whole system prompt, authored so the control is readable too. */
  control: {
    readonly name: string;
    readonly description: string;
    readonly systemInstructions: string;
  };
  prompts: readonly VoiceGoldenPrompt[];
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
