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
 * cases if anything reached it anyway. **Ask Lelañea about this is offered on every
 * card**, including those, because it is the door that still works: `HB10` —
 * the guard ships with its remedy.
 */

/**
 * An OUTLINED pill, because a bare one did not read as a control.
 *
 * `Button variant="ghost"` carries no fill and no edge at rest, so on the
 * card's own ground the two controls looked like two run-on labels under the
 * note — the owner's first correction, from a screenshot. The design's
 * `.btn.btn-sm.btn-ghost` is outlined, and `workspace.tsx`'s "Return to the
 * conversation" is the same shape for the same reason: an affordance a reader
 * has to guess at is not one.
 *
 * The border is added here rather than in `components/app/ui/button.tsx`,
 * deliberately. `ghost` is shared, and giving every ghost button in the app an
 * edge is a change to surfaces this task never looked at — a fill-less variant
 * is the right thing inside a toolbar or beside a filled primary, which is
 * where the other call sites use it. Two low-commitment actions standing alone
 * on a card is the case that needs the edge.
 */
const PILL = 'border border-[var(--color-border)]';
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
 * number is what was stored, and hiding it would make the panel a paraphrase of
 * the record rather than a view of it — which is the thing §3.19 is about.
 *
 * Adjectival rather than a clause: the meta line already opens with who made
 * the reading, so "Lelañea inferred it · Lelañea is not certain" says her name
 * twice in nine words. A capitalised fragment reads as the second of three
 * facts, which is what it is.
 */
export function confidenceWords(confidence: number): string {
  return CERTAINTY[certaintyBand(confidence)].words;
}

/**
 * Four bands, each with the hue it is read in — the palette's own functional
 * colours, never a new one (§6.2 names five and the page uses three of them).
 *
 * ## The hue carries the band; it never carries the meaning alone
 *
 * WCAG 1.4.1. The same fact is in the words beside the bar and in the number
 * beside those, so a reader who cannot tell the green from the amber loses
 * nothing — the colour is the thing that makes the page scannable, not the
 * thing that makes it legible. The bar is `aria-hidden` for the same reason:
 * it repeats what the sentence next to it already says, and announcing "meter,
 * 6 of 10" after "Not certain (6 of 10)" is noise.
 *
 * ## Why these four hues, in this order
 *
 * Green → amber → purple → grey, deliberately **not** green → amber → red. Red
 * in this palette is the destructive/error hue, and a low reading is not an
 * error: §3.12 says an uncertain note is worth having precisely so it can be
 * come back to, and painting it in the colour the app uses for things that have
 * gone wrong teaches the opposite. Purple is the palette's reflective hue (it
 * carries Settings' tone) and grey says "barely there" without saying "bad".
 *
 * The bar is a SURFACE, so it takes the raw hue; the words beside it stay
 * `--color-muted-foreground`, because a raw status hue cannot carry 12px type
 * on this ground — that is `shell.md`'s rule and the reason `TIER_INKS` exists.
 * The wash behind the bar is the matching `-bg` token, which is what makes the
 * unfilled part of it visible at all.
 */
const CERTAINTY = {
  high: { words: 'As certain as it gets', bar: 'var(--color-status-green)' },
  fair: { words: 'Fairly sure', bar: 'var(--color-status-yellow)' },
  low: { words: 'Not certain', bar: 'var(--color-status-purple)' },
  guess: { words: 'Guessing', bar: 'var(--color-muted-foreground)' },
} as const;

export type CertaintyBand = keyof typeof CERTAINTY;

/** The stored 1–10 to one of four bands. Out-of-range values clamp rather than throw. */
export function certaintyBand(confidence: number): CertaintyBand {
  if (confidence >= 9) return 'high';
  if (confidence >= 7) return 'fair';
  if (confidence >= 4) return 'low';
  return 'guess';
}

/**
 * Ten notches, the first `confidence` of them filled — a measure, not a meter.
 *
 * Notches rather than a continuous bar because the value is an integer out of
 * ten and a smooth fill implies a precision the scale does not have. She stored
 * "6", not "63%".
 */
