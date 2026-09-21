'use client';

import { useState } from 'react';

import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Card } from '@/components/app/ui/card';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { correctNote, NotesRefused } from '@/lib/app/slots/notes-client';
import { noteSourceWords, type Note } from '@/lib/app/slots/notes-view';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/**
 * One of her notes, with the two things a person can do about it (t-73).
 *
 * ## Everything on the card is a claim she is making, and it says so
 *
 * §3.19: *"this is what you said, this is when, this is what I concluded and
 * how confident I am."* So a card carries, in order: what she was looking for,
 * what she concluded, how she came to it, how sure she is, and when — and then
 * the previous version where there is one. Nothing here is presented as the
 * person's own words unless `sourceType` says it was.
 *
 * ## A contradiction is a door, not an error (§3.12)
 *
 * The version before this one is shown **beside** it, in a quiet inset with an
 * invitation to take it up with her. Not a warning, not a tone, not a banner:
 * the app has no opinion about whether someone changed their mind, and dressing
 * a second reading as a problem would teach people that changing is a fault.
 *
 * ## Correcting, and the one note that cannot be corrected
 *
 * `correctable` is the server's answer and this component does not second-guess
 * it — a retired slot (she is no longer asking) and an Art. 9 slot (the words
 * were never stored, so there is nothing to correct and a correction would put
 * them at rest) both come back false, with the route refusing the same two
 * cases if anything reached it anyway. **Ask her about this is offered on every
 * card**, including those, because it is the door that still works: `HB10` —
 * the guard ships with its remedy.
 */
export interface NoteCardProps {
  note: Note;
  /** Hand a question to the composer and bring the conversation forward. */
  onAsk: (text: string) => void;
  /** A correction landed; the panel re-reads the page. */
  onCorrected: () => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * The stored 1–10 in words, with the number kept beside it.
 *
 * Both halves on purpose. The words are what a person actually reads; the
 * number is what she stored, and hiding it would make the panel a paraphrase of
 * the record rather than a view of it — which is the thing §3.19 is about.
 */
export function confidenceWords(confidence: number): string {
  if (confidence >= 9) return 'she is as sure as she gets';
  if (confidence >= 7) return 'she is fairly sure';
  if (confidence >= 4) return 'she is not certain';
  return 'she is guessing';
}

/**
 * An exact date and time, not "3 days ago".
 *
 * §3.19 asks for *when*, and a relative phrase answers a different question —
 * it also goes stale on screen without re-rendering, and a note written during
 * the turn you are watching would read "just now" for the rest of the session.
 * `en-GB` is named rather than left to the runtime, as `account/page.tsx` does:
 * this component only ever renders in the browser, but the rule is worth
 * keeping in one shape.
 */
export function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'at an unrecorded time';
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at);
}

/** Long enough to be recognisable in the composer, short enough not to fill the box. */
const ASK_EXCERPT = 300;

function excerpt(text: string): string {
  return text.length <= ASK_EXCERPT ? text : `${text.slice(0, ASK_EXCERPT).trimEnd()}…`;
}

/**
 * The words handed to the composer, written as the person's opening rather than
 * as a command — they are about to send it, and it has to sound like them.
 *
 * A withheld note quotes the **question** instead of the value, because the
 * value is a sentinel: quoting it back would put `<redacted: special_category>`
 * in someone's own message.
 */
export function askText(note: Note): string {
  if (note.withheld) {
    const about = note.asking ? ` — “${excerpt(note.asking)}”` : '';
    return `There is something you noted about me but kept no record of${about}. Can we talk about that?`;
  }
  return `You wrote down: “${excerpt(note.value)}”. Can we talk about that?`;
}

/** The muted line under a value: how she knows, how sure, and when. */
function Meta({ note }: { note: Note }) {
  return (
    <p className="text-muted-foreground mt-2.5 text-[12.5px] leading-[1.6]">
      {noteSourceWords(note.sourceType)} · {confidenceWords(note.confidence)} ({note.confidence} of
      10) · {formatWhen(note.capturedAt)}
    </p>
  );
}

