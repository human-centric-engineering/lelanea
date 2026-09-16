/**
 * What the comparison surface reads: the list, and one case's answers side by side.
 *
 * The write is next door in `comparison.ts`; this is the half that has to make
 * two runs legible as one thing. Everything here is a read, and everything it
 * reads from a `Json` column is parsed rather than cast — the platform's
 * `progress`, `summary` and `metricScores` are all `Json`, so TypeScript will
 * agree to any shape at all and a drifted worker would land as an exception
 * inside a page render rather than as a missing number.
 *
 * ## Answers are joined by case KEY, not by position
 *
 * Comparing two versions of the golden set is the whole point of the versioned
 * dataset — and two versions can reorder their prompts, drop one, or add one.
 * Joining on `position` would then line the greeting up against the decline and
 * render it as a regression. The join is on the authored `key`, and a case
 * present in one version and absent from the other is shown with the gap
 * visible rather than quietly dropped.
 *
 * @see lib/app/voice/comparison.ts
 * @see .context/app/voice.md
 */

import { z } from 'zod';

import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { BRAND_VOICE_JUDGE_SLUG, VOICE_ARM_LABELS, isVoiceArm } from '@/lib/app/voice/golden-set';

/** How many comparisons the surface lists. Small on purpose — this is a log, not a table. */
export const VOICE_COMPARISON_LIST_LIMIT = 25;

// ---------------------------------------------------------------------------
// Json columns, parsed
// ---------------------------------------------------------------------------

/**
 * Every one of these is `.catch(...)`-guarded to a neutral value.
 *
 * A comparison whose worker wrote a shape this file does not recognise should
 * render as "no score yet" beside an answer somebody can still read, not as a
 * 500 on the page whose whole job is to show the answer. The thing being checked
 * here is her voice; a schema disagreement about a progress counter must not be
 * what stops it being checked.
 */
const progressSchema = z
  .object({
    casesTotal: z.number().int().nonnegative().catch(0),
    casesDone: z.number().int().nonnegative().catch(0),
    casesFailed: z.number().int().nonnegative().catch(0),
  })
  .catch({ casesTotal: 0, casesDone: 0, casesFailed: 0 });

const summarySchema = z
  .object({
    stats: z
      .record(z.string(), z.object({ mean: z.number().nullable().catch(null) }).partial())
      .catch({}),
  })
  .partial()
  .catch({});

const metricScoresSchema = z
  .record(
    z.string(),
    z
      .object({
        score: z.number().nullable().catch(null),
        reasoning: z.string().nullable().catch(null),
      })
      .partial()
  )
  .catch({});

const caseMetadataSchema = z
  .object({
    key: z.string().min(1),
    kind: z.string().min(1),
    probe: z.string(),
  })
  .partial()
  .catch({});

// ---------------------------------------------------------------------------
// Served shapes
// ---------------------------------------------------------------------------

export interface VoiceComparisonArmView {
  arm: string;
  /** `Her voice · v1.0` / `Bare model` — what a column is headed. */
  label: string;
  agentSlug: string;
  fingerprintVersion: string | null;
  evaluationRunId: string;
  /** `queued` | `running` | `completed` | `failed` | `cancelled`, as the platform set it. */
  status: string;
  progress: { casesTotal: number; casesDone: number; casesFailed: number };
  /** Mean brand-voice score across the run, once it has completed. */
  brandVoiceMean: number | null;
}

export interface VoiceComparisonSummary {
  id: string;
  goldenSetVersion: string;
  datasetContentHash: string;
  createdAt: Date;
  arms: VoiceComparisonArmView[];
}

/** One arm's answer to one case. */
export interface VoiceComparisonAnswer {
  /** Unique per column across however many comparisons are being shown together. */
  columnId: string;
  comparisonId: string;
  arm: string;
  label: string;
  fingerprintVersion: string | null;
  /** Null until the worker has drained this case — or if it never asked it. */
  output: string | null;
  errorMessage: string | null;
  brandVoiceScore: number | null;
  brandVoiceReasoning: string | null;
}

export interface VoiceComparisonCase {
  /** The authored key — the join, and what a person says when one of them regresses. */
  key: string;
  kind: string;
  probe: string;
  prompt: string;
  answers: VoiceComparisonAnswer[];
}

/** One column's heading and the prompt behind it, for the preflight panel. */
export interface VoiceComparisonColumn {
  columnId: string;
  comparisonId: string;
  arm: string;
  label: string;
  agentSlug: string;
  fingerprintVersion: string | null;
  /** What this arm was actually told. Stored at queue time; the evidence, not a claim. */
  systemPrompt: string;
}

