'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Card } from '@/components/app/ui/card';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import {
  correctNote,
  deleteExchanges,
  NotesRefused,
  removeNote,
} from '@/lib/app/slots/notes-client';
import { noteSourceWords, type Note, type NoteHistory } from '@/lib/app/slots/notes-view';
import { REMOVED_SLUG_PREFIX } from '@/lib/app/slots/removed';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/**
 * One of Lelañea's notes, with the two things a person can do about it (t-73).
 *
 * ## Everything on the card is a claim the agent is making, and it says so
 *
 * §3.19: *"this is what you said, this is when, this is what I concluded and
 * how confident I am."* So a card carries, in order: what the agent was looking
 * for, what it concluded, how it came to it, how sure it is, and when — and then
 * the previous version where there is one. Nothing here is presented as the
 * person's own words unless `sourceType` says it was.
 *
 * ## A contradiction is a door, not an error (§3.12)
 *
 * The version before this one is shown **beside** it, in a quiet inset with an
 * invitation to take it up with the agent. Not a warning, not a tone, not a banner:
 * the app has no opinion about whether someone changed their mind, and dressing
 * a second reading as a problem would teach people that changing is a fault.
 *
 * ## Correcting, and the one note that cannot be corrected
 *
 * `correctable` is the server's answer and this component does not second-guess
 * it — a retired slot (the agent is no longer asking) and an Art. 9 slot (the reading
 * was never stored, so there is nothing to correct and a correction would put
 * it at rest) both come back false, with the route refusing the same two
 * cases if anything reached it anyway. **Ask Lelañea about this is offered on every
 * card**, including those, because it is the door that still works: `HB10` —
 * the guard ships with its remedy.
 *
 * ## Removing, and what a removed note leaves (t-78)
 *
 * "Remove this note" is offered on every note the person can see, and asks
 * once, in place, before it acts — a removal cannot be undone, and the second
 * step says what it does and does not touch. A removed note stays on the page
 * as a placeholder that says when it was removed and never what it said: the
 * owner's ruling (3 Oct 2026), and the same promise the AI is held to.
 *
 * ## Deleting the exchange a note came from (t-127)
 *
 * Removing a note does not touch the conversation. Where the note's exchanges
 * are on record, the placeholder offers to delete them too, and asks once
 * before it acts (owner ruling 4). A note no exchange wrote, such as an
 * onboarding answer or a correction, offers nothing.
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
  /** A removal landed; the panel re-reads the page. Falls back to `onCorrected`. */
  onRemoved?: () => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
  /**
   * The heading it is filed under, shown before the tag. Set when the page is
   * sorted by recency, where there is no group section above the card to say so.
   */
  heading?: string;
  /**
   * Fold the card to its one-line row (t-79). Drawn as a chevron in the card's
   * top corner — the same chevron, pointing the other way, is what opens a row.
   */
  onFold?: () => void;
  /** Take focus on the chevron when drawn — set when the row was just opened. */
  focusFold?: boolean;
}

/**
 * The stored 1–10 in words, with the number kept beside it.
 *
 * Both halves on purpose. The words are what a person actually reads; the
 * number is what was stored, and hiding it would make the panel a paraphrase of
 * the record rather than a view of it — which is the thing §3.19 is about.
 *
 * Adjectival rather than a clause: the meta line already opens with who made
 * the reading, so "Lelañea inferred it · Lelañea is not certain" says the name
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
 * was: the scale's ceiling is the agent's own judgement, not a fact, and a phrase that
 * closes the question invites nobody to correct it. Every rung is now a claim
 * the agent could be wrong about — *Confident · Fairly sure · Not certain · Only a
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
 * ## The thresholds are the capture's, not the panel's
 *
 * They follow the bands the agent's instructions tell it to WRITE in
 * (`VOICE_AGENT_SYSTEM_INSTRUCTIONS`; `.context/app/voice.md`): **8–10** when a
 * person said it plainly about themselves, **5–7** when they clearly meant it
 * without saying it outright, **1–4** when the agent inferred it. The first cut here
 * was 9 / 7 / 4, chosen without reading those — so a plainly-stated 8 showed as
 * "Fairly sure" in amber, and the panel undersold exactly the readings a person
 * had been most direct about. Found by `/pre-pr`'s docs-against-code step.
 *
 * The display is one band FINER than the capture at the bottom, and that is
 * deliberate: the capture's "inferred" band splits into *Not certain* (3–4) and *Only a
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
 * ten and a smooth fill implies a precision the scale does not have. The agent
 * stored "6", not "63%".
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
 *
 * ## A summary was kept, and it says so (t-80)
 *
 * It used to say Lelañea "kept no record of what you said", which was untrue:
 * masking at capture covers the reading only, and the reasoning note is stored
 * as written — a paraphrase of what was said. The owner's ruling was to show
 * that paraphrase rather than hide it, so this line points at it instead of
 * denying it exists.
 */
