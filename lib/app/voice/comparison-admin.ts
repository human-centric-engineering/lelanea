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
 * ## Two states this file refuses to render as one
 *
 * **An arm whose run has been deleted.** `AiEvaluationRun.user` cascades, so
 * erasing the admin who queued a comparison deletes their runs; the arm rows
 * survive it (`ON DELETE SET NULL`) carrying the prompt and the version, which is
 * what this table was added for. A null `evaluationRunId` therefore means one
 * specific thing — *the run that produced these answers no longer exists* — and
 * it is reported as that, not as an empty progress bar that reads "not yet".
 *
 * **A question two versions worded differently.** The merge key is the authored
 * `key`, and a version is free to keep a key while rewording its prompt. Showing
 * one wording above both versions' answers would be a claim this file has no
 * basis for, so a case whose wording differs across the datasets on screen is
 * flagged (`promptVaries`) and each answer carries the wording its own version
 * actually asked.
 *
 * @see lib/app/voice/comparison.ts
 * @see .context/app/voice.md
 */

import { z } from 'zod';

import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';
import { BRAND_VOICE_JUDGE_SLUG, VOICE_ARM_LABELS, isVoiceArm } from '@/lib/app/voice/golden-set';
import { VOICE_RUN_DELETED_STATUS } from '@/lib/validations/app-voice-comparison';

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
  /** `Voice profile · v1.0` / `Bare model` — what a column is headed. */
  label: string;
  agentSlug: string;
  fingerprintVersion: string | null;
  /** Null once the run behind this arm has been deleted — the arm outlives it. */
  evaluationRunId: string | null;
  /**
   * `queued` | `running` | `completed` | `failed` | `cancelled`, as the platform
   * set it — or `run-deleted` (`VOICE_RUN_DELETED_STATUS`) once there is no run
   * left to have set anything.
   */
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
  /**
   * The wording THIS column's version of the golden set used.
   *
   * Only read by the surface when the case is flagged `promptVaries`; null when
   * that version never asked this question, or when the run is gone and there is
   * no dataset left to say which wording it was given.
   */
  prompt: string | null;
  /** Null until the worker has drained this case — or if it never asked it. */
  output: string | null;
  errorMessage: string | null;
  brandVoiceScore: number | null;
  brandVoiceReasoning: string | null;
  /**
   * True when the run that produced this answer has been deleted.
   *
   * A blank cell otherwise means "not yet"; this one means the answer existed and
   * is gone, which is a different thing to tell somebody reading the table.
   */
  runDeleted: boolean;
}

