// @vitest-environment happy-dom

/**
 * The notes page's controls, rendered on their own — the cases the panel test's
 * fixture never reaches (f-slots t-79).
 *
 * The panel test proves the controls drive the URL. What it cannot produce is
 * a record with no notes under Lelañea's own headings, or a `group` in the URL
 * that no option offers — a stale link, or one typed by hand. The select must
 * still show what the URL says rather than silently claiming "Every heading".
 *
 * @see components/app/notes/notes-controls.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NotesControls, type NotesControlsProps } from '@/components/app/notes/notes-controls';

function renderControls(overrides: Partial<NotesControlsProps> = {}) {
  const props: NotesControlsProps = {
    draft: '',
    onDraft: vi.fn(),
    group: null,
    onGroup: vi.fn(),
    sort: 'grouped',
    onSort: vi.fn(),
    layout: 'cards',
    onLayout: vi.fn(),
    groups: [
      { key: 'life_areas', title: 'Life areas', count: 3 },
      { key: 'the_person', title: 'The person', count: 2 },
    ],
    own: 0,
    total: 5,
    matched: 5,
    filtering: false,
    onClear: vi.fn(),
    ...overrides,
  };
  render(<NotesControls {...props} />);
  return props;
}

const groupPicker = () =>
  screen.getByRole<HTMLSelectElement>('combobox', { name: /show notes under/i });
const optionLabels = () => [...groupPicker().options].map((option) => option.textContent);

describe('NotesControls', () => {
  it('offers the groups in use with their counts, and no own-headings option when there are none', () => {
    renderControls();

    expect(optionLabels()).toEqual(['Every heading · 5', 'Life areas · 3', 'The person · 2']);
    // The count is the whole record, not "of": nothing is narrowing.
    expect(screen.getByText('5 notes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('shows a group the URL names but no option offers, as chosen, with nothing in it', () => {
    renderControls({ group: 'development' });

    expect(groupPicker().value).toBe('development');
    expect(optionLabels().at(-1)).toBe('Development · 0');
  });

  it('shows Lelañea’s own headings as chosen when the URL asks and none exist', () => {
    renderControls({ group: '_own' });

    expect(groupPicker().value).toBe('_own');
    expect(optionLabels().at(-1)).toBe('Lelañea’s own headings · 0');
  });

  it('hands back null for "Every heading", and a sort it recognises', async () => {
    const props = renderControls({ group: 'life_areas', filtering: true, matched: 3 });

    await userEvent.selectOptions(groupPicker(), '');
    expect(props.onGroup).toHaveBeenCalledWith(null);

    await userEvent.selectOptions(screen.getByRole('combobox', { name: /order/i }), 'recent');
    expect(props.onSort).toHaveBeenCalledWith('recent');

    expect(screen.getByText('3 of 5 notes')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('says "1 note", not "1 notes"', () => {
    renderControls({
      total: 1,
      matched: 1,
      groups: [{ key: 'life_areas', title: 'Life areas', count: 1 }],
    });
    expect(screen.getByText('1 note')).toBeTruthy();
  });
});
