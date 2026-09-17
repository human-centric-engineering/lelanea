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
 * And four more the reviewer of the branch found, every one of which also reads
 * as a working page: a column whose run has been deleted rendered as "not
 * answered yet"; one wording headed over two versions that asked the question
 * differently; an Against control left pointing at the comparison now selected,
 * which Radix renders as a blank it cannot be cleared from; and a failed reload
 * leaving the PREVIOUS comparison's answers on screen under the error banner.
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
        label: 'FIXTURE ARM A · v1.0',
        agentSlug: 'lelanea-guide',
        fingerprintVersion: '1.0',
        evaluationRunId: 'run-1',
        status: 'completed',
        progress: { casesTotal: 2, casesDone: 2, casesFailed: 0 },
        brandVoiceMean: 0.91,
      },
      {
        arm: 'bare',
        label: 'FIXTURE ARM B',
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
        label: 'FIXTURE ARM A · v1.0',
        agentSlug: 'lelanea-guide',
        fingerprintVersion: '1.0',
        systemPrompt: '[Persona]\nYou are Lelañea.\n\nVoice fingerprint: core v1.0',
      },
      {
        columnId: `${COMPARISON_ID}:bare`,
        comparisonId: COMPARISON_ID,
        arm: 'bare',
        label: 'FIXTURE ARM B',
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
        promptVaries: false,
        answers: [
          {
            columnId: `${COMPARISON_ID}:fingerprint`,
            comparisonId: COMPARISON_ID,
            arm: 'fingerprint',
            label: 'FIXTURE ARM A · v1.0',
            fingerprintVersion: '1.0',
            prompt: 'Hi. I just got here.',
            output: 'You are here. That is the whole of it for now.',
            errorMessage: null,
            brandVoiceScore: 0.93,
            brandVoiceReasoning: 'Short lines, no ornament.',
            runDeleted: false,
          },
          {
            columnId: `${COMPARISON_ID}:bare`,
            comparisonId: COMPARISON_ID,
            arm: 'bare',
            label: 'FIXTURE ARM B',
            fingerprintVersion: null,
            prompt: 'Hi. I just got here.',
            output: null,
            errorMessage: null,
            brandVoiceScore: null,
            brandVoiceReasoning: null,
            runDeleted: false,
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
    render(
      <VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} preflight={null} />
    );

    expect(screen.getByText(/voice test has not been run/i)).toBeVisible();
  });

  it('drops the claim, and says so, after a failed load', async () => {
    // The two states look identical otherwise, and one of them tells an operator
    // her voice has never been checked when it may have been checked all week.
    render(<VoiceComparisonBoard initialComparisons={[]} initialLoadFailed preflight={null} />);

    expect(screen.queryByText(/voice test has not been run/i)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/did not load/i);
  });
});

describe('the answers', () => {
  it('shows each arm’s answer, its score, and what the question was probing', async () => {
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

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
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/not answered yet/i)).toBeVisible());
  });

  it('shows the error where the subject failed on that case', async () => {
    const withError = detail();
    withError.cases[0].answers[1].errorMessage = 'PROVIDER_TIMEOUT';
    respondWith([summary()], withError);

    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText('PROVIDER_TIMEOUT')).toBeVisible());
  });

  it('warns when the two comparisons ran different questions', async () => {
    respondWith([summary()], detail({ mixedGoldenSets: true }));

    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/ran different questions/i)).toBeVisible());
  });
});

describe('what each column was told', () => {
  it('shows the prompt stored at queue time, not one re-read from the agents', async () => {
    const user = userEvent.setup();
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/what each column was told/i)).toBeVisible());
    await user.click(screen.getByRole('button', { name: /what each column was told/i }));

    // The marker in the fingerprint arm's stored prompt is the evidence behind
    // the version suffix on its label; the control's absence of one is the
    // evidence behind the bare arm having no suffix.
    expect(screen.getByText(/Voice fingerprint: core v1\.0/)).toBeVisible();
    expect(screen.getByText(/You are a helpful AI assistant\./)).toBeVisible();
  });
});

