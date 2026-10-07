// @vitest-environment happy-dom

/**
 * What the person writes into their journey themselves (f-journey-record
 * t-148): the words, the optional line, and keeping it from Lelañea.
 *
 * @see components/app/journey/own-entry-form.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { OwnEntryForm } from '@/components/app/journey/own-entry-form';

function setup(initial?: Parameters<typeof OwnEntryForm>[0]['initial']) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <OwnEntryForm
      initial={initial}
      busy={false}
      submitLabel="Keep this entry"
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
  return { onSubmit, onCancel, user: userEvent.setup() };
}

describe('OwnEntryForm', () => {
  it('starts empty and readable by Lelañea, and refuses to keep nothing', () => {
    setup();
    expect(screen.getByLabelText(/In a line/)).toHaveProperty('value', '');
    expect(screen.getByLabelText('Keep this from Lelañea')).toHaveProperty('checked', false);
    expect(screen.getByRole('button', { name: 'Keep this entry' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('sends the words trimmed, with the line and the opt-out as set', async () => {
    const { onSubmit, user } = setup();
    await user.type(screen.getByLabelText(/In a line/), '  After the walk ');
    await user.type(screen.getByLabelText('Your words'), '  I felt lighter.  ');
    await user.click(screen.getByLabelText('Keep this from Lelañea'));
    await user.click(screen.getByRole('button', { name: 'Keep this entry' }));

    expect(onSubmit).toHaveBeenCalledWith({
      summary: 'After the walk',
      body: 'I felt lighter.',
      withheldFromAgent: true,
    });
  });

  it('starts from an entry being edited', async () => {
    const { onSubmit, user } = setup({
      summary: 'Old line',
      body: 'Old words',
      withheldFromAgent: true,
    });
    expect(screen.getByLabelText('Keep this from Lelañea')).toHaveProperty('checked', true);
    await user.click(screen.getByLabelText('Keep this from Lelañea'));
    await user.click(screen.getByRole('button', { name: 'Keep this entry' }));
    expect(onSubmit).toHaveBeenCalledWith({
      summary: 'Old line',
      body: 'Old words',
      withheldFromAgent: false,
    });
  });

  it('cancels without submitting', async () => {
    const { onSubmit, onCancel, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
