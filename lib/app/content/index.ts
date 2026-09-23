/**
 * The one way in to Lelañea's authored content — the shapes, and the reads that
 * do not touch a file.
 *
 * Fifteen JSON files hold the words this app is built from. Six, under
 * `content/`, are transcriptions of documents Lelañea Fulton wrote. Six, under
 * `seed-data/drafted/`, were drafted FOR her — the voice fingerprint's core, its
 * context-selected overlays, the golden set of prompts a PERSON puts to her, the
 * crisis resources, the slot taxonomy and the resource library. Each of those
 * carries a `provenance` block saying so and naming who has yet to sign it off,
 * because a drafted file sitting silently beside six transcriptions is the one
 * way this seam could start lying, and that block is served rather than withheld.
 *
 * **None of those files is read at runtime, and no module outside
 * `./seed-input/` may import one (f-content-seeds t-89, owner ruling
 * 2026-09-21).** They are seed and reference input: the seeds project them into
 * the database once, the admin surfaces are how they change after that, and
 * every surface reads the database. Two things enforce it — the
 * `no-restricted-syntax` block in `lib/app/eslint.config.mjs`, which fails any
 * import of `@/content/*.json` or `@/seed-data/drafted/*.json` from outside
 * `./seed-input/`, `prisma/seeds/` and the tests; and
 * `tests/unit/lib/app/content/runtime-import-graph.test.ts`, which walks the
 * import graph from every file under `app/`, `components/` and `lib/` and fails
 * on any path reaching a file — or a `seed-input/` module at all.
 *
 * The lint rule alone was not enough: it permitted the whole of
 * `lib/app/content/**`, which is how this barrel came to import the voice
 * fingerprint and the golden set and hand them to 347 import paths, one of them
 * a client component. The graph test is what catches that class.
 *
 * **What this module is now.** The shapes every surface renders, re-exported
 * from the `*-view.ts` modules beside it, plus `findPlaceholders`. The reads
 * live in the `*-store.ts` modules, which import the database client and are
 * deliberately NOT re-exported here: this module is imported by code that must
 * stay free of the database, such as the voice fingerprint
 * (`tests/unit/lib/app/voice/fingerprint.test.ts` walks its import closure).
 *
 * | Collection | Read through | Seeded from |
 * | --- | --- | --- |
 * | Foundational documents | `./document-store` | `./seed-input/foundational-seed` (t-86) |
 * | Journey structure | `./journey-store` | `./seed-input/journey-seed` (t-87) |
 * | Discovery questions | `./question-store` | `./seed-input/question-seed` (t-87) |
 * | Resource library | `./resource-store` | `./seed-input/resources-seed` (t-87) |
 * | Voice overlays | `./voice-overlay-store` | `./seed-input/voice-overlay-seed` (t-88) |
 * | Golden set pointer | `./golden-set-store` | `./seed-input/golden-set-seed` (t-88) |
 *
 * The voice fingerprint's always-on core is the one collection with no table of
 * its own: seed 003 reconciles it onto the agent profile on every run, because
 * it has no editable surface to protect. Its accessor is
 * `./seed-input/voice-fingerprint`, and only its shapes are re-exported here.
 *
 * **What is deliberately not exposed.** `reviewNotes` (editorial notes to the
 * humans maintaining the copy, e.g. "the effective date is still unfilled") and
 * `sourceFile` provenance are validated but never returned — they are working
 * notes about the words, not the words.
 *
 * @see lib/app/content/schemas.ts — the file shapes, and why they are strict
 * @see app/api/v1/app/content — the HTTP surface over the stores
 * @see .context/app/content.md
 */

export {
  ContentNotSeededError,
  type ContentCollectionMeta,
  type FoundationalDocumentDetail,
  type FoundationalDocumentIndex,
  type FoundationalDocumentSummary,
} from '@/lib/app/content/document-view';
export { PLACEHOLDER_PATTERN, findPlaceholders } from '@/lib/app/content/placeholders';
export type {
  DeepReadonly,
  JourneyModuleView,
  JourneyPhase,
  JourneyPhaseTier,
  JourneyStructure,
  JourneyTierView,
} from '@/lib/app/content/journey-view';
export type { DiscoveryQuestionSet, DiscoveryQuestionView } from '@/lib/app/content/question-view';
export type {
  VoiceContentStatus,
  VoiceExemplarCopy,
  VoiceOverlay,
  VoiceOverlays,
  VoiceProvenance,
} from '@/lib/app/content/voice-overlay-view';
// The voice core and the golden set: shapes only. Their accessors read the
// drafted files, so they live in `./seed-input/` and are reached from
// the seeds, the smoke scripts and the tests — never from here.
export type {
  GoldenSetSeed,
  VoiceCoreSection,
  VoiceFingerprintCore,
  VoiceGoldenPrompt,
  VoiceGoldenSet,
} from '@/lib/app/content/voice-core-view';
