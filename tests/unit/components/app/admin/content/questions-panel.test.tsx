// @vitest-environment happy-dom

/**
 * The discovery questions editor (f-content-seeds t-91): the set's framing,
 * each question, reordering, adding and removing.
 *
 * What is proved here is what the admin sees and what the browser sends —
 * never what the route decides (that is the route's test) nor what the store
 * writes (the store's).
 *
 * @see components/app/admin/content/questions-panel.tsx
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { QuestionsPanel } from '@/components/app/admin/content/questions-panel';
import {
  contentEntityEndpoint,
  contentItemEndpoint,
  contentOrderEndpoint,
} from '@/lib/app/content/admin/endpoint';
import { createMockRouter } from '@/tests/types/mocks';
import type { QuestionsAdminView } from '@/lib/app/content/admin/questions';
import type { DiscoveryQuestionSet, DiscoveryQuestionView } from '@/lib/app/content/question-view';

const mockRouter = createMockRouter();
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(status: number, message: string, details?: unknown) {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'ERR', message, details } }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

function sent(index = 0) {
  const call = fetchMock.mock.calls[index] as [string, RequestInit & { body?: string }];
  return {
    url: call[0],
    method: call[1].method,
    body: call[1].body === undefined ? undefined : (JSON.parse(call[1].body) as unknown),
  };
}

const READERS = ['the public content API (/api/v1/app/content/discovery-questions)'];

const Q1: DiscoveryQuestionView = {
  id: 'q1',
  number: 1,
  text: 'What matters to you right now?',
  inputType: 'long_text',
  hint: 'Take your time.',
  weight: 100,
  revision: 3,
};

const Q2: DiscoveryQuestionView = {
  id: 'q2',
  number: 2,
  text: 'Have you faced this before?',
  inputType: 'long_text',
  conditionalFollowUp: { ifYes: 'What happened then?', ifNo: 'What holds you back?' },
  weight: 40,
  revision: 1,
};

const SET: DiscoveryQuestionSet = {
  collection: {
    id: 'discovery_questions',
    title: 'Discovery',
    chartTitle: 'Discover',
    module: 'module_02_b',
    phase: 1,
    version: '1.0',
    locale: 'en-US',
    revision: 4,
  },
  preamble: { style: 'note', text: 'Take your time with these.' },
  pacing: { rushDiscouraged: true, allowPartialCompletion: false, note: 'No rush.' },
  questions: [Q1, Q2],
};

const VIEW: QuestionsAdminView = {
  seeded: true,
  set: SET,
  readers: READERS,
  module: { slug: 'onboarding', name: 'Onboarding', coreSetOnly: false },
};

beforeEach(() => {
  fetchMock.mockReset();
  mockRouter.refresh.mockClear();
});

describe('before the seed has run', () => {
  it('says so, and offers nothing to edit', () => {
    render(
      <QuestionsPanel initialView={{ seeded: false, set: null, readers: [], module: null }} />
    );

    expect(screen.getByText(/have not been seeded yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add a question' })).toBeNull();
  });
});

describe('the framing', () => {
  it('saves title, chart title, module, phase, version, locale, preamble and pacing in one PUT', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'] }));
    render(<QuestionsPanel initialView={VIEW} />);

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'Discovery, reworded');

    const chart = screen.getByLabelText('Chart title');
    await user.clear(chart);
    await user.type(chart, 'Discover more');

    const moduleField = screen.getByLabelText('Module');
    await user.clear(moduleField);
    await user.type(moduleField, 'module_03_a');

    const phase = screen.getByLabelText('Phase');
    await user.clear(phase);
    await user.type(phase, '2');

    const version = screen.getByLabelText('Version');
    await user.clear(version);
    await user.type(version, '1.1');

    const locale = screen.getByLabelText('Locale');
    await user.clear(locale);
    await user.type(locale, 'en-GB');

    const preamble = screen.getByLabelText('Preamble');
    await user.clear(preamble);
    await user.type(preamble, 'A new preamble.');

    const style = screen.getByLabelText('Preamble style');
    await user.clear(style);
    await user.type(style, 'callout');

    await user.click(screen.getByLabelText('Discourage rushing'));
    await user.click(screen.getByLabelText('Allow stopping part-way'));

    const pacingNote = screen.getByLabelText('Pacing note');
    await user.clear(pacingNote);
    await user.type(pacingNote, 'A different note.');

    await user.click(screen.getByRole('button', { name: 'Save framing' }));

    expect(sent().url).toBe(contentItemEndpoint('questions', 'set', 'discovery_questions'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      revision: 4,
      title: 'Discovery, reworded',
      chartTitle: 'Discover more',
      moduleId: 'module_03_a',
      phase: 2,
      preamble: { style: 'callout', text: 'A new preamble.' },
      pacing: { rushDiscouraged: false, allowPartialCompletion: true, note: 'A different note.' },
      version: '1.1',
      locale: 'en-GB',
    });
    expect(await screen.findByText('Saved the question set.')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('says plainly when a framing save changed nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save framing' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s refusal for a framing save', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'The set moved under you.'));
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save framing' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The set moved under you.');
  });
});

describe('the module the questions belong to', () => {
  it('names it, says the Core Set is off, and links to where it is changed', () => {
    render(<QuestionsPanel initialView={VIEW} />);

    const note = screen.getByRole('heading', {
      name: 'Asked in the Onboarding module',
    }).parentElement!;
    expect(note).toHaveTextContent('Core Set only is off: a person is asked every question.');
    expect(
      within(note).getByRole('link', { name: 'Change it in the module’s settings' })
    ).toHaveAttribute('href', '/admin/framework/modules/onboarding');
    // The switch is the module's config, so the framing form has none.
    expect(screen.queryByLabelText('Core Set only')).toBeNull();
  });

  it('says so when the Core Set is on', () => {
    render(
      <QuestionsPanel
        initialView={{
          ...VIEW,
          module: { slug: 'onboarding', name: 'Onboarding', coreSetOnly: true },
        }}
      />
    );

    expect(
      screen.getByText(/a person is asked only the questions weighted 100/)
    ).toBeInTheDocument();
  });
});

describe('a save landing while the question is open', () => {
  it('keeps what was typed, and saves against the revision it was opened at', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'Someone else changed this question.'));
    const { rerender } = render(<QuestionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: Q1.text }));
    await user.type(screen.getByLabelText('Question'), ' Still?');

    // The row's slider saved meanwhile, and the page refreshed with its revision.
    const slid = { ...Q1, weight: 60, revision: 4 };
    rerender(<QuestionsPanel initialView={{ ...VIEW, set: { ...SET, questions: [slid, Q2] } }} />);

    expect(screen.getByLabelText('Question')).toHaveValue(`${Q1.text} Still?`);
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    // Its draft still says weight 100: against the old revision it conflicts,
    // rather than silently undoing the slider's 60.
    expect(sent().body).toMatchObject({ revision: 3, weight: 100 });
    expect(await screen.findByText('Someone else changed this question.')).toBeInTheDocument();
    expect(screen.getByLabelText('Question')).toHaveValue(`${Q1.text} Still?`);
  });
});

describe('a question without a hint or a branch', () => {
  async function openQ1(user: ReturnType<typeof userEvent.setup>) {
    render(<QuestionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: Q1.text }));
  }

  it('saves reworded text and a new hint, with no follow-up', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['text'] }));
    await openQ1(user);

    const text = screen.getByLabelText('Question');
    await user.clear(text);
    await user.type(text, 'What matters to you today?');
    const hint = screen.getByLabelText('Hint');
    await user.clear(hint);
    await user.type(hint, 'No rush.');

    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(sent().url).toBe(contentItemEndpoint('questions', 'question', 'q1'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      revision: 3,
      text: 'What matters to you today?',
      inputType: 'long_text',
      hint: 'No rush.',
      conditionalFollowUp: null,
      weight: 100,
    });
    expect(await screen.findByText('Saved question 1.')).toBeInTheDocument();
  });

  it('sends the weight as a number when it is changed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['weight'] }));
    await openQ1(user);

    const weight = screen.getByLabelText('Weight');
    expect(weight).toHaveValue(100);
    await user.clear(weight);
    await user.type(weight, '60');
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(sent().body).toMatchObject({ weight: 60 });
  });

  it('sends a cleared weight as null, so the route refuses it rather than saving 0', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    await openQ1(user);

    await user.clear(screen.getByLabelText('Weight'));
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(sent().body).toMatchObject({ weight: null });
  });

  it('warns, rather than reporting a plain save, when the data slots did not update', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({ changed: ['text'], slotSync: { status: 'failed', message: 'boom' } })
    );
    await openQ1(user);

    await user.type(screen.getByLabelText('Question'), ' Still?');
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(await screen.findByText(/Open any question and save it to retry/)).toBeInTheDocument();
    expect(screen.queryByText('Saved question 1.')).toBeNull();
  });

  it('sends null hint when the field is cleared', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['hint'] }));
    await openQ1(user);

    await user.clear(screen.getByLabelText('Hint'));
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(sent().body).toMatchObject({ hint: null });
  });

  it('turning on the yes/no switch reveals the follow-up fields and sends them', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['conditionalFollowUp'] }));
    await openQ1(user);

    expect(screen.queryByLabelText('If yes')).toBeNull();
    await user.click(screen.getByLabelText('Follows up differently on yes and no'));
    const ifYes = screen.getByLabelText('If yes');
    await user.type(ifYes, 'Go deeper.');
    const ifNo = screen.getByLabelText('If no');
    await user.type(ifNo, 'Try a different question.');

    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(sent().body).toMatchObject({
      conditionalFollowUp: { ifYes: 'Go deeper.', ifNo: 'Try a different question.' },
    });
  });

  it('reports a save error on the row', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(400, 'The question text cannot be empty.'));
    await openQ1(user);

    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The question text cannot be empty.'
    );
  });
});

describe('a question that already branches', () => {
  async function openQ2(user: ReturnType<typeof userEvent.setup>) {
    render(<QuestionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: Q2.text }));
  }

  it('shows the follow-up fields already filled', async () => {
    const user = userEvent.setup();
    await openQ2(user);

    expect(screen.getByLabelText('If yes')).toHaveValue('What happened then?');
    expect(screen.getByLabelText('If no')).toHaveValue('What holds you back?');
  });

  it('turning the switch off sends conditionalFollowUp: null, even though the fields keep their text', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['conditionalFollowUp'] }));
    await openQ2(user);

    await user.click(screen.getByLabelText('Follows up differently on yes and no'));
    await user.click(screen.getByRole('button', { name: 'Save question' }));

    expect(sent().body).toMatchObject({ conditionalFollowUp: null });
  });
});

describe('the weight on each row', () => {
  function slider(number: number) {
    return screen.getByRole('slider', { name: `Weight of question ${number}` });
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  }

  it('marks a fully weighted question as Core and shows any other weight on its slider', () => {
    render(<QuestionsPanel initialView={VIEW} />);

    const [first, second] = screen.getAllByRole('listitem');
    expect(within(first).getByText('Core')).toBeInTheDocument();
    expect(within(second).getByText('40')).toBeInTheDocument();
    expect(slider(1)).toHaveAttribute('aria-valuenow', '100');
    expect(slider(2)).toHaveAttribute('aria-valuenow', '40');
  });

  it('saves the new weight once it is let go of, with the question as stored and its revision', async () => {
    const user = setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['weight'], slotSync: { status: 'synced' } }));
    render(<QuestionsPanel initialView={VIEW} />);

    slider(2).focus();
    await user.keyboard('{ArrowRight}');
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual({
      url: contentItemEndpoint('questions', 'question', 'q2'),
      method: 'PUT',
      body: {
        revision: 1,
        text: Q2.text,
        inputType: 'long_text',
        hint: null,
        conditionalFollowUp: Q2.conditionalFollowUp,
        weight: 41,
      },
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
    expect(slider(2)).toHaveFocus();
  });

  it('sends a run of key presses as one save, of the last value', async () => {
    const user = setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['weight'], slotSync: { status: 'synced' } }));
    render(<QuestionsPanel initialView={VIEW} />);

    slider(1).focus();
    await user.keyboard('{ArrowLeft}{ArrowLeft}{ArrowLeft}');
    await vi.advanceTimersByTimeAsync(600);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent().body).toMatchObject({ revision: 3, weight: 97 });
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('97');
  });

  it('holds a value let go of during a save until the refresh brings the new revision', async () => {
    const user = setup();
    fetchMock
      .mockResolvedValueOnce(ok({ changed: ['weight'], slotSync: { status: 'synced' } }))
      .mockResolvedValueOnce(ok({ changed: ['weight'], slotSync: { status: 'synced' } }));
    const { rerender } = render(<QuestionsPanel initialView={VIEW} />);

    slider(2).focus();
    await user.keyboard('{ArrowRight}');
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Let go again before the page has refreshed: the stored revision is still 1.
    await user.keyboard('{ArrowRight}');
    await vi.advanceTimersByTimeAsync(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(slider(2)).toHaveAttribute('aria-valuenow', '42');

    const saved = { ...Q2, weight: 41, revision: 2 };
    rerender(<QuestionsPanel initialView={{ ...VIEW, set: { ...SET, questions: [Q1, saved] } }} />);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(sent(1).body).toMatchObject({ revision: 2, weight: 42 });
    expect(slider(2)).toHaveAttribute('aria-valuenow', '42');
  });

  it('shows a weight saved elsewhere once the page refreshes', () => {
    const { rerender } = render(<QuestionsPanel initialView={VIEW} />);

    const moved = { ...Q2, weight: 70, revision: 2 };
    rerender(<QuestionsPanel initialView={{ ...VIEW, set: { ...SET, questions: [Q1, moved] } }} />);

    expect(slider(2)).toHaveAttribute('aria-valuenow', '70');
  });

  it('says on the row when the save was refused, shows the stored weight, and re-reads the page', async () => {
    const user = setup();
    fetchMock
      .mockResolvedValueOnce(refused(409, 'Someone else changed this question.'))
      .mockResolvedValueOnce(ok({ changed: ['weight'], slotSync: { status: 'synced' } }));
    const { rerender } = render(<QuestionsPanel initialView={VIEW} />);

    slider(2).focus();
    await user.keyboard('{ArrowLeft}');
    await vi.advanceTimersByTimeAsync(600);

    expect(
      await screen.findByText('Not saved: Someone else changed this question.')
    ).toBeInTheDocument();
    // Not left showing a value that was never stored.
    expect(slider(2)).toHaveAttribute('aria-valuenow', '40');
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);

    // The refresh brings the revision the other edit left, so the next save is not refused again.
    const current = { ...Q2, revision: 2 };
    rerender(
      <QuestionsPanel initialView={{ ...VIEW, set: { ...SET, questions: [Q1, current] } }} />
    );
    await user.keyboard('{ArrowLeft}');
    await vi.advanceTimersByTimeAsync(600);

    expect(sent(1).body).toMatchObject({ revision: 2, weight: 39 });
  });

  it('warns on the page when the weight saved but the data slots did not update', async () => {
    const user = setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['weight'], slotSync: { status: 'failed' } }));
    render(<QuestionsPanel initialView={VIEW} />);

    slider(2).focus();
    await user.keyboard('{ArrowLeft}');
    await vi.advanceTimersByTimeAsync(600);

    expect(
      await screen.findByText(/the data slots the AI files answers under/)
    ).toBeInTheDocument();
  });
});

describe('removing a question', () => {
  it('confirms first, naming the readers, before sending the delete', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ renumbered: 1 }));
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: Q1.text }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(screen.getByText(/Read by/)).toHaveTextContent(`Read by ${READERS[0]}.`);

    await user.click(screen.getByRole('button', { name: 'Remove question 1' }));

    expect(sent().url).toBe(`${contentItemEndpoint('questions', 'question', 'q1')}?revision=3`);
    expect(sent().method).toBe('DELETE');
    expect(
      await screen.findByText('Removed question 1. The questions after it moved up one.')
    ).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('"Keep it" backs out without sending anything', async () => {
    const user = userEvent.setup();
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: Q1.text }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByRole('button', { name: 'Remove question 1' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cannot be confirmed on the last remaining question', async () => {
    const user = userEvent.setup();
    render(<QuestionsPanel initialView={{ ...VIEW, set: { ...SET, questions: [Q1] } }} />);

    await user.click(screen.getByRole('button', { name: Q1.text }));

    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });

  it('reports an error and leaves the question in place', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'The question moved under you.'));
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: Q1.text }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await user.click(screen.getByRole('button', { name: 'Remove question 1' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The question moved under you.');
    // The editor stays open on the refusal, over the question still in the list.
    expect(screen.getByRole('dialog', { name: 'Question 1' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem', { hidden: true })[0]).toHaveTextContent(Q1.text);
  });
});

describe('reordering', () => {
  it('moving the second question up sends the swapped order with each id and revision', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ moved: 2 }));
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Move question 2 up' }));

    expect(sent().url).toBe(contentOrderEndpoint('questions'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      order: [
        { id: 'q2', revision: 1 },
        { id: 'q1', revision: 3 },
      ],
    });
    expect(await screen.findByText('Saved the new order.')).toBeInTheDocument();
  });

  it('disables the up arrow on the first question and the down arrow on the last', () => {
    render(<QuestionsPanel initialView={VIEW} />);

    expect(screen.getByRole('button', { name: 'Move question 1 up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move question 2 down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move question 1 down' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Move question 2 up' })).toBeEnabled();
  });

  it('reports an error from a failed reorder', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(500, 'The order could not be saved.'));
    render(<QuestionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Move question 2 up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The order could not be saved.');
  });
});

describe('adding a question', () => {
  async function openAdd(user: ReturnType<typeof userEvent.setup>) {
    render(<QuestionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add a question' }));
  }

  it('posts the new question, then closes the form and names it in the notice', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ id: 'q3', number: 3 }));
    await openAdd(user);

    const text = screen.getByLabelText('Question');
    await user.type(text, 'What would you change?');
    const hint = screen.getByLabelText('Hint');
    await user.type(hint, 'Be honest.');

    await user.click(screen.getByRole('button', { name: 'Add at the end' }));

    expect(sent().url).toBe(contentEntityEndpoint('questions', 'question'));
    expect(sent().method).toBe('POST');
    expect(sent().body).toEqual({
      text: 'What would you change?',
      inputType: 'long_text',
      hint: 'Be honest.',
      conditionalFollowUp: null,
      weight: 100,
    });
    expect(screen.queryByRole('button', { name: 'Add at the end' })).toBeNull();
    expect(await screen.findByText('Added question 3 (q3).')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('can add a question that already branches', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ id: 'q3', number: 3 }));
    await openAdd(user);

    await user.type(screen.getByLabelText('Question'), 'Has this come up before?');
    await user.click(screen.getByLabelText('Follows up differently on yes and no'));
    await user.type(screen.getByLabelText('If yes'), 'Say more.');
    await user.type(screen.getByLabelText('If no'), 'What stops it?');

    await user.click(screen.getByRole('button', { name: 'Add at the end' }));

    expect(sent().body).toMatchObject({
      conditionalFollowUp: { ifYes: 'Say more.', ifNo: 'What stops it?' },
    });
  });

  it('cancel closes the form without sending anything', async () => {
    const user = userEvent.setup();
    await openAdd(user);

    await user.type(screen.getByLabelText('Question'), 'Draft, never sent.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Question')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the form open and reports the route’s refusal on failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(400, 'A question needs text.'));
    await openAdd(user);

    await user.click(screen.getByRole('button', { name: 'Add at the end' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A question needs text.');
    expect(screen.getByRole('button', { name: 'Add at the end' })).toBeInTheDocument();
  });
});