function CertaintyBar({ confidence }: { confidence: number }) {
  const filled = Math.max(0, Math.min(10, Math.round(confidence)));
  const { bar } = CERTAINTY[certaintyBand(confidence)];
  return (
    <span aria-hidden="true" className="mt-2.5 flex items-center gap-[3px]">
      {Array.from({ length: 10 }, (_, notch) => (
        <span
          key={notch}
          className="h-[3px] w-[9px] rounded-full"
          style={{
            backgroundColor: notch < filled ? bar : 'var(--color-divider)',
          }}
        />
      ))}
    </span>
  );
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
 * A withheld note quotes **nothing**, because the value is a sentinel and the
 * question is the taxonomy's third-person wording: one would put
 * `<redacted: special_category>` in someone's own message and the other would
 * put "this person" in it. She has the conversation and knows what she asked.
 */
export function askText(note: Note): string {
  if (note.withheld) {
    return 'There is something you noted about me but kept no record of. Can we talk about that?';
  }
  return `You wrote down: “${excerpt(note.value)}”. Can we talk about that?`;
}

/** The certainty measure, and the muted line under it: how she knows, how sure, when. */
function Meta({ note }: { note: Note }) {
  return (
    <>
      <CertaintyBar confidence={note.confidence} />
      <p className="text-muted-foreground mt-1.5 text-[12.5px] leading-[1.6]">
        {noteSourceWords(note.sourceType)} · {confidenceWords(note.confidence)} ({note.confidence}{' '}
        of 10) · {formatWhen(note.capturedAt)}
      </p>
    </>
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

  /*
   * The slug as a tag, in the eyebrow's lower-case tracked register.
   *
   * The taxonomy's `description` used to sit here, and it is written for a
   * MODEL: "how their body, energy and sleep stands for this person right now".
   * On a panel read by the person it is about, that is the app calling them
   * "they" — the owner's second correction. It has moved into the disclosure as
   * a quotation of her wording, where being third-person is honest rather than
   * jarring, and its place is taken by the slug, which is short, neutral and
   * already the thing the note is filed under.
   */
  const tag = note.slotSlug.replace(/_/g, ' ');

  // No `aria-label` on the card. `Card` is a plain `<div>`, and an `aria-label`
  // on an element with no role is ignored by assistive technology — a label
  // nobody hears is worse than none, because it reads in source as if the card
  // announces itself. The panel renders each card in a list item under a group
  // heading, which is what places it.
  return (
    <Card className="p-[22px]" eyebrow={note.retired ? `${tag} · no longer asked about` : tag}>
      {note.withheld ? (
        /*
          The stored value is a sentinel, so the card says what actually
          happened instead of printing it. This is the classification doing its
          job — `.context/app/slots.md`, "Capture" — and reading it as a failure
          is the misunderstanding this sentence exists to prevent.

          It carries the info wash for that reason: it is the one card that says
          something about the RECORD rather than about the person, and reading
          as a statement rather than as a reading is the whole point of it. The
          hue is `Banner`'s `info` pairing — wash and edge from the same trio,
          measured there — and the words on it stay `--color-heading`, which is
          darker than the ink that pairing normally uses.
        */
        <p
          className={cn(
            'rounded-md border-l-2 py-2 pl-3.5 text-[15px] leading-[1.6]',
            'border-[var(--color-status-blue)] bg-[var(--color-status-blue-bg)]',
            'text-[var(--color-heading)]'
          )}
        >
          Lelañea noticed something here and deliberately kept no record of what you said. Health,
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
          How Lelañea came to this
        </summary>
        <p className="text-muted-foreground mt-2 text-[13px] leading-[1.6]">{note.reasoningNote}</p>
        {note.asking ? (
          /*
            Her wording, quoted. Third person inside the quotation marks is the
            taxonomy speaking to a model, which is what it is — the panel is not
            addressing the reader as "this person".
          */
          <p className="text-muted-foreground mt-1.5 text-[13px] leading-[1.6]">
            What Lelañea was looking for: “{note.asking}”
          </p>
        ) : null}
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
        /*
          The reflective hue, and NOT the red one. A superseded reading is not a
          mistake that was corrected — §3.12 says a contradiction is a door —
          and the palette's red is what this app uses for things that have gone
          wrong. Purple carries Settings' tone for the same reason: it marks
          something to sit with. Left edge only, so the inset reads as an aside
          rather than as a second card.
        */
        <div
          className={cn(
            'mt-3.5 rounded-md border-l-2 py-1.5 pl-3.5',
            'border-[var(--color-status-purple)] bg-[var(--color-status-purple-bg)]'
          )}
        >
          <Eyebrow as="p" className="block">
            before this
          </Eyebrow>
          <p className="text-muted-foreground mt-1 text-[13.5px] leading-[1.6] whitespace-pre-line">
            {note.previous.withheld ? 'Something Lelañea kept no record of.' : note.previous.value}
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
            What Lelañea wrote is kept either way — your words go in beside it as the current
            reading, and Lelañea’s stays underneath.
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
              className={PILL}
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
              className={PILL}
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
          <Button size="sm" variant="ghost" className={PILL} onClick={() => onAsk(askText(note))}>
            Ask Lelañea about this
          </Button>
        </div>
      )}
    </Card>
  );
}