describe('queueing', () => {
  it('shows the guard’s refusal verbatim', async () => {
    const user = userEvent.setup();
    // Deliberately not real copy. The behaviour is "whatever the guard said
    // reaches the screen unaltered", so a recognisable sentinel proves it and
    // nothing here has to be chased when the guard's wording changes.
    const refusal = 'FIXTURE REFUSAL: the arm and the remedy, in the guard’s own words.';
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

    render(
      <VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} preflight={null} />
    );
    await user.click(screen.getByRole('button', { name: /run the voice test/i }));

    // Replacing this with "could not queue" would throw away the only part of
    // the guard anybody can act on (`HB10`).
    await waitFor(() => expect(screen.getByText(refusal)).toBeVisible());
  });

  it('POSTs with no body — what runs is the authored set, not a parameter', async () => {
    const user = userEvent.setup();
    render(
      <VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} preflight={null} />
    );

    await user.click(screen.getByRole('button', { name: /run the voice test/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(VOICE_COMPARISON_ENDPOINT, { method: 'POST' })
    );
  });
});

describe('the preflight line', () => {
  const PREFLIGHT = {
    caseCount: 5,
    arms: [],
    modelId: 'claude-sonnet-5',
    cost: {
      midUsd: 0.042,
      lowUsd: 0.021,
      highUsd: 0.084,
      basedOn: 'heuristic' as const,
      pricingKnown: true,
      notes: 'FIXTURE NOTE',
    },
  };

  it('names the model and the cost before anything is queued', () => {
    render(
      <VoiceComparisonBoard
        initialComparisons={[]}
        initialLoadFailed={false}
        preflight={PREFLIGHT}
      />
    );

    expect(screen.getByText(/claude-sonnet-5/)).toBeVisible();
    expect(screen.getByText(/\$0\.042/)).toBeVisible();
  });

  it('says the cost is unknown rather than rendering an unpriced model as free', () => {
    // A model with no published rate contributes $0 to the estimate. Showing
    // that as the number is the one failure mode that matters here: it tells an
    // operator a button that spends money does not.
    render(
      <VoiceComparisonBoard
        initialComparisons={[]}
        initialLoadFailed={false}
        preflight={{ ...PREFLIGHT, cost: { ...PREFLIGHT.cost, pricingKnown: false } }}
      />
    );

    expect(screen.getByText(/cost unknown/i)).toBeVisible();
    expect(screen.queryByText(/\$0\.00/)).toBeNull();
  });

  it('renders nothing at all when the preflight could not be read', () => {
    render(
      <VoiceComparisonBoard initialComparisons={[]} initialLoadFailed={false} preflight={null} />
    );

    expect(screen.queryByText(/model:/i)).toBeNull();
  });
});

describe('stopping a run', () => {
  function runningWorld() {
    const running = summary();
    running.arms[0].status = 'running';
    respondWith([running], detail({ comparisons: [running] }));
    return running;
  }

  it('offers Stop only while an arm is still draining', async () => {
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    // Everything completed — a Stop here could only ever answer "already
    // finished", which is a worse surface than not offering it.
    await waitFor(() => expect(screen.getByText(/You are here/)).toBeVisible());
    expect(screen.queryByRole('button', { name: /^stop$/i })).toBeNull();
  });

  it('asks the comparison to stop, not one of its two runs', async () => {
    const user = userEvent.setup();
    runningWorld();
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeVisible());
    await user.click(screen.getByRole('button', { name: /^stop$/i }));

    // Cancelling one arm and not the other does not stop the spend — it leaves a
    // full column beside a truncated one, which looks like a result.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${VOICE_COMPARISON_ENDPOINT}/${COMPARISON_ID}/cancel`,
        {
          method: 'POST',
        }
      )
    );
  });

  it('cannot queue a second run while one is still going', async () => {
    runningWorld();
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /^stop$/i })).toBeVisible());
    expect(screen.getByRole('button', { name: /run the voice test/i })).toBeDisabled();
  });
});

