'use client';

import { Check } from 'lucide-react';
import { useId } from 'react';

import { FieldHelp } from '@/components/ui/field-help';
import type { JourneyListedNote, JourneyNoteRef } from '@/lib/app/journey-record/entry';

/** A note a synopsis lists, joined with what the notes panel holds now. */
export interface ListedNote {
  ref: JourneyNoteRef;
  detail: JourneyListedNote;
  /**
   * Keeping may still write to it: the note is at the version the session
   * wrote, and the panel would let the person correct it. Anything else keeping
   * leaves alone, so it is shown but cannot be ticked.
   */
  usable: boolean;
}

/**
 * The notes an entry lists, as the page can show them. A note missing from the
 * page's read is one the panel no longer shows (hidden, or removed since), and
 * is left out here too.
 */
export function listedNotes(
  refs: readonly JourneyNoteRef[],
  details: readonly JourneyListedNote[]
): ListedNote[] {
  const bySlug = new Map(details.map((detail) => [detail.slotSlug, detail]));
  return refs.flatMap((ref) => {
    const detail = bySlug.get(ref.slotSlug);
    if (!detail) return [];
    return [{ ref, detail, usable: detail.confirmable && detail.version === ref.version }];
  });
}

/** The key a note is listed under on the page. */
export const noteKey = (ref: JourneyNoteRef): string => `${ref.slotSlug}@${ref.version}`;

/**
 * What the keep route is sent: the listed notes the person has not unticked.
 *
 * The ticks are held as the slugs the person UNticked, not as versioned keys:
 * keeping moves a confirmed note on a version, and a note can drop off the
 * page between reads, so a key that named a version would go stale and a
 * reset would re-tick what the person had unticked. A slug unticked stays
 * unticked for as long as the stop is mounted, whatever moved underneath it.
 */
export function tickedRefs(notes: readonly ListedNote[], unticked: ReadonlySet<string>) {
  return notes
    .filter((note) => note.usable && !unticked.has(note.ref.slotSlug))
    .map((note) => note.ref);
}

function Reading({ note, caveat }: { note: ListedNote; caveat: boolean }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-[13px] text-[var(--color-heading)] capitalize">
        {note.detail.label}
      </span>
      <span className="text-muted-foreground text-[13px] leading-[1.55]">
        {note.detail.reading ?? 'Lelañea kept a summary of this rather than your exact words.'}
        {note.detail.version !== note.ref.version
          ? caveat
            ? ' This note has changed since, so keeping leaves it alone.'
            : ' This note has changed since.'
          : caveat && !note.usable
            ? ' This note can’t be confirmed now, so keeping leaves it alone.'
            : null}
      </span>
    </span>
  );
}

export interface NoteTicksProps {
  notes: ListedNote[];
  /** The slugs the person unticked. Every other usable note is ticked. */
  unticked: ReadonlySet<string>;
  onToggle: (slotSlug: string) => void;
  disabled?: boolean;
}

/**
 * The notes a synopsis lists, as ticked checkboxes. Keeping confirms the ones
 * still ticked; an unticked note is left exactly as it was (owner ruling 2).
 */
export function NoteTicks({ notes, unticked, onToggle, disabled }: NoteTicksProps) {
  const headingId = useId();
  if (notes.length === 0) return null;
  return (
    <fieldset className="mt-4 flex flex-col gap-2" aria-labelledby={headingId}>
      <div className="flex items-center gap-1.5">
        <span id={headingId} className="text-[12.5px] text-[var(--color-heading)]">
          Notes Lelañea made in this session
        </span>
        <FieldHelp title="What keeping does to these notes">
          Keeping this account confirms each note still ticked, as something you agree with. If you
          change the account first, Lelañea reads your version against each ticked note and corrects
          any it now gets wrong. Untick a note to leave it exactly as it is.
        </FieldHelp>
      </div>
      {notes.map((note) => {
        const key = noteKey(note.ref);
        return (
          <label key={key} className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-[3px] size-4 flex-none accent-[var(--color-accent-ink)]"
              checked={note.usable && !unticked.has(note.ref.slotSlug)}
              disabled={disabled || !note.usable}
              onChange={() => onToggle(note.ref.slotSlug)}
            />
            <Reading note={note} caveat />
          </label>
        );
      })}
    </fieldset>
  );
}

/**
 * The notes a kept synopsis lists, read-only.
 *
 * Not headed "confirmed": a keep whose re-read could not run leaves its ticked
 * notes listed but unconfirmed (t-147), and the wire does not tell the two
 * apart. A note that has moved on since says so, rather than showing a newer
 * reading as if it were the one kept.
 */
export function ConfirmedNotes({ notes }: { notes: ListedNote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-2">
      <p className="text-[12.5px] text-[var(--color-heading)]">Notes kept with this account</p>
      <ul className="flex flex-col gap-2">
        {notes.map((note) => (
          <li key={noteKey(note.ref)} className="flex items-start gap-2.5">
            <Check
              size={15}
              strokeWidth={2}
              aria-hidden="true"
              className="mt-[3px] flex-none text-[var(--color-status-green-ink)]"
            />
            <Reading note={note} caveat={false} />
          </li>
        ))}
      </ul>
    </div>
  );
}