export interface VoiceComparisonDetail {
  comparisons: VoiceComparisonSummary[];
  columns: VoiceComparisonColumn[];
  cases: VoiceComparisonCase[];
  /**
   * True when the comparisons being shown together ran different questions.
   *
   * Said rather than hidden: two golden-set versions are a legitimate thing to
   * put side by side, and the reader needs to know that a difference might be
   * the question rather than the voice.
   */
  mixedGoldenSets: boolean;
}

function armLabel(arm: string, fingerprintVersion: string | null): string {
  const base = isVoiceArm(arm) ? VOICE_ARM_LABELS[arm] : arm;
  return fingerprintVersion === null ? base : `${base} · v${fingerprintVersion}`;
}

function columnId(comparisonId: string, arm: string): string {
  return `${comparisonId}:${arm}`;
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/**
 * The comparisons this install has run, newest first.
 *
 * Two queries rather than a nested include on the run: the arm rows carry a
 * hand-written FK to `ai_evaluation_run` with no Prisma `@relation` behind it
 * (a fork table must not add a reverse field to a Sunrise-owned model), so there
 * is nothing to include and the join is made here.
 */
export async function listVoiceComparisons(
  limit = VOICE_COMPARISON_LIST_LIMIT
): Promise<VoiceComparisonSummary[]> {
  const comparisons = await prisma.appVoiceComparison.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { arms: { orderBy: { arm: 'asc' } } },
  });
  if (comparisons.length === 0) return [];

  const runs = await prisma.aiEvaluationRun.findMany({
    where: { id: { in: comparisons.flatMap((c) => c.arms.map((a) => a.evaluationRunId)) } },
    select: { id: true, status: true, progress: true, summary: true },
  });
  const runById = new Map(runs.map((run) => [run.id, run]));

  return comparisons.map((comparison) => ({
    id: comparison.id,
    goldenSetVersion: comparison.goldenSetVersion,
    datasetContentHash: comparison.datasetContentHash,
    createdAt: comparison.createdAt,
    arms: comparison.arms.map((arm) => {
      const run = runById.get(arm.evaluationRunId);
      const summary = summarySchema.parse(run?.summary ?? {});
      return {
        arm: arm.arm,
        label: armLabel(arm.arm, arm.fingerprintVersion),
        agentSlug: arm.agentSlug,
        fingerprintVersion: arm.fingerprintVersion,
        evaluationRunId: arm.evaluationRunId,
        // A run row the platform deleted leaves the arm behind only until the
        // FK cascades, so this is a race rather than a state — reported as
        // `unknown` rather than guessed at.
        status: run?.status ?? 'unknown',
        progress: progressSchema.parse(run?.progress ?? {}),
        brandVoiceMean: summary.stats?.[BRAND_VOICE_JUDGE_SLUG]?.mean ?? null,
      };
    }),
  }));
}

// ---------------------------------------------------------------------------
// The detail
// ---------------------------------------------------------------------------

/**
 * One or two comparisons, merged into a case-by-case view.
 *
 * Pass one id for the arms of a single run (her voice against the bare model);
 * pass two for two versions of her voice side by side, each still carrying its
 * own bare arm — which is what stops "v1.1 scored lower" being read as a
 * regression when the model itself had a bad day.
 */