describe('an arm that answered nothing', () => {
  /**
   * The shape a real all-failed run has, verbatim from the database after a
   * comparison was queued with no `AiProviderConfig` row:
   *
   *   status=completed progress={"casesDone":5,"casesTotal":5,"casesFailed":5}
   *   caseResults: 5 x errorCode=no_provider_configured, subjectOutput=""
   *
   * `completed` is upstream's answer for a run in which nothing succeeded
   * (sunrise#801), so the surface cannot read that word as "there is a result
   * here" — it has to do the arithmetic itself.
   */
  function allFailed(): { list: VoiceComparisonSummary; item: VoiceComparisonDetail } {
    const list = summary();
    list.arms[0] = {
      ...list.arms[0],
      status: 'completed',
      progress: { casesTotal: 5, casesDone: 5, casesFailed: 5 },
      brandVoiceMean: null,
    };
    const item = detail({ comparisons: [list] });
    item.cases[0].answers[0] = {
      ...item.cases[0].answers[0],
      // Empty STRING, not null — a failed case still writes a result row.
      output: '',
      errorMessage: 'No LLM provider is configured for this Sunrise instance yet.',
      brandVoiceScore: null,
      brandVoiceReasoning: 'Skipped: subject execution failed (no_provider_configured).',
    };
    return { list, item };
  }

  it('does not claim it answered them', async () => {
    // `answered all 5, 5 failed` is what this rendered: self-contradictory, and
    // the half a reader takes at face value was the false one.
    const { list, item } = allFailed();
    respondWith([list], item);

    render(
      <VoiceComparisonBoard
        initialComparisons={[list]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/every one of its 5 questions failed/i)).toBeVisible()
    );
    expect(screen.queryByText(/answered all 5/i)).toBeNull();
  });

  it('counts answers, not attempts, when only some cases failed', async () => {
    // `casesDone` includes the failures, so reading it as answers overstates by
    // exactly `casesFailed` — 5 of 5 on a run that answered three.
    const { list } = allFailed();
    list.arms[0] = {
      ...list.arms[0],
      progress: { casesTotal: 5, casesDone: 5, casesFailed: 2 },
    };
    respondWith([list], detail({ comparisons: [list] }));

    render(
      <VoiceComparisonBoard
        initialComparisons={[list]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/answered 3 of 5, 2 failed/i)).toBeVisible());
  });

  it('keeps the failure in the error\u2019s own treatment, not the muted \u201cnot yet\u201d copy', async () => {
    // A case that FAILED and one the worker has not reached are different facts.
    // Rendering the error as the cell's ordinary "nothing here" line would say
    // the column is still filling in when it has already given up.
    const { list, item } = allFailed();
    respondWith([list], item);

    render(
      <VoiceComparisonBoard
        initialComparisons={[list]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/no llm provider is configured/i)).toBeVisible());
    expect(screen.getByRole('alert')).toHaveTextContent(/no llm provider is configured/i);
  });

  it('says an empty answer is unanswered rather than rendering a silent blank cell', async () => {
    // The discriminating case for the empty-STRING bug. `subjectOutput` is '' on
    // a case the subject returned nothing for; with no errorMessage to carry the
    // news, a null check passed the '' through as a real answer and the column
    // rendered an empty paragraph \u2014 a cell that says nothing at all, which a
    // reader takes as "this is still coming" forever.
    const { list, item } = allFailed();
    item.cases[0].answers[0] = {
      ...item.cases[0].answers[0],
      output: '',
      errorMessage: null,
      brandVoiceReasoning: null,
    };
    respondWith([list], item);

    render(
      <VoiceComparisonBoard
        initialComparisons={[list]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    // Both columns are empty in this fixture \u2014 the point is that BOTH say so.
    await waitFor(() => expect(screen.getAllByText(/not answered yet/i)).toHaveLength(2));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('a run that is still draining', () => {
  /** The fingerprint arm three cases in, the control not started. */
  function midRun(): VoiceComparisonSummary {
    const running = summary();
    running.arms[0] = {
      ...running.arms[0],
      status: 'running',
      progress: { casesTotal: 5, casesDone: 3, casesFailed: 0 },
      brandVoiceMean: null,
    };
    running.arms[1] = {
      ...running.arms[1],
      status: 'queued',
      progress: { casesTotal: 5, casesDone: 0, casesFailed: 0 },
      brandVoiceMean: null,
    };
    return running;
  }

  it('reports how far each arm has got, not just that something is happening', async () => {
    // The animation is decoration; these counts are the fact underneath it. A
    // spinner alone cannot tell "three answers in" from "stuck before the first".
    const running = midRun();
    respondWith([running], detail({ comparisons: [running] }));

    render(
      <VoiceComparisonBoard
        initialComparisons={[running]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText('3 of 5 answered')).toBeVisible());
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(2);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '3');
    expect(bars[0]).toHaveAttribute('aria-valuemax', '5');
    expect(bars[1]).toHaveAttribute('aria-valuenow', '0');
  });

  it('says the work continues without the page — the run outlives the tab', async () => {
    // It drains on the platform's maintenance tick, not in this browser. An
    // operator who thinks closing the tab cancels a run either sits and waits or
    // queues a second one, and both cost money.
    const running = midRun();
    respondWith([running], detail({ comparisons: [running] }));

    render(
      <VoiceComparisonBoard
        initialComparisons={[running]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/you can leave this page/i)).toBeVisible());
  });

  it('shows no progress at all once everything is terminal', async () => {
    // A bar left standing under a finished run reads as a run still going, which
    // is the same ambiguity the bar exists to remove.
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/You are here/)).toBeVisible());
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });
});

