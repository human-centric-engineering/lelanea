// @vitest-environment happy-dom

/**
 * The voice-comparison board.
 *
 * Not "a board renders answers". The five things wrong in a plausible first
 * version, every one of which reads as a working page:
 *
 *  - the empty state claiming "nothing has been run" after a failed load, which
 *    is a false statement about whether her voice has ever been checked (`HB9`);
 *  - a refusal from `assertArmsComparable` replaced by a generic "could not
 *    queue", throwing away the only part of the guard anybody can act on;
 *  - a missing answer rendered as a blank cell, indistinguishable between "the
 *    worker has not got here yet" and "this case failed";
 *  - polling a completed comparison forever, or not polling a running one — the
 *    second leaves somebody staring at a half-empty table;
 *  - the "what each column was told" panel re-reading the agents now instead of
 *    showing the prompt stored at queue time, which would caption old answers
 *    with a core that has since changed.
 *
 * @see components/app/admin/voice-comparison.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { VoiceComparisonBoard } from '@/components/app/admin/voice-comparison';
import { VOICE_COMPARISON_ENDPOINT } from '@/lib/app/voice/endpoint';
import type {
  VoiceComparisonDetail,
  VoiceComparisonSummary,
} from '@/lib/app/voice/comparison-admin';

const COMPARISON_ID = 'cmp-a';

function summary(overrides: Partial<VoiceComparisonSummary> = {}): VoiceComparisonSummary {
  return {
    id: COMPARISON_ID,
    goldenSetVersion: '1.0',
    datasetContentHash: 'hash-a',
    createdAt: new Date('2026-09-16T10:00:00.000Z'),
    arms: [
      {
        arm: 'fingerprint',
        label: 'Her voice · v1.0',
        agentSlug: 'lelanea-guide',
        fingerprintVersion: '1.0',
        evaluationRunId: 'run-1',
        status: 'completed',
        progress: { casesTotal: 2, casesDone: 2, casesFailed: 0 },
        brandVoiceMean: 0.91,
      },
      {
        arm: 'bare',
        label: 'Bare model',
        agentSlug: 'voice-control-bare',
        fingerprintVersion: null,
        evaluationRunId: 'run-2',
        status: 'completed',
        progress: { casesTotal: 2, casesDone: 2, casesFailed: 0 },
        brandVoiceMean: 0.32,
      },
    ],
    ...overrides,
  };
}

function detail(overrides: Partial<VoiceComparisonDetail> = {}): VoiceComparisonDetail {
  return {
    comparisons: [summary()],
    columns: [
      {
        columnId: `${COMPARISON_ID}:fingerprint`,
        comparisonId: COMPARISON_ID,
        arm: 'fingerprint',
        label: 'Her voice · v1.0',
        agentSlug: 'lelanea-guide',
        fingerprintVersion: '1.0',
        systemPrompt: '[Persona]\nYou are Lelañea.\n\nVoice fingerprint: core v1.0',
      },
      {
        columnId: `${COMPARISON_ID}:bare`,
        comparisonId: COMPARISON_ID,
        arm: 'bare',
        label: 'Bare model',
        agentSlug: 'voice-control-bare',
        fingerprintVersion: null,
        systemPrompt: '[Instructions]\nYou are a helpful AI assistant.',
      },
    ],
    cases: [
      {
        key: 'first-hello',
        kind: 'greeting',
        probe: 'The opening register.',
        prompt: 'Hi. I just got here.',
        answers: [
          {
            columnId: `${COMPARISON_ID}:fingerprint`,
            comparisonId: COMPARISON_ID,
            arm: 'fingerprint',
            label: 'Her voice · v1.0',
            fingerprintVersion: '1.0',
            output: 'You are here. That is the whole of it for now.',
            errorMessage: null,
            brandVoiceScore: 0.93,
            brandVoiceReasoning: 'Short lines, no ornament.',
          },
          {
            columnId: `${COMPARISON_ID}:bare`,
            comparisonId: COMPARISON_ID,
            arm: 'bare',
            label: 'Bare model',
            fingerprintVersion: null,
            output: null,
            errorMessage: null,
            brandVoiceScore: null,
            brandVoiceReasoning: null,
          },
        ],
      },
    ],
    mixedGoldenSets: false,
    ...overrides,
  };
}

const fetchMock = vi.fn();

/** The board's two GETs, keyed by which URL they answer. */
function respondWith(list: VoiceComparisonSummary[], item: VoiceComparisonDetail): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: { comparisonId: COMPARISON_ID } }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        })
      );
    }
    const body = url === VOICE_COMPARISON_ENDPOINT ? list : item;
    return Promise.resolve(
      new Response(JSON.stringify({ success: true, data: body }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  respondWith([summary()], detail());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the empty state', () => {
  it('claims nothing has run only when the list actually loaded', async () => {
    render(<VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} />);

    expect(screen.getByText(/nothing has been run through the golden set yet/i)).toBeVisible();
  });

  it('drops the claim, and says so, after a failed load', async () => {
    // The two states look identical otherwise, and one of them tells an operator
    // her voice has never been checked when it may have been checked all week.
    render(<VoiceComparisonBoard initialComparisons={[]} initialLoadFailed />);

    expect(screen.queryByText(/nothing has been run through the golden set yet/i)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/did not load/i);
  });
});