export async function getVoiceComparison(
  comparisonIds: readonly string[]
): Promise<VoiceComparisonDetail> {
  const comparisons = await prisma.appVoiceComparison.findMany({
    where: { id: { in: [...comparisonIds] } },
    include: { arms: { orderBy: { arm: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  const missing = comparisonIds.filter((id) => !comparisons.some((c) => c.id === id));
  if (missing.length > 0) {
    throw new NotFoundError(`No such comparison: ${missing.join(', ')}`);
  }

  const armRows = comparisons.flatMap((comparison) =>
    comparison.arms.map((arm) => ({ comparison, arm }))
  );
  const runIds = armRows.map(({ arm }) => arm.evaluationRunId);

  const runs = await prisma.aiEvaluationRun.findMany({
    where: { id: { in: runIds } },
    select: { id: true, status: true, progress: true, summary: true, datasetId: true },
  });
  const runById = new Map(runs.map((run) => [run.id, run]));

  const [datasetCases, results] = await Promise.all([
    prisma.aiDatasetCase.findMany({
      where: { datasetId: { in: [...new Set(runs.map((run) => run.datasetId))] } },
      select: { datasetId: true, position: true, input: true, metadata: true },
      orderBy: { position: 'asc' },
    }),
    prisma.aiEvaluationCaseResult.findMany({
      where: { runId: { in: runIds } },
      select: {
        runId: true,
        casePosition: true,
        subjectOutput: true,
        errorMessage: true,
        metricScores: true,
      },
    }),
  ]);

  const resultByRunAndPosition = new Map(
    results.map((result) => [`${result.runId}:${result.casePosition}`, result])
  );

  // The authored cases, keyed by (dataset, position) for the result join and
  // ordered by first appearance for the render. `key` is the merge key across
  // datasets; `position` never leaves this function.
  interface CaseShell {
    key: string;
    kind: string;
    probe: string;
    prompt: string;
    answers: VoiceComparisonAnswer[];
  }
  const shells = new Map<string, CaseShell>();
  /** `(datasetId, key)` → the position that dataset gives the case. */
  const positionByDatasetAndKey = new Map<string, number>();

  for (const row of datasetCases) {
    const metadata = caseMetadataSchema.parse(row.metadata ?? {});
    // A case whose metadata lost its key still has a position, and a case shown
    // under a synthetic key is better than a case silently missing from the
    // comparison — the reader can see something is wrong with it.
    const key = metadata.key ?? `position-${row.position}`;
    positionByDatasetAndKey.set(`${row.datasetId}:${key}`, row.position);

    if (!shells.has(key)) {
      shells.set(key, {
        key,
        kind: metadata.kind ?? 'unknown',
        probe: metadata.probe ?? '',
        prompt: typeof row.input === 'string' ? row.input : JSON.stringify(row.input),
        answers: [],
      });
    }
  }

  const columns: VoiceComparisonColumn[] = armRows.map(({ comparison, arm }) => ({
    columnId: columnId(comparison.id, arm.arm),
    comparisonId: comparison.id,
    arm: arm.arm,
    label: armLabel(arm.arm, arm.fingerprintVersion),
    agentSlug: arm.agentSlug,
    fingerprintVersion: arm.fingerprintVersion,
    systemPrompt: arm.systemPrompt,
  }));

  for (const { comparison, arm } of armRows) {
    const run = runById.get(arm.evaluationRunId);
    if (!run) continue;

    for (const [shellKey, shell] of shells) {
      // Which position does THIS arm's dataset give the case? Two golden-set
      // versions can order the same prompt differently, which is exactly why the
      // lookup goes through the key rather than assuming the positions agree.
      // Undefined means this version never asked this question — the column
      // renders a gap, which is the honest answer.
      const position = positionByDatasetAndKey.get(`${run.datasetId}:${shellKey}`);
      const result =
        position === undefined ? undefined : resultByRunAndPosition.get(`${run.id}:${position}`);
      const scores = metricScoresSchema.parse(result?.metricScores ?? {});
      const brandVoice = scores[BRAND_VOICE_JUDGE_SLUG];

      shell.answers.push({
        columnId: columnId(comparison.id, arm.arm),
        comparisonId: comparison.id,
        arm: arm.arm,
        label: armLabel(arm.arm, arm.fingerprintVersion),
        fingerprintVersion: arm.fingerprintVersion,
        output: result?.subjectOutput ?? null,
        errorMessage: result?.errorMessage ?? null,
        brandVoiceScore: brandVoice?.score ?? null,
        brandVoiceReasoning: brandVoice?.reasoning ?? null,
      });
    }
  }

  const summaries: VoiceComparisonSummary[] = comparisons.map((comparison) => ({
    id: comparison.id,
    goldenSetVersion: comparison.goldenSetVersion,
    datasetContentHash: comparison.datasetContentHash,
    createdAt: comparison.createdAt,
    arms: comparison.arms.map((arm) => {
      const run = runById.get(arm.evaluationRunId);
      const summary = summarySchema.parse(run?.summary ?? {});
      return {
        arm: arm.arm,
        label: armLabel(arm.arm, arm.fingerprintVersion),
        agentSlug: arm.agentSlug,
        fingerprintVersion: arm.fingerprintVersion,
        evaluationRunId: arm.evaluationRunId,
        status: run?.status ?? 'unknown',
        progress: progressSchema.parse(run?.progress ?? {}),
        brandVoiceMean: summary.stats?.[BRAND_VOICE_JUDGE_SLUG]?.mean ?? null,
      };
    }),
  }));

  return {
    comparisons: summaries,
    columns,
    cases: [...shells.values()],
    mixedGoldenSets: new Set(comparisons.map((c) => c.datasetContentHash)).size > 1,
  };
}
