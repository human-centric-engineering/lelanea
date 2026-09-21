'use client';

import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';

import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Card } from '@/components/app/ui/card';
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
  /**
   * The heading it is filed under, shown before the tag. Set when the page is
   * sorted by recency, where there is no group section above the card to say so.
   */
  heading?: string;
  /**
   * Set when the card was opened from a list row (t-79): a third control that
   * folds it back into the row it came from.
   */
  onFold?: () => void;
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
 * ## The top band says "Confident", and never more than that
 *
 * It said "As certain as it gets", which the owner read as arrogant, and it
 * was: the scale's ceiling is her own judgement, not a fact, and a phrase that
 * closes the question invites nobody to correct it. Every rung is now a claim
 * she could be wrong about — *Confident · Fairly sure · Not certain · Only a
 * guess* — which is the register the rest of the panel is in and the posture
 * §3.12 asks for. Owner ruling, 21 September 2026.
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
  high: { words: 'Confident', bar: 'var(--color-status-green)' },
  fair: { words: 'Fairly sure', bar: 'var(--color-status-yellow)' },
  low: { words: 'Not certain', bar: 'var(--color-status-purple)' },
  guess: { words: 'Only a guess', bar: 'var(--color-muted-foreground)' },
} as const;

export type CertaintyBand = keyof typeof CERTAINTY;

/**
 * The stored 1–10 to one of four bands. Out-of-range values clamp rather than
 * throw.
 *
 * ## The thresholds are hers, not the panel's
 *
 * They follow the bands her instructions tell her to WRITE in
 * (`VOICE_AGENT_SYSTEM_INSTRUCTIONS`; `.context/app/voice.md`): **8–10** when a
 * person said it plainly about themselves, **5–7** when they clearly meant it
 * without saying it outright, **1–4** when she inferred it. The first cut here
 * was 9 / 7 / 4, chosen without reading those — so a plainly-stated 8 showed as
 * "Fairly sure" in amber, and the panel undersold exactly the readings a person
 * had been most direct about. Found by `/pre-pr`'s docs-against-code step.
 *
 * The display is one band FINER than the capture at the bottom, and that is
 * deliberate: her "inferred" band splits into *Not certain* (3–4) and *Only a
 * guess* (1–2), because a 1 and a 4 are different amounts of evidence and the
 * owner asked for colour that tells them apart. The top two bands map one to
 * one, which is the part that has to agree.
 */
export function certaintyBand(confidence: number): CertaintyBand {
  if (confidence >= 8) return 'high';
  if (confidence >= 5) return 'fair';
  if (confidence >= 3) return 'low';
  return 'guess';
}

/**
 * Ten notches, the first `confidence` of them filled — a measure, not a meter.
 *
 * Notches rather than a continuous bar because the value is an integer out of
 * ten and a smooth fill implies a precision the scale does not have. She stored
 * "6", not "63%".
 *
 * **It sits directly above the words it measures**, in the aside. It used to
 * float between the reading and the meta line, a row of coloured dashes with
 * its own sentence three lines away — the owner's note, and correct: a measure
 * separated from its statement is decoration, because nothing on screen says
 * what it is measuring.
 */
