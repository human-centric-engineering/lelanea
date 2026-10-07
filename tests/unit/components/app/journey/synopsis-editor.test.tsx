// @vitest-environment happy-dom

/**
 * Changing an account before or after keeping it (f-journey-record t-148):
 * what the editor hands the keep route, and when it refuses to.
 *
 * @see components/app/journey/synopsis-editor.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SynopsisEditor, type SynopsisText } from '@/components/app/journey/synopsis-editor';

const INITIAL: SynopsisText = {
  summary: 'Saying no at work',
  body: 'We talked about the meeting on Tuesday.',
  outcomes: [
    { kind: 'action', text: 'Decline the extra project' },
    { kind: 'tension', text: 'Loyalty to the team' },
  ],
};

function setup(initial: SynopsisText = INITIAL, busy = false) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <SynopsisEditor
      initial={initial}
      busy={busy}
      submitLabel="Keep my version"
      onSubmit={onSubmit}
      onCancel={onCancel}
      notes={<p>the ticks</p>}
    />
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

describe('SynopsisEditor', () => {
  it('submits the text as it was when nothing changed', async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Keep my version' }));
    expect(onSubmit).toHaveBeenCalledWith(INITIAL);
  });

  it('renders the note ticks it is given inside the form', () => {
    setup();
    expect(screen.getByText('the ticks')).toBeTruthy();
  });

  it('submits a changed line, account and outcome kind, trimmed', async () => {
    const { onSubmit, user } = setup();
    const line = screen.getByLabelText('In a line');
    await user.clear(line);
    await user.type(line, '  A different line  ');
    const body = screen.getByLabelText('What happened');
    await user.clear(body);
    await user.type(body, 'My own account.');
    await user.selectOptions(screen.getAllByLabelText('Kind of outcome')[1], 'insight');
    await user.click(screen.getByRole('button', { name: 'Keep my version' }));

    expect(onSubmit).toHaveBeenCalledWith({
      summary: 'A different line',
      body: 'My own account.',
      outcomes: [
        { kind: 'action', text: 'Decline the extra project' },
        { kind: 'insight', text: 'Loyalty to the team' },
      ],
    });
  });

  it('removes an outcome, and adds one that defaults to an insight', async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getAllByRole('button', { name: 'Remove this outcome' })[0]);
    await user.click(screen.getByRole('button', { name: 'Add an outcome' }));
    const texts = screen.getAllByLabelText('Outcome');
    await user.type(texts[1], 'I can say no kindly');
    await user.click(screen.getByRole('button', { name: 'Keep my version' }));

    expect(onSubmit).toHaveBeenCalledWith({
      ...INITIAL,
      outcomes: [
        { kind: 'tension', text: 'Loyalty to the team' },
        { kind: 'insight', text: 'I can say no kindly' },
      ],
    });
  });

  it('drops an outcome left blank rather than sending it', async () => {
    const { onSubmit, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Add an outcome' }));
    await user.click(screen.getByRole('button', { name: 'Keep my version' }));
    const sent = onSubmit.mock.calls[0][0] as SynopsisText;
    expect(sent.outcomes).toHaveLength(2);
    expect(sent.outcomes.every((o) => o.text.length > 0)).toBe(true);
  });

  it('will not submit without a line or an account', async () => {
    const { onSubmit, user } = setup();
    const submit = screen.getByRole('button', { name: 'Keep my version' });
    await user.clear(screen.getByLabelText('In a line'));
    expect(submit).toHaveProperty('disabled', true);
    await user.type(screen.getByLabelText('In a line'), 'Back');
    await user.clear(screen.getByLabelText('What happened'));
    expect(submit).toHaveProperty('disabled', true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disables both buttons while busy, and cancels when asked', async () => {
    const { onCancel } = setup(INITIAL, true);
    expect(screen.getByRole('button', { name: 'Keep my version' })).toHaveProperty(
      'disabled',
      true
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty('disabled', true);

    const second = setup(INITIAL, false);
    await second.user.click(screen.getAllByRole('button', { name: 'Cancel' })[1]);
    expect(second.onCancel).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