describe('polling', () => {
  it('re-reads while an arm is still draining', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = summary();
    running.arms[0].status = 'running';
    respondWith([running], detail({ comparisons: [running] }));

    render(
      <VoiceComparisonBoard
        initialComparisons={[running]}
        initialLoadFailed={false}
        preflight={null}
      />
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(9000);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('backs off instead of hammering a rate-limited endpoint', async () => {
    // What this page actually did to an operator: every route under
    // /api/v1/admin/ is on the platform's 30/min admin tier, and polling two
    // endpoints every four seconds is exactly 30/min. A run long enough to be
    // worth watching spent its life at the cap, and retrying on the next tick is
    // what keeps a per-minute bucket empty once it is.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = summary();
    running.arms[0].status = 'running';
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === VOICE_COMPARISON_ENDPOINT
          ? new Response(JSON.stringify({ success: true, data: [running] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(
              JSON.stringify({
                success: false,
                error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' },
              }),
              { status: 429, headers: { 'content-type': 'application/json' } }
            )
      )
    );

    render(
      <VoiceComparisonBoard
        initialComparisons={[running]}
        initialLoadFailed={false}
        preflight={null}
      />
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);

    // Six ticks' worth of time, and not one more request.
    expect(fetchMock.mock.calls.length).toBe(before);
    // And it says so, rather than leaving the platform's bare "Too many
    // requests" to read as the run having failed.
    expect(screen.getByRole('alert')).toHaveTextContent(/paused for a minute/i);
  });

  it('resumes polling once the rate-limit window has passed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = summary();
    running.arms[0].status = 'running';
    let limited = true;
    fetchMock.mockImplementation((url: string) => {
      if (url === VOICE_COMPARISON_ENDPOINT) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: [running] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        );
      }
      if (limited) {
        limited = false;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: false,
              error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests.' },
            }),
            { status: 429, headers: { 'content-type': 'application/json' } }
          )
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, data: detail({ comparisons: [running] }) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    });

    render(
      <VoiceComparisonBoard
        initialComparisons={[running]}
        initialLoadFailed={false}
        preflight={null}
      />
    );
    await vi.waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    const before = fetchMock.mock.calls.length;
    // A backoff with no timer behind it never lifts: nothing re-renders when a
    // deadline merely passes, so the pause would have been permanent. Advanced
    // in two steps because the re-render that re-arms the interval is committed
    // between them, not during the first.
    await vi.advanceTimersByTimeAsync(61_000);
    await vi.waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await vi.advanceTimersByTimeAsync(6_000);

    expect(fetchMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('stops once everything has completed — a finished comparison is immutable', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const before = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20000);

    expect(fetchMock.mock.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The two states a blank cell used to be indistinguishable from
// ---------------------------------------------------------------------------

/** The bare arm's run deleted — the arm row survives it, carrying the prompt. */
function withDeletedRun(): { list: VoiceComparisonSummary; item: VoiceComparisonDetail } {
  const list = summary();
  list.arms[1] = {
    ...list.arms[1],
    evaluationRunId: null,
    status: 'run-deleted',
    progress: { casesTotal: 0, casesDone: 0, casesFailed: 0 },
    brandVoiceMean: null,
  };
  const item = detail({ comparisons: [list] });
  item.cases[0].answers[1] = {
    ...item.cases[0].answers[1],
    prompt: null,
    output: null,
    runDeleted: true,
  };
  return { list, item };
}

describe('a column whose run has been deleted', () => {
  it('says the answers are gone rather than that they have not arrived', async () => {
    // Erasing the admin who queued a comparison cascades their evaluation runs.
    // The arm survives that on purpose, and its zeroed counters look exactly like
    // a queued arm's — so the page has to say which of the two it is looking at,
    // or it tells somebody to wait for answers that are never coming.
    const { list, item } = withDeletedRun();
    respondWith([list], item);

    render(
      <VoiceComparisonBoard
        initialComparisons={[list]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/the run that produced this answer has been deleted/i)).toBeVisible()
    );
    expect(screen.queryByText(/not answered yet/i)).toBeNull();
    expect(screen.getByText(/its run has been deleted/i)).toBeVisible();
  });

  it('still shows the prompt that column was given — the half the arm was kept for', async () => {
    const user = userEvent.setup();
    const { list, item } = withDeletedRun();
    respondWith([list], item);

    render(
      <VoiceComparisonBoard
        initialComparisons={[list]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() => expect(screen.getByText(/what each column was told/i)).toBeVisible());
    await user.click(screen.getByRole('button', { name: /what each column was told/i }));

    // The comparison's whole claim is "these two were told different things".
    // The run is what was deleted; the evidence for the claim was not.
    expect(screen.getByText(/You are a helpful AI assistant\./)).toBeVisible();
  });
});

describe('a question two versions worded differently', () => {
  it('shows each column its own wording instead of heading both with one', async () => {
    // Same authored key, reworded prompt: the key is what makes the two versions
    // comparable, so this is a legitimate edit. Rendering v1.0's wording above
    // v1.1's answers is not — it is a specific claim the page has no basis for.
    const reworded = detail();
    reworded.cases[0].promptVaries = true;
    reworded.cases[0].answers[1] = {
      ...reworded.cases[0].answers[1],
      prompt: 'Hello — I have just arrived.',
      output: 'Welcome! I am delighted to have you here.',
    };
    respondWith([summary()], reworded);

    render(
      <VoiceComparisonBoard
        initialComparisons={[summary()]}
        initialLoadFailed={false}
        preflight={null}
      />
    );

    await waitFor(() =>
      expect(screen.getByText(/worded this question differently/i)).toBeVisible()
    );
    expect(screen.getByText('Hello — I have just arrived.')).toBeVisible();
    // Once, in its own column — not a second time as a heading standing over the
    // answers to the other wording.
    expect(screen.getAllByText('Hi. I just got here.')).toHaveLength(1);
  });
});

describe('a reload that fails', () => {
  it('drops the table rather than captioning the old answers with an error', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const running = summary();
    running.arms[0] = { ...running.arms[0], status: 'running' };
    respondWith([running], detail({ comparisons: [running] }));

    render(
      <VoiceComparisonBoard
        initialComparisons={[running]}
        initialLoadFailed={false}
        preflight={null}
      />
    );
    await vi.waitFor(() =>
      expect(screen.getByText('You are here. That is the whole of it for now.')).toBeVisible()
    );

    // The next poll fails. Everything on screen was read from the comparison the
    // selects name, so leaving it there attributes one comparison's answers to
    // whatever the page now claims to be showing.
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url === VOICE_COMPARISON_ENDPOINT
          ? new Response(JSON.stringify({ success: true, data: [running] }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response(
              JSON.stringify({
                success: false,
                error: { code: 'NOT_FOUND', message: 'No such comparison: cmp-a' },
              }),
              { status: 404, headers: { 'content-type': 'application/json' } }
            )
      )
    );
    await vi.advanceTimersByTimeAsync(9000);

    await vi.waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/no such comparison/i)
    );
    expect(screen.queryByText('You are here. That is the whole of it for now.')).toBeNull();
  });
});

describe('the Against control', () => {
  const OTHER_ID = 'cmp-b';

  function second(): VoiceComparisonSummary {
    return {
      ...summary(),
      id: OTHER_ID,
      goldenSetVersion: '1.1',
      datasetContentHash: 'hash-b',
      createdAt: new Date('2026-09-16T12:00:00.000Z'),
    };
  }

  it('clears itself when the comparison it points at becomes the selected one', async () => {
    // The Against list filters out whatever Comparison names, so leaving it
    // pointing there leaves its trigger matching no item — Radix renders a blank
    // with no placeholder and no way back to "Nothing".
    const user = userEvent.setup();
    const list = [summary(), second()];
    respondWith(list, detail());

    render(
      <VoiceComparisonBoard initialComparisons={list} initialLoadFailed={false} preflight={null} />
    );

    await user.click(screen.getByRole('combobox', { name: /against/i }));
    await user.click(await screen.findByRole('option', { name: /set v1\.1/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${VOICE_COMPARISON_ENDPOINT}/${COMPARISON_ID}?against=${OTHER_ID}`,
        expect.anything()
      )
    );

    // Now select that same comparison as the subject.
    await user.click(screen.getByRole('combobox', { name: /^comparison$/i }));
    await user.click(await screen.findByRole('option', { name: /set v1\.1/ }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${VOICE_COMPARISON_ENDPOINT}/${OTHER_ID}`,
        expect.anything()
      )
    );
    expect(screen.getByRole('combobox', { name: /against/i })).toHaveTextContent(/nothing/i);
  });
});
