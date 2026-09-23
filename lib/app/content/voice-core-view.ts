/**
 * The shapes of the voice core and the golden set — and nothing that reads a
 * file (f-content-seeds t-89).
 *
 * These four interfaces used to live in `./index` beside the two accessors that
 * build them, which is what put `lelanea_voice_fingerprint.json` and
 * `lelanea_voice_golden_set.json` into every bundle that imported the barrel
 * for a type. The accessors moved to `./seed-input/voice-fingerprint` and
 * `./seed-input/voice-golden-set`; the shapes
 * stayed, here, so the barrel can go on re-exporting them without the files
 * coming with them.
 *
 * Named `-view` like its siblings for the same reason: a `*-view.ts` module
 * holds the shape a surface renders and the projection onto it, and imports
 * neither the database nor the authored files.
 *
 * @see lib/app/content/seed-input/voice-fingerprint.ts — the accessor, seed-only
 * @see lib/app/content/seed-input/voice-golden-set.ts — the accessor, seed-only
 * @see lib/app/content/schemas.ts — the file schemas these are projected from
 */

import type { ContentCollectionMeta } from '@/lib/app/content/document-view';
import type { DeepReadonly } from '@/lib/app/content/journey-view';
import type {
  GoldenSetKind,
  VoiceFingerprintFile,
  VoiceGoldenSetFile,
} from '@/lib/app/content/schemas';

/** One named block of the voice core: a heading and its beats, in authored order. */
export interface VoiceCoreSection {
  heading: string;
  /** Each entry is a beat. Joined with a newline, never with a space. */
  lines: readonly string[];
}

/**
 * The always-on core of the voice fingerprint.
 *
 * The one shape in this folder that is NOT destined for a screen. It is a prompt
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
 * The golden set's pointer row as seed 004 writes it, at revision 1.
 *
 * Declared here rather than beside the builder in `./seed-input/golden-set-seed`
 * because `golden-set-store.ts` reads that row back and needs the shape — and a
 * runtime module importing anything at all from `seed-input/` is what t-89's
 * import-graph test forbids, type or not.
 */
export interface GoldenSetSeed {
  id: string;
  title: string;
  version: string;
  locale: string;
  provenance: { status: string; awaitingSignOffFrom: string; note: string };
}