export const WITHHELD_WORDS = 'Lelañea kept a summary of this rather than your exact words.';

/**
 * Where that summary is — the card only. The list row shows {@link WITHHELD_WORDS}
 * alone, because the fold this names exists only once the card is open.
 */
export const WITHHELD_POINTER = 'It is under “How Lelañea came to this”.';

/**
 * What a removed note says in place of itself — `when` is the moment it was
 * removed. Exported because the list row says the same thing.
 */
export function removedWords(when: string): string {
  return `You removed this note on ${formatWhen(when)}.`;
}

/**
 * The second line on a removed note: what the AI knows now. It is the marker
 * `lib/app/slots/removed.ts` writes, in the reader's terms.
 */
export const REMOVED_POINTER = 'Lelañea knows a note was removed here, but not what it said.';

/**
 * What the confirmation says before anything happens. It names the one thing a
 * removal does not reach — the conversation — because a person who wanted
 * something gone should not find it still quoted there and think the removal
 * failed. Where an exchange wrote the note, it says that part can go next
 * (t-127); see {@link removeConfirm}.
 */
export const REMOVE_CONFIRM =
  'This removes the note and every earlier version of it. Lelañea will know a note was removed here, but not what it said.';

/** Said after {@link REMOVE_CONFIRM} when the note came from talking, but no exchange is on record. */
export const REMOVE_CONFIRM_CONVERSATION = 'The conversation it came from is not changed.';

/** Said after {@link REMOVE_CONFIRM} when the note's exchanges are on record and can be deleted next. */
export const REMOVE_CONFIRM_EXCHANGE =
  'The conversation it came from is not changed, but you can delete that part of it next.';

/** The whole confirmation for this note. */
export function removeConfirm(note: Pick<Note, 'exchanges' | 'conversationId'>): string {
  if (note.exchanges.length > 0) return `${REMOVE_CONFIRM} ${REMOVE_CONFIRM_EXCHANGE}`;
  if (note.conversationId) return `${REMOVE_CONFIRM} ${REMOVE_CONFIRM_CONVERSATION}`;
  return REMOVE_CONFIRM;
}

/**
 * On a removed note whose exchanges are still on record: what is left, and the
 * offer to delete it (owner ruling 4, 3 Oct 2026). The person decides; nothing
 * is deleted until they confirm.
 */
export const EXCHANGE_OFFER =
  'What you said that this note came from is still in your conversation with Lelañea.';

/** What deleting the exchange does, said before it happens. */
export const EXCHANGE_CONFIRM =
  'This deletes what you said there and Lelañea’s replies, from the conversation and from everything Lelañea keeps. Anything else Lelañea noted from those words is removed too. This can’t be undone.';

