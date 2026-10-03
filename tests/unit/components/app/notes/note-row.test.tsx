// @vitest-environment happy-dom

/**
 * A note as a list row — what it says about the notes the panel test's
 * fixtures never produce: a withheld reading, a retired slot (f-slots t-79).
 *
 * The panel test drives rows through the real panel; these are the row's own
 * branches, rendered directly.
 *
 * @see components/app/notes/note-row.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { WITHHELD_WORDS } from '@/components/app/notes/note-card';
import { NoteRow } from '@/components/app/notes/note-row';
import type { Note } from '@/lib/app/slots/notes-view';

function note(overrides: Partial<Note> = {}): Note {
  return {
    slotSlug: 'life_work',
    asking: 'How work stands for this person right now.',
    value: 'Work is going badly.',
    withheld: false,
    removed: false,
    confidence: 8,
    sourceType: 'direct',
    reasoningNote: 'Said plainly.',
    version: 1,
    capturedAt: '2026-09-21T09:15:00.000Z',
    conversationId: 'c1',
    sensitivity: 'standard',
    retired: false,
    correctable: true,
    removable: true,
    exchanges: [],
    previous: null,
    group: 'life_areas',
    ...overrides,
  };
}

describe('NoteRow', () => {
  it('shows the full reading and one line of details, and opens on a click', async () => {
    const onOpen = vi.fn();
    render(<NoteRow note={note()} onOpen={onOpen} />);

    const row = screen.getByRole('button', { expanded: false });
    expect(row.textContent).toContain('Work is going badly.');
    expect(row.textContent).toContain('life work · Confident · 8 of 10 · 21 September');
    // No heading unless the page is sorted by recency.
    expect(row.textContent).not.toContain('Life areas');

    await userEvent.click(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('says what a withheld note is, never printing the sentinel', () => {
    render(
      <NoteRow
        note={note({ value: '<redacted: special_category>', withheld: true })}
        onOpen={() => {}}
      />
    );

    expect(screen.getByText(WITHHELD_WORDS)).toBeTruthy();
    expect(screen.queryByText(/redacted/)).toBeNull();
    // No pointer to "How Lelañea came to this": a row has no such fold.
    expect(screen.queryByText(/came to this/)).toBeNull();
  });

  it('labels a retired slot and carries the heading it was given', () => {
    render(<NoteRow note={note({ retired: true })} heading="Life areas" onOpen={() => {}} />);

    expect(screen.getByRole('button').textContent).toContain(
      'Life areas · life work · no longer asked about'
    );
  });

  it('takes focus when drawn as the fold of a card that was just closed', () => {
    render(<NoteRow note={note()} onOpen={() => {}} focusOnMount />);
    expect(document.activeElement).toBe(screen.getByRole('button'));
  });

  it('shows the removal placeholder instead of the value, and drops the certainty from its details (t-78)', () => {
    render(
      <NoteRow
        note={note({
          removed: true,
          capturedAt: '2026-09-22T10:00:00.000Z',
          // Still carrying a value and a confidence, as the row's own props —
          // a regression that stopped branching on `removed` would otherwise
          // print these rather than suppressing them.
          value: 'Work is going badly.',
          confidence: 8,
        })}
        heading="Life areas"
        onOpen={() => {}}
      />
    );

    const row = screen.getByRole('button', { expanded: false });
    expect(row.textContent).toContain('You removed this note on 22 September');
    expect(row.textContent).not.toContain('Work is going badly.');
    // The details line keeps the heading and the tag, but none of the
    // certainty words or the "of 10" score — there is nothing left to be
    // certain about.
    expect(row.textContent).toContain('Life areas · life work');
    expect(row.textContent).not.toMatch(/Confident|Fairly sure|Not certain|Only a guess/);
    expect(row.textContent).not.toMatch(/of 10/);
  });
});