export interface VoiceComparisonCase {
  /** The authored key — the join, and what a person says when one of them regresses. */
  key: string;
  kind: string;
  probe: string;
  /**
   * The wording the first version on screen gave this question.
   *
   * Only a safe heading for the whole row while `promptVaries` is false; when it
   * is true the versions disagree and each answer carries its own.
   */
  prompt: string;
  /**
   * True when the comparisons on screen worded this question differently under
   * the same key.
   *
   * Rewording a prompt without bumping its key is a legitimate edit — the key is
   * what makes the two versions comparable at all. What is not legitimate is one
   * wording rendered above answers that were given a different one.
   */
  promptVaries: boolean;
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

/** The arm columns both reads select. */
interface ArmRow {
  arm: string;
  agentSlug: string;
  fingerprintVersion: string | null;
  evaluationRunId: string | null;
}

/** The run columns both reads need; the detail selects `datasetId` on top. */
interface RunRow {
  id: string;
  status: string;
  progress: unknown;
  summary: unknown;
}

/**
 * The run behind an arm, if there still is one.
 *
 * Null id and missing row are not the same thing and are not collapsed here: the
 * first is the FK having done its job, the second is a read race between the two
 * queries this file makes. `armStatus` tells them apart; every other caller only
 * cares that there are no numbers.
 */
function runOf<T extends RunRow>(arm: ArmRow, runById: Map<string, T>): T | undefined {
  return arm.evaluationRunId === null ? undefined : runById.get(arm.evaluationRunId);
}

function armStatus(arm: ArmRow, run: RunRow | undefined): string {
  if (arm.evaluationRunId === null) return VOICE_RUN_DELETED_STATUS;
  // A non-null id with no row is a race, not a state: the FK nulls the column on
  // delete, so the next read of this arm reports `run-deleted`. Said as `unknown`
  // rather than guessed at in either direction.
  return run?.status ?? 'unknown';
}

/** One arm, as both the list and the detail's summary block report it. */
function toArmView(arm: ArmRow, run: RunRow | undefined): VoiceComparisonArmView {
  const summary = summarySchema.parse(run?.summary ?? {});
  return {
    arm: arm.arm,
    label: armLabel(arm.arm, arm.fingerprintVersion),
    agentSlug: arm.agentSlug,
    fingerprintVersion: arm.fingerprintVersion,
    evaluationRunId: arm.evaluationRunId,
    status: armStatus(arm, run),
    progress: progressSchema.parse(run?.progress ?? {}),
    brandVoiceMean: summary.stats?.[BRAND_VOICE_JUDGE_SLUG]?.mean ?? null,
  };
}

/** The run ids worth querying — an arm whose run is gone has nothing to look up. */
function runIdsOf(arms: readonly ArmRow[]): string[] {
  return arms.map((arm) => arm.evaluationRunId).filter((id): id is string => id !== null);
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
    where: { id: { in: runIdsOf(comparisons.flatMap((c) => c.arms)) } },
    select: { id: true, status: true, progress: true, summary: true },
  });
  const runById = new Map(runs.map((run) => [run.id, run]));

  return comparisons.map((comparison) => ({
    id: comparison.id,
    goldenSetVersion: comparison.goldenSetVersion,
    datasetContentHash: comparison.datasetContentHash,
    createdAt: comparison.createdAt,
    arms: comparison.arms.map((arm) => toArmView(arm, runOf(arm, runById))),
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
  const runIds = runIdsOf(armRows.map(({ arm }) => arm));

  const runs = await prisma.aiEvaluationRun.findMany({
    where: { id: { in: runIds } },
    select: { id: true, status: true, progress: true, summary: true, datasetId: true },
  });
  const runById = new Map(runs.map((run) => [run.id, run]));

  const [datasetCases, results] = await Promise.all([
    prisma.aiDatasetCase.findMany({
      where: { datasetId: { in: [...new Set(runs.map((run) => run.datasetId))] } },
      select: { datasetId: true, position: true, input: true, metadata: true },
      // `datasetId` as the tie-break, not decoration: two versions give the same
      // question the same position, and without it which of them seeds the case's
      // heading is whatever order Postgres happened to return.
      orderBy: [{ position: 'asc' }, { datasetId: 'asc' }],
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
    promptVaries: boolean;
    answers: VoiceComparisonAnswer[];
  }
  const shells = new Map<string, CaseShell>();
  /** `(datasetId, key)` → the position that dataset gives the case. */
  const positionByDatasetAndKey = new Map<string, number>();
  /** `(datasetId, key)` → the wording that dataset gives the case. */
  const promptByDatasetAndKey = new Map<string, string>();

  for (const row of datasetCases) {
    const metadata = caseMetadataSchema.parse(row.metadata ?? {});
    // A case whose metadata lost its key still has a position, and a case shown
    // under a synthetic key is better than a case silently missing from the
    // comparison — the reader can see something is wrong with it.
    const key = metadata.key ?? `position-${row.position}`;
    const prompt = typeof row.input === 'string' ? row.input : JSON.stringify(row.input);
    positionByDatasetAndKey.set(`${row.datasetId}:${key}`, row.position);
    promptByDatasetAndKey.set(`${row.datasetId}:${key}`, prompt);

    const shell = shells.get(key);
    if (!shell) {
      shells.set(key, {
        key,
        kind: metadata.kind ?? 'unknown',
        probe: metadata.probe ?? '',
        prompt,
        promptVaries: false,
        answers: [],
      });
    } else if (shell.prompt !== prompt) {
      // Same key, different words. The heading loses the right to speak for the
      // whole row; `mixedGoldenSets` already says the two sets differ somewhere,
      // which is not the same as saying THIS question was reworded.
      shell.promptVaries = true;
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
    const run = runOf(arm, runById);
    const cell = {
      columnId: columnId(comparison.id, arm.arm),
      comparisonId: comparison.id,
      arm: arm.arm,
      label: armLabel(arm.arm, arm.fingerprintVersion),
      fingerprintVersion: arm.fingerprintVersion,
    };

    for (const [shellKey, shell] of shells) {
      // No run: the column still exists — its prompt and its version are the half
      // this table was added to keep — but every cell says the answers are gone
      // rather than leaving the gap that means "not yet". Skipping the arm
      // entirely, which is what this used to do, also took the column out of the
      // grid and silently re-aligned every other answer under the wrong heading.
      if (!run) {
        shell.answers.push({
          ...cell,
          prompt: null,
          output: null,
          errorMessage: null,
          brandVoiceScore: null,
          brandVoiceReasoning: null,
          runDeleted: true,
        });
        continue;
      }

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
        ...cell,
        prompt: promptByDatasetAndKey.get(`${run.datasetId}:${shellKey}`) ?? null,
        output: result?.subjectOutput ?? null,
        errorMessage: result?.errorMessage ?? null,
        brandVoiceScore: brandVoice?.score ?? null,
        brandVoiceReasoning: brandVoice?.reasoning ?? null,
        runDeleted: false,
      });
    }
  }

  const summaries: VoiceComparisonSummary[] = comparisons.map((comparison) => ({
    id: comparison.id,
    goldenSetVersion: comparison.goldenSetVersion,
    datasetContentHash: comparison.datasetContentHash,
    createdAt: comparison.createdAt,
    arms: comparison.arms.map((arm) => toArmView(arm, runOf(arm, runById))),
  }));

  return {
    comparisons: summaries,
    columns,
    cases: [...shells.values()],
    mixedGoldenSets: new Set(comparisons.map((c) => c.datasetContentHash)).size > 1,
  };
}
