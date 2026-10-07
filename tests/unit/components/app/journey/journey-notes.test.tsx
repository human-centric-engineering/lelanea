// @vitest-environment happy-dom

/**
 * The notes a synopsis lists, joined with what the notes panel holds now, and
 * ticked (f-journey-record t-148; owner ruling 2, carried from t-147).
 *
 * @see components/app/journey/journey-notes.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  ConfirmedNotes,
  NoteTicks,
  listedNotes,
  noteKey,
  tickedRefs,
  type ListedNote,
} from '@/components/app/journey/journey-notes';
import type { JourneyListedNote, JourneyNoteRef } from '@/lib/app/journey-record/entry';

function detail(overrides: Partial<JourneyListedNote> = {}): JourneyListedNote {
  return {
    slotSlug: 'life_work',
    label: 'life work',
    reading: 'Work is going badly.',
    version: 1,
    confirmable: true,
    ...overrides,
  };
}

function ref(overrides: Partial<JourneyNoteRef> = {}): JourneyNoteRef {
  return { slotSlug: 'life_work', version: 1, ...overrides };
}

describe('noteKey', () => {
  it('joins the slug and the version the session wrote it at', () => {
    expect(noteKey(ref({ slotSlug: 'life_money', version: 3 }))).toBe('life_money@3');
  });
});

describe('listedNotes', () => {
  it('joins a listed ref with the panel’s current detail for it', () => {
    const notes = listedNotes([ref()], [detail()]);

    expect(notes).toEqual([{ ref: ref(), detail: detail(), usable: true }]);
  });

  it('leaves out a ref the panel no longer shows at all — hidden, or removed since', () => {
    const notes = listedNotes(
      [ref({ slotSlug: 'life_work' }), ref({ slotSlug: 'life_money', version: 2 })],
      [detail({ slotSlug: 'life_money', version: 2 })]
    );

    expect(notes).toEqual([
      {
        ref: ref({ slotSlug: 'life_money', version: 2 }),
        detail: detail({ slotSlug: 'life_money', version: 2 }),
        usable: true,
      },
    ]);
  });

  it('marks a note unusable when the panel’s version has moved on since the session wrote it', () => {
    const notes = listedNotes(
      [ref({ version: 1 })],
      [detail({ version: 2 })] // corrected since the session listed it
    );

    expect(notes).toEqual([
      { ref: ref({ version: 1 }), detail: detail({ version: 2 }), usable: false },
    ]);
  });

  it('marks a note unusable when the panel says it cannot be confirmed', () => {
    const notes = listedNotes([ref()], [detail({ confirmable: false })]);

    expect(notes[0]?.usable).toBe(false);
  });
});

describe('tickedRefs', () => {
  const usable: ListedNote = {
    ref: ref({ slotSlug: 'life_work' }),
    detail: detail({ slotSlug: 'life_work' }),
    usable: true,
  };
  const other: ListedNote = {
    ref: ref({ slotSlug: 'life_money', version: 2 }),
    detail: detail({ slotSlug: 'life_money', version: 2 }),
    usable: true,
  };
  const unusable: ListedNote = {
    ref: ref({ slotSlug: 'life_health', version: 1 }),
    detail: detail({ slotSlug: 'life_health', version: 3 }),
    usable: false,
  };

  it('sends every usable note the person has not unticked', () => {
    expect(tickedRefs([usable, other, unusable], new Set([other.ref.slotSlug]))).toEqual([
      usable.ref,
    ]);
  });

  it('never sends an unusable note, though nothing unticked it', () => {
    expect(tickedRefs([unusable], new Set())).toEqual([]);
  });

  it('sends nothing when every note is unticked', () => {
    expect(tickedRefs([usable, other], new Set([usable.ref.slotSlug, other.ref.slotSlug]))).toEqual(
      []
    );
  });

  it('holds an untick by slug, so it survives the note moving on a version', () => {
    const movedOn: ListedNote = {
      ref: ref({ slotSlug: 'life_money', version: 3 }),
      detail: detail({ slotSlug: 'life_money', version: 3 }),
      usable: true,
    };
    expect(tickedRefs([usable, movedOn], new Set(['life_money']))).toEqual([usable.ref]);
  });
});

describe('NoteTicks', () => {
  const usable: ListedNote = {
    ref: ref({ slotSlug: 'life_work' }),
    detail: detail({ slotSlug: 'life_work', label: 'life work' }),
    usable: true,
  };
  const stale: ListedNote = {
    ref: ref({ slotSlug: 'life_money', version: 1 }),
    detail: detail({ slotSlug: 'life_money', label: 'life money', version: 2 }),
    usable: false,
  };

  it('renders nothing at all when there is nothing to tick', () => {
    const { container } = render(<NoteTicks notes={[]} unticked={new Set()} onToggle={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('checks a usable ticked note, and leaves an unusable one unchecked and disabled', () => {
    render(<NoteTicks notes={[usable, stale]} unticked={new Set()} onToggle={vi.fn()} />);

    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0]?.checked).toBe(true);
    expect(boxes[0]?.disabled).toBe(false);
    expect(boxes[1]?.checked).toBe(false);
    expect(boxes[1]?.disabled).toBe(true);
    // The stale one says why it cannot be confirmed, so a person is not left
    // wondering why the box will not take a click.
    expect(screen.getByText(/This note has changed since/)).toBeTruthy();
  });

  it('shows an unticked note unchecked, and calls onToggle with its slug', async () => {
    const onToggle = vi.fn();
    render(
      <NoteTicks notes={[usable]} unticked={new Set([usable.ref.slotSlug])} onToggle={onToggle} />
    );
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);

    await userEvent.click(screen.getByRole('checkbox'));

    expect(onToggle).toHaveBeenCalledWith('life_work');
  });

  it('disables every box when the whole fieldset is disabled, whatever is ticked', () => {
    render(<NoteTicks notes={[usable]} unticked={new Set()} onToggle={vi.fn()} disabled />);

    expect(screen.getByRole<HTMLInputElement>('checkbox').disabled).toBe(true);
  });
});

describe('ConfirmedNotes', () => {
  it('renders nothing when there is nothing confirmed', () => {
    const { container } = render(<ConfirmedNotes notes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the confirmed notes read-only, with no checkbox at all', () => {
    render(
      <ConfirmedNotes
        notes={[
          {
            ref: ref({ slotSlug: 'life_work' }),
            detail: detail({ slotSlug: 'life_work', reading: 'Work is going badly.' }),
            usable: true,
          },
        ]}
      />
    );

    expect(screen.getByText('Work is going badly.')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
