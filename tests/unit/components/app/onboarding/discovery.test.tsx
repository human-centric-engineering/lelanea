// @vitest-environment happy-dom

/**
 * The discovery questions surface (f-onboarding t-104): asked on `/app` after
 * the reads (`first`), offered there on a return (`offer`), and kept in
 * Onboarding's own area with every question (`module`). `DiscoveryView` is the
 * server-facing half that turns `DiscoveryState` into `Discovery`'s props and
 * picks the variant; both are exercised here since `discovery-view.tsx` is a
 * thin, untested wrapper otherwise.
 *
 * The API client is mocked, as `first-run.test.tsx` mocks it. What a beat does
 * server-side (slot writes, node progress) is `discovery-store.test.ts`; the
 * position/ledger rules are `discovery.test.ts`. Here: what the surface shows,
 * what it posts, and the module-scope state a Back navigation or a remount
 * must not lose (the same hazard `first-run.tsx` names).
 *
 * @see components/app/onboarding/discovery.tsx
 * @see components/app/onboarding/discovery-view.tsx
 * @see lib/app/onboarding/discovery.ts
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post } };
});

const { clearance } = vi.hoisted(() => ({ clearance: { current: 0 } }));
vi.mock('@/components/app/ui/consent-clearance', () => ({
  useConsentBannerClearance: () => clearance.current,
}));

const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: loggerMock }));

import { APIClientError } from '@/lib/api/client';
import {
  DISCOVERY_COPY,
  DISCOVERY_ROUTE,
  Discovery,
  forgetDiscoveryPage,
  type DiscoveryQuestionProps,
} from '@/components/app/onboarding/discovery';
import { DiscoveryView } from '@/components/app/onboarding/discovery-view';
import type { DiscoveryState } from '@/lib/app/onboarding/discovery-store';

const Q1: DiscoveryQuestionProps = {
  id: 'q1',
  number: 1,
  text: 'What made you start looking?',
  hint: 'Whatever comes to mind first.',
  core: false,
};
const Q2: DiscoveryQuestionProps = {
  id: 'q2',
  number: 2,
  text: 'What does a good week look like?',
  core: false,
};
const Q3: DiscoveryQuestionProps = {
  id: 'q3',
  number: 3,
  text: 'Have you tried something like this before?',
  followUp: { ifYes: 'What happened last time?', ifNo: 'What has stopped you until now?' },
  core: false,
};
const Q4: DiscoveryQuestionProps = {
  id: 'q4',
  number: 4,
  text: 'What would make this worth your time?',
  core: true,
};
const FULL = [Q1, Q2, Q3, Q4];

function baseProps(overrides: Partial<React.ComponentProps<typeof Discovery>> = {}) {
  return {
    userId: 'user_1',
    variant: 'first' as const,
    preamble: 'Before we go further, a few questions worth sitting with.',
    questions: FULL,
    answers: {},
    versions: {},
    skipped: [],
    partial: true,
    moduleHref: '/app/modules/onboarding',
    moduleName: 'Onboarding',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ version: 1 });
  clearance.current = 0;
  forgetDiscoveryPage();
});

describe('variant "first"', () => {
  it('shows the preamble, the break-away line, and the first pending question, with its hint', () => {
    render(<Discovery {...baseProps()} />);

    expect(
      screen.getByText('Before we go further, a few questions worth sitting with.')
    ).toBeInTheDocument();
    expect(screen.getByText(DISCOVERY_COPY.breakAway('Onboarding'))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: Q1.text })).toBeInTheDocument();
    expect(screen.getByText(Q1.hint as string)).toBeInTheDocument();
  });

  it('resumes at the first question neither answered nor skipped', () => {
    render(
      <Discovery {...baseProps({ answers: { q1: { words: 'because' } }, skipped: ['q2'] })} />
    );

    expect(screen.getByRole('heading', { level: 2, name: Q3.text })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: Q1.text })).toBeNull();
  });

  it('renders nothing once every question is answered or skipped', () => {
    const { container } = render(
      <Discovery
        {...baseProps({
          answers: { q1: { words: 'a' }, q3: { words: 'b', branch: 'yes' } },
          skipped: ['q2', 'q4'],
        })}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  describe('answering', () => {
    it('disables Save for empty or whitespace-only text', async () => {
      const user = userEvent.setup();
      render(<Discovery {...baseProps()} />);

      const saveButton = screen.getByRole('button', { name: DISCOVERY_COPY.save });
      expect(saveButton).toBeDisabled();

      await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), '   ');
      expect(saveButton).toBeDisabled();
    });

    it('posts the answer, waits for it, then moves to the next pending question', async () => {
      const user = userEvent.setup();
      render(<Discovery {...baseProps()} />);

      await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'The mess got too big.');
      await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 2, name: Q2.text })).toBeInTheDocument()
      );
      expect(post).toHaveBeenCalledWith(DISCOVERY_ROUTE, {
        body: { action: 'answer', questionId: 'q1', answer: 'The mess got too big.' },
      });
      expect(screen.queryByRole('heading', { level: 2, name: Q1.text })).toBeNull();
    });

    it('shows the error banner and keeps the typed text when the save fails', async () => {
      post.mockRejectedValueOnce(new Error('network down'));
      const user = userEvent.setup();
      render(<Discovery {...baseProps()} />);

      await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'Kept on failure');
      await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

      const banner = await screen.findByRole('alert');
      expect(within(banner).getByText(DISCOVERY_COPY.notSaved)).toBeInTheDocument();
      expect(within(banner).getByText(DISCOVERY_COPY.saveFailed)).toBeInTheDocument();
      // Still on the same question, with the words intact and re-enabled.
      expect(screen.getByRole('heading', { level: 2, name: Q1.text })).toBeInTheDocument();
      expect(screen.getByLabelText(DISCOVERY_COPY.answerLabel)).toHaveValue('Kept on failure');
      expect(screen.getByRole('button', { name: DISCOVERY_COPY.save })).not.toBeDisabled();
    });

    it('shows the APIClientError message for a 400', async () => {
      post.mockRejectedValueOnce(new APIClientError('That answer is too long.', 'VALIDATION', 400));
      const user = userEvent.setup();
      render(<Discovery {...baseProps()} />);

      await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'Anything');
      await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

      const banner = await screen.findByRole('alert');
      expect(within(banner).getByText('That answer is too long.')).toBeInTheDocument();
      expect(within(banner).queryByText(DISCOVERY_COPY.saveFailed)).toBeNull();
    });
  });

  describe('a branching question', () => {
    it('shows no textarea until yes or no is chosen', () => {
      render(<Discovery {...baseProps({ questions: [Q3] })} />);
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByRole('radio', { name: DISCOVERY_COPY.yes })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: DISCOVERY_COPY.no })).toBeInTheDocument();
    });

    it('choosing Yes prompts the yes follow-up and posts branch "yes"', async () => {
      const user = userEvent.setup();
      render(<Discovery {...baseProps({ questions: [Q3] })} />);

      await user.click(screen.getByRole('radio', { name: DISCOVERY_COPY.yes }));
      const box = screen.getByLabelText(Q3.followUp!.ifYes);
      await user.type(box, 'It went badly.');
      await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

      await waitFor(() => expect(post).toHaveBeenCalled());
      expect(post).toHaveBeenCalledWith(DISCOVERY_ROUTE, {
        body: {
          action: 'answer',
          questionId: 'q3',
          answer: 'It went badly.',
          branch: 'yes',
        },
      });
    });

    it('choosing No prompts the no follow-up and posts branch "no"', async () => {
      const user = userEvent.setup();
      render(<Discovery {...baseProps({ questions: [Q3] })} />);

      await user.click(screen.getByRole('radio', { name: DISCOVERY_COPY.no }));
      const box = screen.getByLabelText(Q3.followUp!.ifNo);
      await user.type(box, 'Never got around to it.');
      await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

      await waitFor(() => expect(post).toHaveBeenCalled());
      expect(post).toHaveBeenCalledWith(DISCOVERY_ROUTE, {
        body: {
          action: 'answer',
          questionId: 'q3',
          answer: 'Never got around to it.',
          branch: 'no',
        },
      });
    });
  });

  describe('skip', () => {
    it('posts the skip and moves on', async () => {
      const user = userEvent.setup();
      render(<Discovery {...baseProps({ questions: [Q1, Q2] })} />);

      await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.skip }));

      expect(post).toHaveBeenCalledWith(DISCOVERY_ROUTE, {
        body: { action: 'skip', questionId: 'q1' },
      });
      expect(screen.getByRole('heading', { level: 2, name: Q2.text })).toBeInTheDocument();
    });

    it('is not offered on a core question', () => {
      render(<Discovery {...baseProps({ questions: [Q4] })} />);
      expect(screen.queryByRole('button', { name: DISCOVERY_COPY.skip })).toBeNull();
    });
  });

  describe('leave for now', () => {
    it('posts leave and renders nothing afterward, including on a remount', async () => {
      const user = userEvent.setup();
      const first = render(<Discovery {...baseProps()} />);

      await user.click(first.getByRole('button', { name: DISCOVERY_COPY.leave }));

      expect(post).toHaveBeenCalledWith(DISCOVERY_ROUTE, { body: { action: 'leave' } });
      expect(first.container.firstChild).toBeNull();
      first.unmount();

      // Back to `/app`, same stale server props: module-scope state still says "away".
      const second = render(<Discovery {...baseProps()} />);
      expect(second.container.firstChild).toBeNull();
    });
  });
});

describe('a set that does not allow partial completion', () => {
  it('offers no Skip, no Leave, and no break-away line', () => {
    render(<Discovery {...baseProps({ partial: false })} />);
    expect(screen.getByRole('heading', { level: 2, name: Q1.text })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.skip })).toBeNull();
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.leave })).toBeNull();
    expect(screen.queryByText(DISCOVERY_COPY.breakAway('Onboarding'))).toBeNull();
  });

  it('offers no Skip in the module area either', () => {
    render(<Discovery {...baseProps({ variant: 'module', partial: false })} />);
    expect(screen.getByRole('heading', { level: 2, name: Q1.text })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.skip })).toBeNull();
  });
});

describe('the answer box', () => {
  it('has a visible label and a help popover naming the module to come back to', async () => {
    const user = userEvent.setup();
    render(<Discovery {...baseProps({ moduleName: 'Beginnings' })} />);

    expect(screen.getByLabelText(DISCOVERY_COPY.answerLabel)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.answerHelpLabel }));
    expect(await screen.findByText(DISCOVERY_COPY.answerHelp('Beginnings'))).toBeInTheDocument();
  });
});

describe('variant "offer"', () => {
  function offerProps(overrides: Partial<React.ComponentProps<typeof Discovery>> = {}) {
    return baseProps({ variant: 'offer', ...overrides });
  }

  it('shows the offer card with the next question, not the editor', () => {
    render(<Discovery {...offerProps()} />);
    expect(screen.getByText(DISCOVERY_COPY.offer)).toBeInTheDocument();
    expect(screen.getByText(Q1.text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: DISCOVERY_COPY.answerIt })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('Answer it opens the editor for that question', async () => {
    const user = userEvent.setup();
    render(<Discovery {...offerProps()} />);

    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.answerIt }));

    expect(screen.getByRole('heading', { level: 2, name: Q1.text })).toBeInTheDocument();
    expect(screen.getByLabelText(DISCOVERY_COPY.answerLabel)).toBeInTheDocument();
  });

  it('links to the module the set names, by its name', () => {
    render(
      <Discovery
        {...offerProps({ moduleHref: '/app/modules/beginnings', moduleName: 'Beginnings' })}
      />
    );
    const link = screen.getByRole('link', { name: DISCOVERY_COPY.goTo('Beginnings') });
    expect(link).toHaveAttribute('href', '/app/modules/beginnings');
  });

  it('Not now renders nothing and posts nothing', async () => {
    const user = userEvent.setup();
    const { container } = render(<Discovery {...offerProps()} />);

    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.notNow }));

    expect(container.firstChild).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('renders nothing once every question is answered or skipped', () => {
    const { container } = render(
      <Discovery
        {...offerProps({
          answers: { q1: { words: 'a' }, q3: { words: 'b', branch: 'yes' } },
          skipped: ['q2', 'q4'],
        })}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('variant "module"', () => {
  function moduleProps(overrides: Partial<React.ComponentProps<typeof Discovery>> = {}) {
    return baseProps({ variant: 'module', ...overrides });
  }

  it('lists every question with its status, and opens the editor for the next pending one', () => {
    render(
      <Discovery {...moduleProps({ answers: { q1: { words: 'because' } }, skipped: ['q2'] })} />
    );

    const q1Row = screen.getByRole('button', { name: new RegExp(Q1.text) });
    expect(within(q1Row).getByText(DISCOVERY_COPY.answered)).toBeInTheDocument();
    const q2Row = screen.getByRole('button', { name: new RegExp(Q2.text) });
    expect(within(q2Row).getByText(DISCOVERY_COPY.skipped)).toBeInTheDocument();
    const q3Row = screen.getByRole('button', { name: new RegExp(Q3.text) });
    expect(within(q3Row).getByText(DISCOVERY_COPY.notYet)).toBeInTheDocument();

    // The next pending question (q3) is the one open for editing.
    expect(screen.getByRole('heading', { level: 2, name: Q3.text })).toBeInTheDocument();
  });

  it('clicking an answered question opens it prefilled, and saving it posts a revision', async () => {
    const user = userEvent.setup();
    render(<Discovery {...moduleProps({ answers: { q1: { words: 'because' } } })} />);

    await user.click(screen.getByRole('button', { name: new RegExp(Q1.text) }));

    const box = screen.getByLabelText(DISCOVERY_COPY.answerLabel);
    expect(box).toHaveValue('because');
    // A revision uses "Save", not "Save and continue".
    const saveButton = screen.getByRole('button', { name: DISCOVERY_COPY.saveRevision });
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.save })).toBeNull();
    // No skip button on an already-answered question.
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.skip })).toBeNull();

    await user.clear(box);
    await user.type(box, 'because, revised');
    await user.click(saveButton);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(DISCOVERY_ROUTE, {
        body: { action: 'answer', questionId: 'q1', answer: 'because, revised' },
      })
    );
  });

  it('prefills the branch and follow-up prompt for a revised branching answer', async () => {
    const user = userEvent.setup();
    render(
      <Discovery {...moduleProps({ answers: { q3: { words: 'it went badly', branch: 'yes' } } })} />
    );

    await user.click(screen.getByRole('button', { name: new RegExp(Q3.text) }));

    expect(screen.getByRole('radio', { name: DISCOVERY_COPY.yes })).toBeChecked();
    expect(screen.getByLabelText(Q3.followUp!.ifYes)).toHaveValue('it went badly');
  });

  it('opens the first skipped question once none is left unasked, with no Skip on it', () => {
    render(
      <Discovery
        {...moduleProps({
          answers: { q1: { words: 'a' }, q3: { words: 'b', branch: 'yes' } },
          skipped: ['q2', 'q4'],
        })}
      />
    );

    expect(screen.getByRole('heading', { level: 2, name: Q2.text })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.skip })).toBeNull();
    expect(screen.queryByText(DISCOVERY_COPY.allBehind)).toBeNull();
    expect(screen.getByText(DISCOVERY_COPY.skippedWaiting)).toBeInTheDocument();
  });

  it('moves to the next skipped question when one is answered', async () => {
    const user = userEvent.setup();
    render(
      <Discovery
        {...moduleProps({
          answers: { q1: { words: 'a' }, q3: { words: 'b', branch: 'yes' } },
          skipped: ['q2', 'q4'],
        })}
      />
    );

    await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'Quiet mornings.');
    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: Q4.text })).toBeInTheDocument()
    );
  });

  it('shows allBehind when every question is answered, with no editor', () => {
    render(
      <Discovery
        {...moduleProps({
          answers: {
            q1: { words: 'a' },
            q2: { words: 'b' },
            q3: { words: 'c', branch: 'yes' },
            q4: { words: 'd' },
          },
        })}
      />
    );

    expect(screen.getByText(DISCOVERY_COPY.allBehind)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a revision made elsewhere over an older one saved on this page', async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce({ version: 1 });
    const first = render(<Discovery {...moduleProps()} />);

    await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'Written here.');
    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    first.unmount();

    // Revised since on another device: the server now has version 2.
    render(
      <Discovery
        {...moduleProps({
          answers: { q1: { words: 'Revised on the phone.' } },
          versions: { q1: 2 },
        })}
      />
    );
    await user.click(screen.getByRole('button', { name: new RegExp(Q1.text) }));
    expect(screen.getByLabelText(DISCOVERY_COPY.answerLabel)).toHaveValue('Revised on the phone.');
  });

  it('keeps its own save over the server props it was rendered from', async () => {
    const user = userEvent.setup();
    post.mockResolvedValueOnce({ version: 2 });
    const first = render(
      <Discovery {...moduleProps({ answers: { q1: { words: 'Old.' } }, versions: { q1: 1 } })} />
    );

    await user.click(screen.getByRole('button', { name: new RegExp(Q1.text) }));
    const box = screen.getByLabelText(DISCOVERY_COPY.answerLabel);
    await user.clear(box);
    await user.type(box, 'New.');
    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.saveRevision }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    first.unmount();

    // Back: the router cache restores the props from before the save.
    render(
      <Discovery {...moduleProps({ answers: { q1: { words: 'Old.' } }, versions: { q1: 1 } })} />
    );
    await user.click(screen.getByRole('button', { name: new RegExp(Q1.text) }));
    expect(screen.getByLabelText(DISCOVERY_COPY.answerLabel)).toHaveValue('New.');
  });

  it('does not ask an answered question again on a remount, even with stale server props', async () => {
    const user = userEvent.setup();
    const first = render(<Discovery {...moduleProps()} />);

    await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'because');
    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 2, name: Q2.text })).toBeInTheDocument()
    );
    first.unmount();

    // Remount with the same (now-stale) empty server props.
    render(<Discovery {...moduleProps()} />);

    expect(screen.getByRole('heading', { level: 2, name: Q2.text })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: Q1.text })).toBeNull();
    const q1Row = screen.getByRole('button', { name: new RegExp(Q1.text) });
    expect(within(q1Row).getByText(DISCOVERY_COPY.answered)).toBeInTheDocument();
  });
});

describe('DiscoveryView', () => {
  function stateFor(overrides: Partial<DiscoveryState> = {}): DiscoveryState {
    return {
      set: {
        moduleSlug: 'onboarding',
        preamble: { style: 'italic', text: 'A few questions, whenever you are ready.' },
        pacing: { rushDiscouraged: true, allowPartialCompletion: true, note: '' },
        coreOnly: false,
        questions: FULL.map((q) => ({
          id: q.id,
          number: q.number,
          text: q.text,
          inputType: 'long_text' as const,
          ...(q.hint !== undefined && { hint: q.hint }),
          ...(q.followUp !== undefined && { conditionalFollowUp: q.followUp }),
          weight: q.core ? 100 : 50,
          revision: 0,
          slotSlug: `discovery_${q.id}`,
          core: q.core,
        })),
      },
      answers: {},
      versions: {},
      position: { next: 'q1', skipped: [], finished: false },
      started: false,
      ...overrides,
    };
  }

  it('renders nothing on /app when the position is finished', () => {
    const { container } = render(
      <DiscoveryView
        userId="user_1"
        where="app"
        state={stateFor({ position: { next: null, skipped: [], finished: true }, started: true })}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('is the "first" variant on /app before the first sitting', () => {
    render(<DiscoveryView userId="user_1" where="app" state={stateFor({ started: false })} />);
    // "first" shows the preamble and the break-away line, and no offer card.
    expect(screen.getByText(DISCOVERY_COPY.breakAway('Onboarding'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.answerIt })).toBeNull();
  });

  it('is the "offer" variant on /app after the first sitting', () => {
    render(<DiscoveryView userId="user_1" where="app" state={stateFor({ started: true })} />);
    expect(screen.getByRole('button', { name: DISCOVERY_COPY.answerIt })).toBeInTheDocument();
    expect(screen.queryByText(DISCOVERY_COPY.breakAway('Onboarding'))).toBeNull();
  });

  it('is the "module" variant in Onboarding\'s own area, regardless of position', () => {
    render(
      <DiscoveryView
        userId="user_1"
        where="module"
        state={stateFor({
          answers: { q1: { words: 'a' }, q3: { words: 'b', branch: 'yes' } },
          position: { next: null, skipped: ['q2', 'q4'], finished: true },
          started: true,
        })}
      />
    );
    expect(screen.getByTestId('discovery-module')).toBeInTheDocument();
    // Nothing unasked is left, so the first skipped question is open.
    expect(screen.getByRole('heading', { level: 2, name: Q2.text })).toBeInTheDocument();
  });

  it('asks again on a return, without the preamble, when partial completion is off', () => {
    const state = stateFor({ started: true });
    state.set.pacing.allowPartialCompletion = false;
    render(<DiscoveryView userId="user_1" where="app" state={state} />);

    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.answerIt })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: Q1.text })).toBeInTheDocument();
    expect(screen.queryByText(state.set.preamble.text)).toBeNull();
    expect(screen.queryByRole('button', { name: DISCOVERY_COPY.leave })).toBeNull();
  });

  it('links to the area of the module the set names', () => {
    const state = stateFor({ started: true });
    state.set.moduleSlug = 'curiosity-of-self';
    render(<DiscoveryView userId="user_1" where="app" state={state} />);

    const link = screen.getByRole('link', { name: DISCOVERY_COPY.goTo('Curiosity of self') });
    expect(link).toHaveAttribute('href', '/app/modules/curiosity-of-self');
  });

  it('renders nothing for a set with no questions', () => {
    const state = stateFor();
    state.set.questions = [];
    const { container } = render(<DiscoveryView userId="user_1" where="module" state={state} />);
    expect(container.firstChild).toBeNull();
  });
});