export function NoteCard({ note, onAsk, onCorrected, fetchImpl }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.value);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const save = async () => {
    const value = draft.trim();
    if (!value || saving) return;
    setSaving(true);
    setRefusal(null);
    try {
      await correctNote({ slotSlug: note.slotSlug, value }, { fetchImpl });
      setEditing(false);
      onCorrected();
    } catch (error: unknown) {
      // The route's own message, shown as it was written: both 409s name their
      // remedy, and a generic "could not save" would throw that away.
      setRefusal(
        error instanceof NotesRefused
          ? error.message
          : 'That could not be saved just now. Try again in a moment.'
      );
      logger.warn('A note correction was refused', {
        code: error instanceof NotesRefused ? error.code : 'unknown',
      });
    } finally {
      setSaving(false);
    }
  };

  // No `aria-label` on the card. `Card` is a plain `<div>`, and an `aria-label`
  // on an element with no role is ignored by assistive technology — a label
  // nobody hears is worse than none, because it reads in source as if the card
  // announces itself. The panel renders each card in a list item under a group
  // heading, which is what places it.
  return (
    <Card className="p-[22px]" eyebrow={note.retired ? 'no longer asked about' : undefined}>
      {note.asking ? (
        <p className="text-muted-foreground mb-2 text-[12.5px] leading-[1.6]">{note.asking}</p>
      ) : null}

      {note.withheld ? (
        /*
          The stored value is a sentinel, so the card says what actually
          happened instead of printing it. This is the classification doing its
          job — `.context/app/slots.md`, "Capture" — and reading it as a failure
          is the misunderstanding this sentence exists to prevent.
        */
        <p className="text-[15px] leading-[1.6] text-[var(--color-heading)]">
          She noticed something here and deliberately kept no record of what you said. Health,
          feeling and belief are left out of the written record.
        </p>
      ) : (
        <p className="text-[15px] leading-[1.6] whitespace-pre-line text-[var(--color-heading)]">
          {note.value}
        </p>
      )}

      <Meta note={note} />

      <details className="mt-3">
        <summary
          className={cn(
            'text-muted-foreground cursor-pointer text-[12.5px] select-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          How she came to this
        </summary>
        <p className="text-muted-foreground mt-2 text-[13px] leading-[1.6]">{note.reasoningNote}</p>
        {note.conversationId ? (
          /*
            The id is not shown and is not a link. There is no member-facing
            route that opens one exchange yet — the journey view is still a
            placeholder — and a link to nowhere, or a cuid printed as evidence,
            would both be worse than saying plainly that it came from talking.
            When the journey lands, this line is where it becomes a link.
          */
          <p className="text-muted-foreground mt-1.5 text-[13px] leading-[1.6]">
            Drawn from something you said in conversation.
          </p>
        ) : null}
      </details>

      {note.previous ? (
        <div
          className={cn('mt-3.5 rounded-md border-l-2 border-[var(--color-divider)] py-1 pl-3.5')}
        >
          <Eyebrow as="p" className="block">
            before this
          </Eyebrow>
          <p className="text-muted-foreground mt-1 text-[13.5px] leading-[1.6] whitespace-pre-line">
            {note.previous.withheld ? 'Something she kept no record of.' : note.previous.value}
          </p>
          <p className="text-muted-foreground mt-1.5 text-[12.5px]">
            {noteSourceWords(note.previous.sourceType)} · {formatWhen(note.previous.capturedAt)} ·
            kept, not replaced
          </p>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-4">
          <label className="sr-only" htmlFor={`correct-${note.slotSlug}`}>
            Your correction
          </label>
          <textarea
            id={`correct-${note.slotSlug}`}
            value={draft}
            rows={3}
            onChange={(event) => setDraft(event.currentTarget.value)}
            className={cn(
              'text-foreground block w-full resize-y rounded-md border p-3 text-[14px]',
              'border-[var(--color-border)] bg-[var(--color-popover)] leading-[1.6] outline-none',
              'focus-visible:border-[var(--color-secondary)]'
            )}
          />
          <p className="text-muted-foreground mt-2 text-[12.5px] leading-[1.6]">
            What she wrote is kept either way — your words go in beside hers as the current reading,
            and hers stays underneath.
          </p>
          {refusal ? (
            <Banner tone="error" className="mt-2.5" lead="Not saved.">
              {refusal}
            </Banner>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={saving || draft.trim().length === 0}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save this instead'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setRefusal(null);
                setDraft(note.value);
              }}
            >
              Leave it
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5 flex flex-wrap gap-2">
          {note.correctable ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                // From the note as it stands NOW, not from whatever this card
                // held when it mounted. A correction re-reads the page, so the
                // prop changes underneath while this state does not — without
                // this, a second edit would open on the superseded value.
                setDraft(note.value);
                setEditing(true);
              }}
            >
              That’s not right
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => onAsk(askText(note))}>
            Ask her about this
          </Button>
        </div>
      )}
    </Card>
  );
}
