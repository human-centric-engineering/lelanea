'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  confidenceWords,
  formatWhen,
  noteTag,
  WITHHELD_WORDS,
} from '@/components/app/notes/note-card';
import type { Note } from '@/lib/app/slots/notes-view';
import { cn } from '@/lib/utils';

/**
 * One note as a line in a list — for reading across many, where the card is
 * for working with one (f-slots t-79).
 *
 * ## The full reading, one line of details, and no buttons (owner ruling)
 *
 * The reading is never truncated: a list that clipped what Lelañea wrote would
 * make the reader open every row to find out what it said, which is the card's
 * cost without the card. The details line is the three facts a reader scans
 * by — which heading (when the page is sorted by recency, where no section says
 * so), the tag, how sure, and when. How it was known is left to the card.
 *
 * **The whole row is the control**, and it opens the full card in place, so
 * correcting a note and "Ask Lelañea about this" stay one click away. A row
 * with its own buttons would be a small card, and the page would then have two
 * places to do each thing.
 *
 * A chevron in the corner says so, pointing down; the open card carries the
 * same chevron pointing up, which folds it back — in both views, not only the
 * list (owner ruling, 21 September 2026: a "Back to the list" button read as
 * navigation). `aria-expanded` rather than a link: nothing is navigated to,
 * and focus follows the note into whichever shape it takes.
 */
export interface NoteRowProps {
  note: Note;
  /** The heading it is filed under, when no section above says so. */
  heading?: string;
  onOpen: () => void;
  /** Take focus when drawn — set when this row's card has just been folded. */
  focusOnMount?: boolean;
}

export function NoteRow({ note, heading, onOpen, focusOnMount }: NoteRowProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusOnMount) ref.current?.focus();
  }, [focusOnMount]);

  const details = [
    heading,
    noteTag(note),
    note.retired ? 'no longer asked about' : null,
    `${confidenceWords(note.confidence)} · ${note.confidence} of 10`,
    formatWhen(note.capturedAt),
  ].filter(Boolean);

  return (
    <button
      ref={ref}
      type="button"
      aria-expanded={false}
      onClick={onOpen}
      className={cn(
        'bg-card relative block w-full rounded-lg border border-[var(--color-card-border)] py-3 pr-12 pl-4 text-left',
        'shadow-[var(--shadow-rest)] transition-colors duration-200 ease-[var(--ease-brand)]',
        'hover:bg-[var(--color-pill-hover)]',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
        'focus-visible:outline-[var(--color-ring)]'
      )}
    >
      <span
        className={cn(
          'block text-[14.5px] leading-[1.6] whitespace-pre-line',
          note.withheld ? 'text-muted-foreground' : 'text-[var(--color-heading)]'
        )}
      >
        {note.withheld ? WITHHELD_WORDS : note.value}
      </span>
      <span className="text-muted-foreground mt-1 block text-[12px] leading-[1.5]">
        {details.join(' · ')}
      </span>
      <ChevronDown
        size={16}
        strokeWidth={1.8}
        aria-hidden="true"
        className="text-muted-foreground absolute top-5.5 right-5.5"
      />
    </button>
  );
}
