/**
 * The golden set's vocabulary — ids, arms, and the projection onto dataset rows.
 *
 * The pure half of the comparison, standing to `comparison.ts` exactly as
 * `designation.ts` stands to `corpus-access.ts`: this module imports nothing
 * that reaches a database, so the seed can use it without pulling in
 * `@/lib/db/client` — which builds a `pg.Pool` at import time — and so the rules
 * in it can be tested without a world.
 *
 * @see lib/app/voice/comparison.ts — the arms, the guard and the queue
 * @see prisma/seeds/app-lelanea/004-voice-golden-set.ts — what writes these rows
 * @see .context/app/voice.md
 */

import { getVoiceGoldenSet, type VoiceGoldenPrompt } from '@/lib/app/content';
import { VOICE_AGENT_SLUG } from '@/lib/app/voice/fingerprint';

/**
 * The dataset id for one version of the golden set — fixed, and versioned.
 *
 * Two decisions in one string, and both are load-bearing.
 *
 * **Fixed rather than generated**, because `AiDataset` has no slug and no unique
 * column but its primary key: a seeded dataset would otherwise have nothing to
 * upsert on, and `findFirst({ where: { name } })` matches whatever an operator
 * later renamed something else.
 *
 * **Versioned**, because a dataset case cannot be deleted once a run has scored
 * it — `AiEvaluationCaseResult.datasetCase` declares no `onDelete`, so Prisma's
 * default `Restrict` applies and the delete fails with `P2003`. That is the
 * right behaviour and not an obstacle to work around: a comparison's answers are
 * only readable beside the question that produced them. So a new set of
 * questions is a new dataset, the old one keeps its history, and
 * `AppVoiceComparison.datasetContentHash` records which of the two any given
 * comparison used.
 *
 * It is not a cuid, and nothing requires it to be.
 */
export function goldenSetDatasetId(version: string): string {
  return `lelanea-voice-golden-set-v${version}`;
}

/**
 * The control agent, and the one thing about this slug that is load-bearing:
 * **it does not start with `lelanea-`.**
 *
 * `CORPUS_AGENT_SLUG_PREFIX` is what `isCorpusAgent()` matches, and a matching
 * agent has her designated corpus widened onto it by
 * `lib/app/knowledge-access-contributors.ts`. A control named `lelanea-control`
 * would therefore be handed her material the moment anything binds
 * `search_knowledge_base` — and the arm meant to show what a bare model does
 * with her questions would quietly start answering out of her documents, with
 * the comparison still labelling it the bare arm. Nothing about that would fail.
 *
 * Pinned by a test, because the constant reads like a name and the reason it is
 * this name is invisible from it.
 */
export const VOICE_CONTROL_AGENT_SLUG = 'voice-control-bare';

/**
 * The judge that scores how close an answer sits to her brand voice.
 *
 * A platform-seeded agent (`prisma/seeds/016-evaluation-judges.ts`), and the one
 * metric a comparison attaches. It is what turns "visibly does not" into a
 * number somebody can look at next month without re-reading ten answers — the
 * difference between a check that gets run and one that does not.
 */
export const BRAND_VOICE_JUDGE_SLUG = 'eval-judge-brand-voice';

/**
 * The arm names, as stored.
 *
 * A TypeScript union over a `String` column rather than a Prisma enum: a third
 * arm — her agent with the profile detached, which isolates the fingerprint
 * rather than the whole prompt — should cost an edit here and a re-queue, not a
 * migration on a table holding history.
 */
export const VOICE_ARMS = ['fingerprint', 'bare'] as const;
export type VoiceArm = (typeof VOICE_ARMS)[number];

/** How an arm is labelled wherever a person reads one. */
export const VOICE_ARM_LABELS: Record<VoiceArm, string> = {
  fingerprint: 'Her voice',
  bare: 'Bare model',
};

/** Which agent answers for each arm. */
export const VOICE_ARM_AGENT_SLUGS: Record<VoiceArm, string> = {
  fingerprint: VOICE_AGENT_SLUG,
  bare: VOICE_CONTROL_AGENT_SLUG,
};

/** Is this a name the comparison knows? Used when reading an `arm` column back. */
export function isVoiceArm(value: string): value is VoiceArm {
  return (VOICE_ARMS as readonly string[]).includes(value);
}

/**
 * What is stored on a dataset case beside the prompt.
 *
 * `key`, `kind` and `probe` ride in `AiDatasetCase.metadata` because the
 * platform has nowhere else to put them — and they are not decoration: `probe`
 * is what tells whoever reads two answers side by side what the question was
 * testing, without which a comparison is a vibe.
 */
export interface GoldenCaseMetadata {
  key: string;
  kind: VoiceGoldenPrompt['kind'];
  probe: string;
}

/** One dataset case, as the seed writes it and as the hash is taken over it. */
export interface GoldenDatasetCase {
  position: number;
  input: string;
  metadata: GoldenCaseMetadata;
}

/**
 * Project the authored prompts onto dataset cases.
 *
 * Takes the set as an argument — defaulting to the authored one — for the same
 * reason `composeFingerprintProfileSections()` does: the seed's guards depend on
 * a degenerate set being *reachable*, and a function that could only ever be
 * handed the real file would make them untestable and therefore decorative
 * (`fp6`).
 *
 * **No `expectedOutput`.** Whether an answer reads as her is her judgement on a
 * deployed build, not a string comparison — so every reference-required grader
 * is structurally unusable against this dataset, which is correct rather than a
 * gap. Sunrise's run-create preflight refuses one against a dataset like this,
 * and a comparison attaches only the brand-voice judge, which needs no reference.
 */
export function projectGoldenSetCases(goldenSet = getVoiceGoldenSet()): GoldenDatasetCase[] {
  return goldenSet.prompts.map((prompt, index) => ({
    position: index,
    input: prompt.prompt,
    metadata: { key: prompt.key, kind: prompt.kind, probe: prompt.probe },
  }));
}