function CertaintyBar({ confidence }: { confidence: number }) {
  const filled = Math.max(0, Math.min(10, Math.round(confidence)));
  const { bar } = CERTAINTY[certaintyBand(confidence)];
  return (
    <span aria-hidden="true" className="flex items-center gap-[3px]">
      {Array.from({ length: 10 }, (_, notch) => (
        <span
          key={notch}
          className="h-[3px] flex-1 rounded-full"
          style={{ backgroundColor: notch < filled ? bar : 'var(--color-divider)' }}
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

/**
 * What a withheld note says instead of its sentinel. Exported because the list
 * row says the same thing, and two copies of it would drift.
 */
export const WITHHELD_WORDS =
  'Lelañea noticed something here and deliberately kept no record of what you said. Health, feeling and belief are left out of the written record.';

/** The slug as the card's tag — `life_work` → `life work`. The list row shows the same. */
export function noteTag(note: Note): string {
  return note.slotSlug.replace(/_/g, ' ');
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

/**
 * The right-hand column: how certain, how known, and when.
 *
 * ## Why these three left the reading's own column
 *
 * They were one muted sentence running the full width of the card under the
 * note — *"Lelañea inferred it · Not certain (6 of 10) · 21 September at
 * 13:23"* — which is three unrelated facts joined by interpuncts because there
 * was nowhere else to put them, and it pushed every card's real content into a
 * measure that ran right across the surface. The owner's note; the fix is the
 * obvious one, and it buys the reading a proper measure at the same time.
 *
 * Stacked rather than tabulated: each fact is a different kind of thing, and a
 * two-column definition list here would imply a schema the reader does not
 * need. The certainty is the one with weight, because it is the one that
 * decides how much of the note to believe.
 */
function Aside({ note }: { note: Note }) {
  return (
    <aside
      className={cn(
        'flex flex-col gap-3 text-[12px] leading-[1.5]',
        // The rule only exists when there is a column to separate. Below the
        // container breakpoint the aside sits under the reading, where a left
        // border would be a stray vertical line.
        '@min-[32rem]:border-l @min-[32rem]:border-[var(--color-divider)] @min-[32rem]:pl-6'
      )}
    >
      <div className="flex flex-col gap-1.5">
        <CertaintyBar confidence={note.confidence} />
        <p className="text-[var(--color-heading)]">
          <span className="font-medium">{confidenceWords(note.confidence)}</span>
          <span className="text-muted-foreground"> · {note.confidence} of 10</span>
        </p>
      </div>
      <p className="text-muted-foreground">{noteSourceWords(note.sourceType)}</p>
      <p className="text-muted-foreground">{formatWhen(note.capturedAt)}</p>
    </aside>
  );
}

/**
 * One folded panel on a card — the shape both disclosures share.
 *
 * ## One component, because two of them side by side have to agree
 *
 * The card carries two things that are *about* the note rather than part of
 * it: how Lelañea came to the reading, and what she had written before it.
 * They were built differently — one a bordered box, the other a washed inset
 * with a coloured edge, open always — and stacked they read as two unrelated
 * kinds of object at two different widths. The owner's note, and it was the
 * visible half of a layout mistake: the measure was on each child rather than
 * on the column they share, so each block sized itself to its own content.
 *
 * `tone` is the only thing that differs now. The history panel keeps its
 * purple left edge, because it is the one saying something was superseded and
 * that is worth being able to spot at a glance; everything else about the two
 * is identical.
 *
 * ## The summary carries the answer when it is shut
 *
 * A fold that says only "before this" makes a reader open it to find out
 * whether it is worth opening. So the head carries the previous reading's
 * provenance — who said it and when — and the body carries the words. That is
 * the owner's ask, and it is also what makes folding it honest: nothing is
 * hidden that a reader needs in order to decide.
 *
 * The marker is ours: `list-none` kills the native triangle, which sits on the
 * text baseline and cannot be positioned.
 */
function Disclosure({
  summary,
  tone,
  children,
}: {
  summary: React.ReactNode;
  /** A left edge in the palette's reflective hue, for the history panel. */
  tone?: 'history';
  children: React.ReactNode;
}) {
  return (
    <details
      className={cn(
        'group overflow-hidden rounded-lg border border-[var(--color-card-border)]',
        'bg-[var(--color-pill)] shadow-[var(--shadow-rest)]',
        // Short of the reading, and the SAME short as the other fold.
        //
        // Both of these are secondary to the note above them, and running them
        // to the column's full width made them read as more of it. Stopping
        // them early is the hierarchy said in geometry rather than in type
        // size — but only while they agree with each other: two panels at two
        // different widths is the ragged edge this card has already been
        // through once, and the measure is therefore here, on the one
        // component both of them are.
        'max-w-[27rem]',
        tone === 'history' && 'border-l-2 border-l-[var(--color-status-purple)]'
      )}
    >
      <summary
        className={cn(
          'text-muted-foreground flex cursor-pointer list-none items-center gap-2',
          'px-3.5 py-2.5 text-[12.5px] leading-[1.45] select-none',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]'
        )}
      >
        <ChevronRight
          size={13}
          strokeWidth={1.8}
          aria-hidden="true"
          className={cn(
            'mt-[3px] flex-none self-start transition-transform duration-200',
            'ease-[var(--ease-brand)] group-open:rotate-90 motion-reduce:transition-none'
          )}
        />
        <span className="min-w-0">{summary}</span>
      </summary>
      <div
        className={cn(
          'text-muted-foreground flex flex-col gap-2 border-t px-3.5 py-3',
          'border-[var(--color-divider)] text-[13px] leading-[1.6]'
        )}
      >
        {children}
      </div>
    </details>
  );
}

export function NoteCard({ note, onAsk, onCorrected, fetchImpl, heading, onFold }: NoteCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.value);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Not `correct-${slotSlug}`. A slug she coins can be any string `fill_slot`
  // accepts — spaces included — and an id with a space in it silently breaks
  // the label's `htmlFor`, leaving the box unnamed to a screen reader.
  const correctionId = useId();

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
  const tag = noteTag(note);
  const eyebrow = [heading, tag, note.retired ? 'no longer asked about' : null]
    .filter(Boolean)
    .join(' · ');

  // No `aria-label` on the card. `Card` is a plain `<div>`, and an `aria-label`
  // on an element with no role is ignored by assistive technology — a label
  // nobody hears is worse than none, because it reads in source as if the card
  // announces itself. The panel renders each card in a list item under a group
  // heading, which is what places it.
  /**
   * How many readings stand behind this one.
   *
   * `version` is monotonic per `(userId, slotSlug)` from 1 and the engine never
   * deletes, so the count is arithmetic — no second query, and no API field.
   *
   * **The owner asked what happens when there are several, and the answer is
   * that one is shown and the rest are counted.** §3.12 asks for the previous
   * answer beside the new one as an invitation to revisit, not for a changelog:
   * a card that unrolled six readings would bury the current one, which is the
   * thing the page is for. Saying how many there are is what stops "before
   * this" reading as though there had only ever been two — and what would make
   * a full history worth building, when somebody asks for it.
   */
  const earlier = Math.max(0, note.version - 1);
  const older = earlier - (note.previous ? 1 : 0);

  return (
    <Card className="@container p-[22px]" eyebrow={eyebrow}>
      {/*
        The container query is the point, and it is the repo's first.
        This card's width is set by the workspace pane — which a reader drags,
        and which the conversation overlays at `medium` — so a viewport
        breakpoint would split the columns on a 1400px window while the pane
        itself was 320px wide. `@container` asks the only question that matters:
        is THIS card wide enough for two columns.
      */}
      <div className="grid gap-x-8 gap-y-4 @min-[32rem]:grid-cols-[minmax(0,1fr)_11rem]">
        {/*
          No measure of its own, and that is deliberate now.

          The ragged right edges this column was built to fix came from putting
          `max-w` on the READING while the panels under it filled the track. The
          fix was to constrain one thing rather than three — but constraining it
          HERE, inside a card that stretches to the pane, only moved the problem:
          the block sat at 46ch with the aside pinned 400px away at the far
          right. The cap belongs on the card, and `notes-panel.tsx` carries it;
          this column takes what the grid gives it and every block in it ends on
          the same edge, which was the point.
        */}
        <div className="flex min-w-0 flex-col gap-3">
          {note.withheld ? (
            /*
              The stored value is a sentinel, so the card says what actually
              happened instead of printing it. This is the classification doing
              its job — `.context/app/slots.md`, "Capture" — and reading it as a
              failure is the misunderstanding this sentence exists to prevent.

              It carries the info wash for that reason: it is the one card that
              says something about the RECORD rather than about the person. The
              hue is `Banner`'s `info` pairing — wash and edge from the same
              trio, measured there — and the words on it stay `--color-heading`,
              which is darker than the ink that pairing normally uses.
            */
            <p
              className={cn(
                // `pr-3.5` and not just `pl-3.5`: the left edge is a rule and
                // the right one is the box's own, so the text ran flush into it
                // and the last word of every line sat on the corner.
                'rounded-md border-l-2 py-2 pr-3.5 pl-3.5 text-[15px] leading-[1.6]',
                'border-[var(--color-status-blue)] bg-[var(--color-status-blue-bg)]',
                'text-[var(--color-heading)]'
              )}
            >
              {WITHHELD_WORDS}
            </p>
          ) : (
            <p
              className={cn(
                'text-[15.5px] leading-[1.65] whitespace-pre-line',
                'text-[var(--color-heading)]'
              )}
            >
              {note.value}
            </p>
          )}

          {note.previous ? (
            /*
              Folded, and quieter than it was. It was an always-open washed
              inset that competed with the reading above it for attention —
              which gets the emphasis backwards, because the current reading is
              what the page is for and this is the door beside it (§3.12).

              The head carries the previous reading's provenance so a reader can
              decide whether to open it without opening it, and the count of
              anything older rides there too rather than inside.
            */
            <Disclosure
              tone="history"
              summary={
                <>
                  <span className="text-[var(--color-heading)]">Before this</span>
                  {' · '}
                  {noteSourceWords(note.previous.sourceType)},{' '}
                  {formatWhen(note.previous.capturedAt)}
                  {older > 0
                    ? ` · ${older === 1 ? '1 older reading' : `${older} older readings`} as well`
                    : ''}
                </>
              }
            >
              <p className="whitespace-pre-line text-[var(--color-heading)]">
                {note.previous.withheld
                  ? 'Something Lelañea kept no record of.'
                  : note.previous.value}
              </p>
              <p>
                Kept, not replaced.
                {older > 0
                  ? ` The ${older === 1 ? 'reading' : 'readings'} before that ${older === 1 ? 'is' : 'are'} kept too, and not shown here.`
                  : ''}
              </p>
            </Disclosure>
          ) : null}

          <Disclosure summary="How Lelañea came to this">
            <p>{note.reasoningNote}</p>
            {note.asking ? (
              /*
                Her wording, quoted. Third person inside the quotation marks is
                the taxonomy speaking to a model, which is what it is — the
                panel is not addressing the reader as "this person".
              */
              <p>
                <span className="text-[var(--color-heading)]">What Lelañea was looking for: </span>“
                {note.asking}”
              </p>
            ) : null}
            {note.conversationId ? (
              /*
                The id is not shown and is not a link. There is no member-facing
                route that opens one exchange yet — the journey view is still a
                placeholder — and a link to nowhere, or a cuid printed as
                evidence, would both be worse than saying plainly that it came
                from talking. When the journey lands, this is the line that
                becomes a link.
              */
              <p>Drawn from something you said in conversation.</p>
            ) : null}
          </Disclosure>
        </div>

        <Aside note={note} />
      </div>

      {editing ? (
        <div className="mt-4">
          <label className="sr-only" htmlFor={correctionId}>
            Your correction
          </label>
          <textarea
            id={correctionId}
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
          {onFold ? (
            <Button size="sm" variant="ghost" className={PILL} onClick={onFold}>
              Back to the list
            </Button>
          ) : null}
        </div>
      )}
    </Card>
  );
}
