// @vitest-environment happy-dom

/**
 * One note's card, driven directly — the removal flow the panel test does not
 * reach (f-slots t-78).
 *
 * `notes-panel.test.tsx` exercises `NoteCard` through the real panel for the
 * correction flow and the shapes a search response can take; these tests drive
 * the card in isolation the way `note-row.test.tsx` drives the row, so the
 * confirm-then-remove exchange and the placeholder a removed note leaves are
 * each one short test rather than a detour through the panel's conversation
 * pane and fake server.
 *
 * @see components/app/notes/note-card.tsx
 * @see lib/app/slots/notes-client.ts
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  NoteCard,
  noteTag,
  EXCHANGE_CONFIRM,
  EXCHANGE_OFFER,
  REMOVE_CONFIRM,
  REMOVE_CONFIRM_CONVERSATION,
  REMOVE_CONFIRM_EXCHANGE,
  REMOVED_POINTER,
  removeConfirm,
  removedWords,
} from '@/components/app/notes/note-card';
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

/** A `fetch` that answers exactly this, whatever it is asked. */
function answering(body: unknown, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), init));
}

describe('removing a note', () => {
  it('offers "Remove this note" on a removable note, and asks before doing anything', async () => {
    const fetchImpl = answering({ success: true, data: { versions: 1 } });
    render(
      <NoteCard note={note()} onAsk={() => {}} onCorrected={() => {}} fetchImpl={fetchImpl} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove this note' }));

    expect(screen.getByText(removeConfirm(note()))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
    // Asking is not acting: nothing has been sent yet.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('closes the confirmation on "Keep it" without calling fetch', async () => {
    const fetchImpl = answering({ success: true, data: { versions: 1 } });
    render(
      <NoteCard note={note()} onAsk={() => {}} onCorrected={() => {}} fetchImpl={fetchImpl} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove this note' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(screen.queryByText(removeConfirm(note()))).toBeNull();
    // The control to ask again is back, in place of the confirmation.
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends a DELETE with the slug on "Remove it", and calls onRemoved', async () => {
    const fetchImpl = answering({ success: true, data: { versions: 3 } });
    const onRemoved = vi.fn();
    const onCorrected = vi.fn();
    render(
      <NoteCard
        note={note({ slotSlug: 'life_money' })}
        onAsk={() => {}}
        onCorrected={onCorrected}
        onRemoved={onRemoved}
        fetchImpl={fetchImpl}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove this note' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));

    await waitFor(() => expect(onRemoved).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('/api/v1/app/notes');
    expect(init?.method).toBe('DELETE');
    expect(JSON.parse(init?.body as string)).toEqual({ slotSlug: 'life_money' });
    // The correction callback is NOT also called when a dedicated one is given.
    expect(onCorrected).not.toHaveBeenCalled();
  });

  it('falls back to onCorrected when onRemoved is not given', async () => {
    const fetchImpl = answering({ success: true, data: { versions: 1 } });
    const onCorrected = vi.fn();
    render(
      <NoteCard note={note()} onAsk={() => {}} onCorrected={onCorrected} fetchImpl={fetchImpl} />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove this note' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));

    await waitFor(() => expect(onCorrected).toHaveBeenCalledTimes(1));
  });

  it('shows the route’s own refusal message under "Not removed.", and does not call onRemoved', async () => {
    const fetchImpl = answering(
      { success: false, error: { code: 'NOT_FOUND', message: 'There is nothing left to remove.' } },
      { status: 404 }
    );
    const onRemoved = vi.fn();
    render(
      <NoteCard
        note={note()}
        onAsk={() => {}}
        onCorrected={() => {}}
        onRemoved={onRemoved}
        fetchImpl={fetchImpl}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove this note' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove it' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Not removed.');
    expect(alert.textContent).toContain('There is nothing left to remove.');
    expect(onRemoved).not.toHaveBeenCalled();
    // The confirmation is still open, so a person can try again or back out.
    expect(screen.getByRole('button', { name: 'Remove it' })).toBeTruthy();
  });

  it('offers no remove control on a note that cannot be removed', () => {
    render(<NoteCard note={note({ removable: false })} onAsk={() => {}} onCorrected={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Remove this note' })).toBeNull();
  });
});

describe('a note that was removed', () => {
  it('shows the placeholder and the AI’s pointer, and no buttons, aside or reading, even if the fixture still carries them', () => {
    render(
      <NoteCard
        note={note({
          removed: true,
          capturedAt: '2026-09-22T10:00:00.000Z',
          // Deliberately still carrying the kind of content a removed row's
          // other fields COULD hold, so the assertions below prove the card
          // suppresses it rather than merely never having had it to show.
          value: 'Work is going badly.',
          reasoningNote: 'Said plainly.',
          asking: 'How work stands for this person right now.',
          confidence: 8,
          sourceType: 'direct',
        })}
        onAsk={() => {}}
        onCorrected={() => {}}
      />
    );

    expect(screen.getByText(removedWords('2026-09-22T10:00:00.000Z'))).toBeTruthy();
    expect(screen.getByText(REMOVED_POINTER)).toBeTruthy();

    // No controls at all: nothing left to correct, ask about or remove.
    expect(screen.queryByRole('button', { name: /not right/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /ask lela.*about this/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove this note' })).toBeNull();

    // No certainty aside: a removed note has nothing left to be certain about.
    expect(screen.queryByText(/Confident|Fairly sure|Not certain|Only a guess/)).toBeNull();
    expect(screen.queryByText(/of 10/)).toBeNull();

    // None of the value or reasoning text the fixture still carries.
    expect(screen.queryByText('Work is going badly.')).toBeNull();
    expect(screen.queryByText('Said plainly.')).toBeNull();
    expect(screen.queryByText(/What Lelañea was looking for/)).toBeNull();
  });
});

describe('a note whose earlier version was removed', () => {
  it('says the version before it was removed, and does not print its value', () => {
    render(
      <NoteCard
        note={note({
          version: 2,
          value: 'Work is going fine now.',
          previous: {
            version: 1,
            // Deliberately non-empty, even though the route always writes the
            // removed placeholder's value empty: this proves the card is
            // branching on `removed`, not merely rendering whatever `value`
            // happens to hold.
            value: 'Work was going badly.',
            withheld: false,
            removed: true,
            sourceType: 'removed_by_person',
            confidence: 1,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        })}
        onAsk={() => {}}
        onCorrected={() => {}}
      />
    );

    expect(screen.getByText('A note you removed. Nothing of it is kept.')).toBeTruthy();
    expect(screen.queryByText('Work was going badly.')).toBeNull();
    // "Kept, not replaced" is false of a removed version, and the line above
    // would contradict it (`/code-review`, t-78).
    expect(screen.queryByText(/Kept, not replaced/)).toBeNull();
  });

  it('still says a superseded reading was kept, when it was', () => {
    render(
      <NoteCard
        note={note({
          version: 2,
          previous: {
            version: 1,
            value: 'Work was going badly.',
            withheld: false,
            removed: false,
            sourceType: 'inferred',
            confidence: 5,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        })}
        onAsk={() => {}}
        onCorrected={() => {}}
      />
    );

    expect(screen.getByText(/Kept, not replaced/)).toBeTruthy();
  });
});

describe('the tag on a removed note', () => {
  it('names a heading Lelañea made up as a removed note, not by its random slug', () => {
    expect(
      noteTag(note({ removed: true, slotSlug: 'removed_3f2a9c0d1e4b4f6a8b7c6d5e4f3a2b1c' }))
    ).toBe('removed note');
  });

  it('leaves a live heading that merely starts the same way alone', () => {
    expect(noteTag(note({ removed: false, slotSlug: 'removed_from_my_job' }))).toBe(
      'removed from my job'
    );
  });

  it('keeps a taxonomy heading, which is an admin’s wording', () => {
    expect(noteTag(note({ removed: true, slotSlug: 'life_work' }))).toBe('life work');
  });
});

describe('what the removal says about the conversation (t-127)', () => {
  it('says the exchange can go next where one is on record', () => {
    expect(removeConfirm(note({ exchanges: ['t1'] }))).toBe(
      `${REMOVE_CONFIRM} ${REMOVE_CONFIRM_EXCHANGE}`
    );
  });

  it('says the conversation is untouched where the note came from talking but no exchange is on record', () => {
    expect(removeConfirm(note({ exchanges: [], conversationId: 'c1' }))).toBe(
      `${REMOVE_CONFIRM} ${REMOVE_CONFIRM_CONVERSATION}`
    );
  });

  it('says nothing about a conversation for a note none wrote', () => {
    expect(removeConfirm(note({ exchanges: [], conversationId: null }))).toBe(REMOVE_CONFIRM);
  });
});

describe('a removed note with a reading still kept under it (t-127)', () => {
  const placeholderOver = (removable: boolean) =>
    note({
      removed: true,
      removable,
      correctable: false,
      value: '',
      reasoningNote: '',
      conversationId: null,
      exchanges: [],
    });

  it('offers to remove what is still kept, and asks before doing anything', async () => {
    const fetchImpl = answering({ success: true, data: { versions: 2 } });
    render(
      <NoteCard
        note={placeholderOver(true)}
        onAsk={() => {}}
        onCorrected={() => {}}
        fetchImpl={fetchImpl}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Remove what is still kept' }));

    expect(screen.getByRole('button', { name: 'Remove it' })).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('offers nothing to remove once every version is a placeholder', () => {
    render(<NoteCard note={placeholderOver(false)} onAsk={() => {}} onCorrected={() => {}} />);

    expect(screen.queryByRole('button', { name: 'Remove what is still kept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove this note' })).toBeNull();
  });
});

describe('deleting the exchange a removed note came from (t-127)', () => {
  const removedNote = (overrides: Partial<Note> = {}) =>
    note({
      removed: true,
      removable: false,
      correctable: false,
      value: '',
      reasoningNote: '',
      conversationId: null,
      exchanges: ['cmturna000000000000000000', 'cmturnb000000000000000000'],
      ...overrides,
    });

  it('offers it, and asks before doing anything', async () => {
    const fetchImpl = answering({ success: true, data: { exchanges: 2, messages: 5 } });
    render(
      <NoteCard
        note={removedNote()}
        onAsk={() => {}}
        onCorrected={() => {}}
        fetchImpl={fetchImpl}
      />
    );

    expect(screen.getByText(EXCHANGE_OFFER)).toBeTruthy();
    await userEvent.click(
      screen.getByRole('button', { name: 'Delete that part of the conversation' })
    );

    expect(screen.getByText(EXCHANGE_CONFIRM)).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByText(EXCHANGE_CONFIRM)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends every exchange the note came from in one DELETE, and calls onRemoved', async () => {
    const fetchImpl = answering({ success: true, data: { exchanges: 2, messages: 5 } });
    const onRemoved = vi.fn();
    render(
      <NoteCard
        note={removedNote()}
        onAsk={() => {}}
        onCorrected={() => {}}
        onRemoved={onRemoved}
        fetchImpl={fetchImpl}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete that part of the conversation' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/v1/app/exchanges');
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({
      exchangeIds: ['cmturna000000000000000000', 'cmturnb000000000000000000'],
    });
    expect(onRemoved).toHaveBeenCalledTimes(1);
  });

  it('prints the route’s own refusal and keeps the confirmation open', async () => {
    const fetchImpl = answering(
      {
        success: false,
        error: {
          code: 'CONFLICT',
          message:
            'Lelañea is still answering that. Try again in a moment, once the reply has finished.',
          details: { reason: 'still_answering' },
        },
      },
      { status: 409 }
    );
    const onRemoved = vi.fn();
    render(
      <NoteCard
        note={removedNote()}
        onAsk={() => {}}
        onCorrected={() => {}}
        onRemoved={onRemoved}
        fetchImpl={fetchImpl}
      />
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Delete that part of the conversation' })
    );
    await userEvent.click(screen.getByRole('button', { name: 'Delete it' }));

    expect(await screen.findByText(/still answering that/)).toBeTruthy();
    expect(screen.getByText('Not deleted.')).toBeTruthy();
    expect(screen.getByText(EXCHANGE_CONFIRM)).toBeTruthy();
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('offers nothing for a removed note no exchange wrote', () => {
    render(
      <NoteCard note={removedNote({ exchanges: [] })} onAsk={() => {}} onCorrected={() => {}} />
    );

    expect(screen.queryByText(EXCHANGE_OFFER)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Delete that part of the conversation' })
    ).toBeNull();
  });

  it('still shows a live reading kept behind a placeholder head, and never a removed one', () => {
    const { rerender } = render(
      <NoteCard
        note={removedNote({
          version: 2,
          previous: {
            version: 1,
            value: 'Work is steady.',
            withheld: false,
            removed: false,
            sourceType: 'direct',
            confidence: 7,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        })}
        onAsk={() => {}}
        onCorrected={() => {}}
      />
    );
    expect(screen.getByText('Work is steady.')).toBeTruthy();
    expect(screen.getByText('Before this')).toBeTruthy();

    rerender(
      <NoteCard
        note={removedNote({
          version: 2,
          previous: {
            version: 1,
            value: '',
            withheld: false,
            removed: true,
            sourceType: 'removed_by_person',
            confidence: 1,
            capturedAt: '2026-09-20T09:15:00.000Z',
          },
        })}
        onAsk={() => {}}
        onCorrected={() => {}}
      />
    );
    expect(screen.queryByText('Before this')).toBeNull();
  });
});