/** The slug as the card's tag — `life_work` → `life work`. The list row shows the same. */
export function noteTag(note: Note): string {
  // A removed note whose heading Lelañea made up was moved to an opaque slug
  // (`delete-note.ts`), and the random part of it means nothing to anyone.
  // Both, not the prefix alone: `removed_` is not reserved, so a live heading
  // like `removed_from_my_job` keeps its own words (`/code-review` round 2).
  if (note.removed && note.slotSlug.startsWith(REMOVED_SLUG_PREFIX)) return 'removed note';
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
 * put "this person" in it. The agent has the conversation and knows what it asked.
 */
export function askText(note: Note): string {
  if (note.withheld) {
    return 'There is something you noted about me without keeping my exact words. Can we talk about that?';
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
 * it: how Lelañea came to the reading, and what had been written before it.
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
 *
 * ## "How Lelañea came to this" is plain text, not a panel (t-79)
 *
 * `plain` drops the lozenge: the summary is a line of muted text with its
 * chevron, and opening it shows the detail beside a left rule and nothing
 * else. The owner's note from the running page — a boxed control under every
 * reading was more chrome than a line of provenance deserves, and it competed
 * with the reading for weight.
 */
function Disclosure({
  summary,
  tone,
  plain,
  children,
}: {
  summary: React.ReactNode;
  /** A left edge in the palette's reflective hue, for the history panel. */
  tone?: 'history';
  /** Text and a chevron, no box; the open detail sits beside a left rule. */
  plain?: boolean;
  children: React.ReactNode;
}) {
  if (plain) {
    return (
      <details className="group">
        <summary
          className={cn(
            'text-muted-foreground inline-flex cursor-pointer list-none items-center gap-1.5',
            'rounded-sm text-[12.5px] leading-[1.45] select-none',
            'transition-colors duration-200 hover:text-[var(--color-heading)]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          <ChevronRight
            size={13}
            strokeWidth={1.8}
            aria-hidden="true"
            className={cn(
              'flex-none transition-transform duration-200 ease-[var(--ease-brand)]',
              'group-open:rotate-90 motion-reduce:transition-none'
            )}
          />
          {summary}
        </summary>
        <div
          className={cn(
            'text-muted-foreground mt-2 ml-[6px] flex max-w-[27rem] flex-col gap-2',
            'border-l-2 border-[var(--color-divider)] pl-3.5 text-[13px] leading-[1.6]'
          )}
        >
          {children}
        </div>
      </details>
    );
  }
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

/**
 * The reading before this one, folded (§3.12): its provenance in the head, so a
 * reader can decide whether to open it without opening it, and the count of
 * anything older beside it. Folded and quiet because the current reading is
 * what the page is for, and this is the door beside it.
 *
 * Shared by a live note and by a placeholder head whose earlier readings are
 * still kept: deleting an exchange wipes only the version that exchange wrote
 * (t-127), so the head can be a placeholder with a live reading behind it.
 */
function PreviousReading({ previous, older }: { previous: NoteHistory; older: number }) {
  return (
    <Disclosure
      tone="history"
      summary={
        <>
          <span className="text-[var(--color-heading)]">Before this</span>
          {' · '}
          {noteSourceWords(previous.sourceType)}, {formatWhen(previous.capturedAt)}
          {older > 0
            ? ` · ${older === 1 ? '1 older reading' : `${older} older readings`} as well`
            : ''}
        </>
      }
    >
      <p className="whitespace-pre-line text-[var(--color-heading)]">
        {previous.removed
          ? 'A note you removed. Nothing of it is kept.'
          : previous.withheld
            ? 'Something Lelañea noted without keeping your exact words.'
            : previous.value}
      </p>
      {/*
        "Kept, not replaced" is true of a reading and false of one the
        person removed, which keeps nothing — so a removed version says
        only what its own line says (`/code-review`, t-78).
      */}
      {previous.removed ? null : (
        <p>
          Kept, not replaced.
          {older > 0
            ? ` The ${older === 1 ? 'reading' : 'readings'} before that ${older === 1 ? 'is' : 'are'} kept too, and not shown here.`
            : ''}
        </p>
      )}
    </Disclosure>
  );
}

export function NoteCard({
  note,
  onAsk,
  onCorrected,
  onRemoved,
  fetchImpl,
  heading,
  onFold,
  focusFold,
}: NoteCardProps) {
  const foldRef = useRef<HTMLButtonElement>(null);
  // A keyboard or screen-reader user who opened a row lands on the card they
  // opened, at the control that closes it again, not on a row that is gone.
  useEffect(() => {
    if (focusFold) foldRef.current?.focus();
  }, [focusFold]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.value);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Not `correct-${slotSlug}`. A slug the agent coins can be any string `fill_slot`
  // accepts — spaces included — and an id with a space in it silently breaks
  // the label's `htmlFor`, leaving the box unnamed to a screen reader.
  const correctionId = useId();
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removalRefusal, setRemovalRefusal] = useState<string | null>(null);
  const [confirmingExchange, setConfirmingExchange] = useState(false);
  const [deletingExchange, setDeletingExchange] = useState(false);
  const [exchangeRefusal, setExchangeRefusal] = useState<string | null>(null);

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

  const remove = async () => {
    if (removing) return;
    setRemoving(true);
    setRemovalRefusal(null);
    try {
      await removeNote(note.slotSlug, { fetchImpl });
      setConfirmingRemoval(false);
      (onRemoved ?? onCorrected)();
    } catch (error: unknown) {
      setRemovalRefusal(
        error instanceof NotesRefused
          ? error.message
          : 'That could not be removed just now. Try again in a moment.'
      );
      logger.warn('A note removal was refused', {
        code: error instanceof NotesRefused ? error.code : 'unknown',
      });
    } finally {
      setRemoving(false);
    }
  };

  const deleteExchange = async () => {
    if (deletingExchange) return;
    setDeletingExchange(true);
    setExchangeRefusal(null);
    try {
      await deleteExchanges(note.exchanges, { fetchImpl });
      setConfirmingExchange(false);
      (onRemoved ?? onCorrected)();
    } catch (error: unknown) {
      setExchangeRefusal(
        error instanceof NotesRefused
          ? error.message
          : 'That could not be deleted just now. Try again in a moment.'
      );
      logger.warn('An exchange deletion was refused', {
        code: error instanceof NotesRefused ? error.code : 'unknown',
      });
    } finally {
      setDeletingExchange(false);
    }
  };

  /*
   * The slug as a tag, in the eyebrow's lower-case tracked register.
   *
   * The taxonomy's `description` used to sit here, and it is written for a
   * MODEL: "how their body, energy and sleep stands for this person right now".
   * On a panel read by the person it is about, that is the app calling them
   * "they" — the owner's second correction. It has moved into the disclosure as
   * a quotation of the taxonomy's wording, where being third-person is honest rather than
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
    <Card className="@container p-[22px]" eyebrow={onFold ? undefined : eyebrow}>
      {onFold ? (
        /*
          The whole header is the fold control (owner ruling, t-79): the eyebrow
          row, run out to the card's edges, with the chevron at its end. A real
          button rather than a clickable div — `Card`'s own rule — so it takes
          focus, answers Enter and Space, and says what it does. The negative
          margins pull its hit area over the card's padding, so a click anywhere
          along the top of the card folds it.
        */
        <button
          ref={foldRef}
          type="button"
          aria-expanded={true}
          aria-label={`Fold this note: ${eyebrow}`}
          onClick={onFold}
          className={cn(
            'group/fold -mx-[22px] -mt-[22px] mb-1 flex w-[calc(100%+44px)] items-center gap-3',
            'rounded-t-lg px-[22px] pt-[18px] pb-2 text-left',
            'transition-colors duration-200 ease-[var(--ease-brand)] hover:bg-[var(--color-pill-hover)]',
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          <Eyebrow className="min-w-0 flex-1">{eyebrow}</Eyebrow>
          <ChevronDown
            size={16}
            strokeWidth={1.8}
            aria-hidden="true"
            className="text-muted-foreground flex-none rotate-180 group-hover/fold:text-[var(--color-heading)]"
          />
        </button>
      ) : null}
      {/*
        The container query is the point, and it is the repo's first.
        This card's width is set by the workspace pane — which a reader drags,
        and which narrows whenever the conversation opens beside it — so a viewport
        breakpoint would split the columns on a 1400px window while the pane
        itself was 320px wide. `@container` asks the only question that matters:
        is THIS card wide enough for two columns.
      */}
      {note.removed ? (
        /*
          A placeholder, and only that (t-78). No aside: a removed note has no
          certainty or source left to report, and showing "Only a guess · 1 of 10"
          for something the person took back would read as a judgement on it.
          Nothing left to correct or ask about. The controls are the offer to
          delete the exchange the note came from, and removing an earlier
          reading an exchange deletion left behind (t-127).
        */
        <div className="flex max-w-[34rem] flex-col gap-1.5">
          <p className="text-muted-foreground text-[15px] leading-[1.6]">
            {removedWords(note.capturedAt)}
          </p>
          <p className="text-muted-foreground text-[13px] leading-[1.6]">{REMOVED_POINTER}</p>
          {/*
            Deleting an exchange wipes only the version it wrote (t-127), so a
            placeholder head can have a live reading behind it. That reading is
            still held, so it is still shown: §3.19 is the whole picture.
          */}
          {note.previous && !note.previous.removed ? (
            <div className="mt-2">
              <PreviousReading previous={note.previous} older={older} />
            </div>
          ) : null}
          {/* And what is still held is still the person's to remove. */}
          {note.removable && !confirmingRemoval ? (
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                className={PILL}
                onClick={() => {
                  setRemovalRefusal(null);
                  setConfirmingRemoval(true);
                }}
              >
                Remove what is still kept
              </Button>
            </div>
          ) : null}
          {note.exchanges.length > 0 && !confirmingExchange ? (
            <div className="mt-2 flex flex-col items-start gap-2">
              <p className="text-[13.5px] leading-[1.6] text-[var(--color-heading)]">
                {EXCHANGE_OFFER}
              </p>
              <Button
                size="sm"
                variant="ghost"
                className={PILL}
                onClick={() => {
                  setExchangeRefusal(null);
                  setConfirmingExchange(true);
                }}
              >
                Delete that part of the conversation
              </Button>
            </div>
          ) : null}
          {confirmingExchange && note.exchanges.length > 0 ? (
            /*
              In place, like the removal's own confirmation, and for the same
              reason: the question is about what the reader is looking at.
            */
            <div className="mt-2" role="group" aria-label="Delete that part of the conversation?">
              <p className="text-[13.5px] leading-[1.6] text-[var(--color-heading)]">
                {EXCHANGE_CONFIRM}
              </p>
              {exchangeRefusal ? (
                <Banner tone="error" className="mt-2.5" lead="Not deleted.">
                  {exchangeRefusal}
                </Banner>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deletingExchange}
                  onClick={() => void deleteExchange()}
                >
                  {deletingExchange ? 'Deleting…' : 'Delete it'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className={PILL}
                  disabled={deletingExchange}
                  onClick={() => {
                    setConfirmingExchange(false);
                    setExchangeRefusal(null);
                  }}
                >
                  Keep it
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
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
                {WITHHELD_WORDS} {WITHHELD_POINTER}
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

            {note.previous ? <PreviousReading previous={note.previous} older={older} /> : null}

            <Disclosure plain summary="How Lelañea came to this">
              <p>{note.reasoningNote}</p>
              {note.asking ? (
                /*
                The taxonomy's wording, quoted. Third person inside the quotation marks is
                the taxonomy speaking to a model, which is what it is — the
                panel is not addressing the reader as "this person".
              */
                <p>
                  <span className="text-[var(--color-heading)]">
                    What Lelañea was looking for:{' '}
                  </span>
                  “{note.asking}”
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
      )}

      {note.removed ? null : editing ? (
        <div className="mt-4">
          <label className="sr-only" htmlFor={correctionId}>
            Your correction
          </label>
          <textarea
            id={correctionId}
            value={draft}
            // Seen on a blanked-out note, whose box opens empty (t-84), and on
            // any note someone has cleared to start again.
            placeholder="In your own words, how would you put this?"
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
                // A withheld note is correctable once its slot is no longer
                // special-category (t-84), and its value is the sentinel: the
                // person starts from nothing rather than from `<redacted: …>`.
                setDraft(note.withheld ? '' : note.value);
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
                // A withheld note is correctable once its slot is no longer
                // special-category (t-84), and its value is the sentinel: the
                // person starts from nothing rather than from `<redacted: …>`.
                setDraft(note.withheld ? '' : note.value);
                setEditing(true);
              }}
            >
              That’s not right
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" className={PILL} onClick={() => onAsk(askText(note))}>
            Ask Lelañea about this
          </Button>
          {note.removable && !confirmingRemoval ? (
            <Button
              size="sm"
              variant="ghost"
              className={PILL}
              onClick={() => {
                setRemovalRefusal(null);
                setConfirmingRemoval(true);
              }}
            >
              Remove this note
            </Button>
          ) : null}
        </div>
      )}

      {confirmingRemoval && note.removable && !editing ? (
        /*
          In place rather than a dialog: the reader is looking at the note, and
          the question is about the note. The destructive fill is on the act
          itself and nowhere else, so "Keep it" is the quiet way out.
        */
        <div className="mt-3.5 max-w-[34rem]" role="group" aria-label="Remove this note?">
          <p className="text-[13.5px] leading-[1.6] text-[var(--color-heading)]">
            {removeConfirm(note)}
          </p>
          {removalRefusal ? (
            <Banner tone="error" className="mt-2.5" lead="Not removed.">
              {removalRefusal}
            </Banner>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={removing}
              onClick={() => void remove()}
            >
              {removing ? 'Removing…' : 'Remove it'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className={PILL}
              disabled={removing}
              onClick={() => {
                setConfirmingRemoval(false);
                setRemovalRefusal(null);
              }}
            >
              Keep it
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