describe('the answers', () => {
  it('shows each arm’s answer, its score, and what the question was probing', async () => {
    render(<VoiceComparisonBoard initialComparisons={[summary()]} initialLoadFailed={false} />);

    await waitFor(() => {
      expect(screen.getByText('You are here. That is the whole of it for now.')).toBeVisible();
    });
    expect(screen.getByText('Hi. I just got here.')).toBeVisible();
    // Without the probe a reader cannot tell whether an answer is supposed to
    // decline, to ground a claim, or to admit it has nothing.
    expect(screen.getByText('The opening register.')).toBeVisible();
    expect(screen.getByText('greeting')).toBeVisible();
    expect(screen.getByText(/brand voice 0\.93/)).toBeVisible();
  });

  it('says a case is unanswered rather than rendering an empty column', async () => {
    // "Not yet" and "it failed" are different facts, and a blank cell is neither.
    render(<VoiceComparisonBoard initialComparisons={[summary()]} initialLoadFailed={false} />);

    await waitFor(() => expect(screen.getByText(/not answered yet/i)).toBeVisible());
  });

  it('shows the error where the subject failed on that case', async () => {
    const withError = detail();
    withError.cases[0].answers[1].errorMessage = 'PROVIDER_TIMEOUT';
    respondWith([summary()], withError);

    render(<VoiceComparisonBoard initialComparisons={[summary()]} initialLoadFailed={false} />);

    await waitFor(() => expect(screen.getByText('PROVIDER_TIMEOUT')).toBeVisible());
  });

  it('warns when the two comparisons ran different questions', async () => {
    respondWith([summary()], detail({ mixedGoldenSets: true }));

    render(<VoiceComparisonBoard initialComparisons={[summary()]} initialLoadFailed={false} />);

    await waitFor(() => expect(screen.getByText(/ran different questions/i)).toBeVisible());
  });
});

describe('what each column was told', () => {
  it('shows the prompt stored at queue time, not one re-read from the agents', async () => {
    const user = userEvent.setup();
    render(<VoiceComparisonBoard initialComparisons={[summary()]} initialLoadFailed={false} />);

    await waitFor(() => expect(screen.getByText(/what each column was told/i)).toBeVisible());
    await user.click(screen.getByRole('button', { name: /what each column was told/i }));

    // The marker in the fingerprint arm's stored prompt is the evidence behind
    // the version label; the control's absence of one is the evidence behind
    // "Bare model".
    expect(screen.getByText(/Voice fingerprint: core v1\.0/)).toBeVisible();
    expect(screen.getByText(/You are a helpful AI assistant\./)).toBeVisible();
  });
});

describe('queueing', () => {
  it('shows the guard’s refusal verbatim', async () => {
    const user = userEvent.setup();
    const refusal =
      'The Bare model arm’s system prompt carries fingerprint v1.0, so the control is wearing her voice.';
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Promise.resolve(
            new Response(
              JSON.stringify({
                success: false,
                error: { code: 'VALIDATION_ERROR', message: refusal },
              }),
              { status: 400, headers: { 'content-type': 'application/json' } }
            )
          )
        : Promise.resolve(
            new Response(JSON.stringify({ success: true, data: [] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          )
    );

    render(<VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} />);
    await user.click(screen.getByRole('button', { name: /run the golden set/i }));

    // Replacing this with "could not queue" would throw away the only part of
    // the guard anybody can act on (`HB10`).
    await waitFor(() => expect(screen.getByText(refusal)).toBeVisible());
  });

  it('POSTs with no body — what runs is the authored set, not a parameter', async () => {
    const user = userEvent.setup();
    render(<VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} />);

    await user.click(screen.getByRole('button', { name: /run the golden set/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(VOICE_COMPARISON_ENDPOINT, { method: 'POST' })
    );
  });
});

describe('polling', () => {
  it('re-reads while an arm is still draining', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = summary();
    running.arms[0].status = 'running';
    respondWith([running], detail({ comparisons: [running] }));

    render(<VoiceComparisonBoard initialComparisons={[running]} initialLoadFailed={false} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9000);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('stops once everything has completed — a finished comparison is immutable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<VoiceComparisonBoard initialComparisons={[summary()]} initialLoadFailed={false} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
