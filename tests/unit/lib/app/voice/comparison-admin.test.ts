/**
 * Two versions' answers land beside each other because they answer the same
 * QUESTION — not because they happened to be in the same row.
 *
 * The join is the only real logic in the read layer, and getting it wrong is
 * silent in the worst way: line the greeting up against the decline and the
 * surface renders a regression that nothing about her voice caused. Two versions
 * of the golden set are explicitly allowed to reorder, drop and add prompts —
 * that is what a version IS — so joining on `position` would produce exactly that
 * every time the set was edited.
 *
 * The other thing pinned here is the gap. A question one version asked and the
 * other did not has to render as an empty column rather than vanishing, because a
 * case silently missing from a comparison reads as a case that passed.
 *
 * @see lib/app/voice/comparison-admin.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeRun {
  id: string;
  status: string;
  progress: unknown;
  summary: unknown;
  datasetId: string;
}

const world = {
  comparisons: [] as {
    id: string;
    goldenSetVersion: string;
    datasetContentHash: string;
    createdAt: Date;
    arms: {
      arm: string;
      agentSlug: string;
      fingerprintVersion: string | null;
      systemPrompt: string;
      evaluationRunId: string;
    }[];
  }[],
  runs: [] as FakeRun[],
  cases: [] as { datasetId: string; position: number; input: unknown; metadata: unknown }[],
  results: [] as {
    runId: string;
    casePosition: number;
    subjectOutput: string;
    errorMessage: string | null;
    metricScores: unknown;
  }[],
};

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appVoiceComparison: {
      findMany: vi.fn(async ({ where }: { where?: { id: { in: string[] } } }) =>
        where ? world.comparisons.filter((c) => where.id.in.includes(c.id)) : world.comparisons
      ),
    },
    aiEvaluationRun: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        world.runs.filter((run) => where.id.in.includes(run.id))
      ),
    },
    aiDatasetCase: {
      findMany: vi.fn(async ({ where }: { where: { datasetId: { in: string[] } } }) =>
        world.cases.filter((entry) => where.datasetId.in.includes(entry.datasetId))
      ),
    },
    aiEvaluationCaseResult: {
      findMany: vi.fn(async ({ where }: { where: { runId: { in: string[] } } }) =>
        world.results.filter((result) => where.runId.in.includes(result.runId))
      ),
    },
  },
}));

import { getVoiceComparison, listVoiceComparisons } from '@/lib/app/voice/comparison-admin';
import { BRAND_VOICE_JUDGE_SLUG } from '@/lib/app/voice/golden-set';

const PROGRESS = { casesTotal: 2, casesDone: 2, casesFailed: 0 };

function score(value: number) {
  return { [BRAND_VOICE_JUDGE_SLUG]: { score: value, reasoning: 'because' } };
}

beforeEach(() => {
  vi.clearAllMocks();

  // Two comparisons over two VERSIONS of the set. v1.1 reorders the two shared
  // prompts and swaps one of them for a new question — the exact shape a
  // position-based join gets wrong.
  world.cases = [
    {
      datasetId: 'set-v1.0',
      position: 0,
      input: 'Hi.',
      metadata: { key: 'hello', kind: 'greeting', probe: 'p' },
    },
    {
      datasetId: 'set-v1.0',
      position: 1,
      input: 'Diagnose me.',
      metadata: { key: 'decline', kind: 'decline', probe: 'p' },
    },
    {
      datasetId: 'set-v1.1',
      position: 0,
      input: 'Diagnose me.',
      metadata: { key: 'decline', kind: 'decline', probe: 'p' },
    },
    {
      datasetId: 'set-v1.1',
      position: 1,
      input: 'Rank me.',
      metadata: { key: 'ranking', kind: 'decline', probe: 'p' },
    },
  ];

  world.runs = [
    {
      id: 'run-a1',
      status: 'completed',
      progress: PROGRESS,
      summary: { stats: { [BRAND_VOICE_JUDGE_SLUG]: { mean: 0.9 } } },
      datasetId: 'set-v1.0',
    },
    { id: 'run-a2', status: 'completed', progress: PROGRESS, summary: {}, datasetId: 'set-v1.0' },
    {
      id: 'run-b1',
      status: 'running',
      progress: { casesTotal: 2, casesDone: 1, casesFailed: 0 },
      summary: null,
      datasetId: 'set-v1.1',
    },
    {
      id: 'run-b2',
      status: 'queued',
      progress: { casesTotal: 2, casesDone: 0, casesFailed: 0 },
      summary: null,
      datasetId: 'set-v1.1',
    },
  ];

  world.comparisons = [
    {
      id: 'cmp-a',
      goldenSetVersion: '1.0',
      datasetContentHash: 'hash-a',
      createdAt: new Date('2026-09-01T10:00:00Z'),
      arms: [
        {
          arm: 'bare',
          agentSlug: 'voice-control-bare',
          fingerprintVersion: null,
          systemPrompt: 'bare prompt',
          evaluationRunId: 'run-a2',
        },
        {
          arm: 'fingerprint',
          agentSlug: 'lelanea-guide',
          fingerprintVersion: '1.0',
          systemPrompt: 'her prompt v1.0',
          evaluationRunId: 'run-a1',
        },
      ],
    },
    {
      id: 'cmp-b',
      goldenSetVersion: '1.1',
      datasetContentHash: 'hash-b',
      createdAt: new Date('2026-09-02T10:00:00Z'),
      arms: [
        {
          arm: 'bare',
          agentSlug: 'voice-control-bare',
          fingerprintVersion: null,
          systemPrompt: 'bare prompt',
          evaluationRunId: 'run-b2',
        },
        {
          arm: 'fingerprint',
          agentSlug: 'lelanea-guide',
          fingerprintVersion: '1.1',
          systemPrompt: 'her prompt v1.1',
          evaluationRunId: 'run-b1',
        },
      ],
    },
  ];

  world.results = [
    {
      runId: 'run-a1',
      casePosition: 0,
      subjectOutput: 'v1.0 on hello',
      errorMessage: null,
      metricScores: score(0.9),
    },
    {
      runId: 'run-a1',
      casePosition: 1,
      subjectOutput: 'v1.0 on decline',
      errorMessage: null,
      metricScores: score(0.8),
    },
    // v1.1 answers the SHARED prompt at a different position.
    {
      runId: 'run-b1',
      casePosition: 0,
      subjectOutput: 'v1.1 on decline',
      errorMessage: null,
      metricScores: score(0.95),
    },
  ];
});

describe('listVoiceComparisons', () => {
  it('labels each arm with the version it was wearing, and reports its run status', async () => {
    const list = await listVoiceComparisons();

    const fingerprint = list
      .find((entry) => entry.id === 'cmp-a')
      ?.arms.find((arm) => arm.arm === 'fingerprint');
    expect(fingerprint?.label).toBe('Her voice · v1.0');
    expect(fingerprint?.brandVoiceMean).toBe(0.9);
    expect(fingerprint?.status).toBe('completed');

    // The bare arm carries no version, so its label carries none either — a
    // column headed `Bare model · v1.0` would be a lie on the one column whose
    // whole job is to have no fingerprint.
    const bare = list.find((entry) => entry.id === 'cmp-a')?.arms.find((arm) => arm.arm === 'bare');
    expect(bare?.label).toBe('Bare model');
    expect(bare?.fingerprintVersion).toBeNull();
    expect(bare?.brandVoiceMean).toBeNull();
  });
});

describe('getVoiceComparison', () => {
  it('puts one comparison’s two arms against each question', async () => {
    const detail = await getVoiceComparison(['cmp-a']);

    expect(detail.cases.map((entry) => entry.key)).toEqual(['hello', 'decline']);
    expect(detail.mixedGoldenSets).toBe(false);

    const hello = detail.cases.find((entry) => entry.key === 'hello');
    expect(hello?.prompt).toBe('Hi.');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.output).toBe('v1.0 on hello');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.brandVoiceScore).toBe(0.9);
    // The control's run has drained nothing yet, and "not answered" is different
    // from "answered badly".
    expect(hello?.answers.find((a) => a.arm === 'bare')?.output).toBeNull();
  });

  it('joins two versions on the QUESTION, not on the row they happen to sit in', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);

    const decline = detail.cases.find((entry) => entry.key === 'decline');
    // Position 1 in v1.0, position 0 in v1.1. A positional join would have put
    // `v1.1 on decline` under the greeting.
    expect(
      decline?.answers.find((a) => a.comparisonId === 'cmp-a' && a.arm === 'fingerprint')?.output
    ).toBe('v1.0 on decline');
    expect(
      decline?.answers.find((a) => a.comparisonId === 'cmp-b' && a.arm === 'fingerprint')?.output
    ).toBe('v1.1 on decline');
  });

  it('shows the gap where one version never asked the question', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);

    // A presence claim first: `ranking` exists at all, and v1.0 has a column for
    // it. Without that, "v1.0 answered nothing" would pass against a case that
    // had been dropped from the view entirely — which is the failure this asserts
    // against.
    const ranking = detail.cases.find((entry) => entry.key === 'ranking');
    expect(ranking).toBeDefined();
    expect(ranking?.answers.filter((a) => a.comparisonId === 'cmp-a')).toHaveLength(2);
    expect(ranking?.answers.find((a) => a.comparisonId === 'cmp-a')?.output).toBeNull();

    const hello = detail.cases.find((entry) => entry.key === 'hello');
    expect(hello?.answers.find((a) => a.comparisonId === 'cmp-b')?.output).toBeNull();
  });

  it('says out loud that the two comparisons ran different questions', async () => {
    expect((await getVoiceComparison(['cmp-a', 'cmp-b'])).mixedGoldenSets).toBe(true);
    expect((await getVoiceComparison(['cmp-a'])).mixedGoldenSets).toBe(false);
  });

  it('hands back the prompt each column was actually given', async () => {
    const detail = await getVoiceComparison(['cmp-a', 'cmp-b']);

    // Stored at queue time, so it is what produced the answers even if her core
    // has since changed — which is the whole reason it is a column rather than
    // something re-read off the agent now.
    expect(detail.columns.map((column) => column.systemPrompt).sort()).toEqual([
      'bare prompt',
      'bare prompt',
      'her prompt v1.0',
      'her prompt v1.1',
    ]);
  });

  it('refuses an id it cannot find rather than silently showing one column', async () => {
    await expect(getVoiceComparison(['cmp-a', 'cmp-missing'])).rejects.toThrow(/cmp-missing/);
  });

  it('renders an answer whose scores came back in a shape it does not know', async () => {
    // A `Json` column will hold anything. The page exists to show her answers, so
    // a disagreement about a score must not be what stops them being read.
    world.results[0].metricScores = 'not an object at all';

    const detail = await getVoiceComparison(['cmp-a']);
    const hello = detail.cases.find((entry) => entry.key === 'hello');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.output).toBe('v1.0 on hello');
    expect(hello?.answers.find((a) => a.arm === 'fingerprint')?.brandVoiceScore).toBeNull();
  });
});
