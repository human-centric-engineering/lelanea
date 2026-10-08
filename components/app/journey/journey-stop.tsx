'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';

import {
  ConfirmedNotes,
  NoteTicks,
  listedNotes,
  tickedRefs,
  type ListedNote,
} from '@/components/app/journey/journey-notes';
import { DeleteSessionConfirm, canDeleteSession } from '@/components/app/journey/delete-session';
import { FIELD, LABEL } from '@/components/app/journey/fields';
import { OwnEntryForm } from '@/components/app/journey/own-entry-form';
import {
  OUTCOME_WORDS,
  SynopsisEditor,
  type SynopsisText,
} from '@/components/app/journey/synopsis-editor';
import { useJourneyAction, type JourneyAction } from '@/components/app/journey/use-journey-action';
import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import {
  changeOwnEntry,
  keepSynopsis,
  regenerateSynopsis,
  removeEntry,
} from '@/lib/app/journey-record/client';
import {
  JOURNEY_OUTCOME_KINDS,
  SYNOPSIS_STEER_MAX,
  countOutcomes,
  type JourneyEntry,
  type JourneyListedNote,
  type JourneyOutcomeKind,
} from '@/lib/app/journey-record/entry';
import type { JourneySignpost } from '@/lib/app/journey/next';
import { modulePath } from '@/lib/app/journey/paths';
import { cn } from '@/lib/utils';

/** Where a stop's dot sits, and what colour it is. */
export type StopTone = 'kept' | 'draft' | 'own' | 'next';

const DOT: Record<StopTone, string> = {
  kept: 'border-transparent bg-[var(--color-status-green)]',
  draft:
    'border-transparent bg-[var(--color-accent-ink)] shadow-[0_0_0_4px_var(--color-secondary-wash)]',
  own: 'border-[var(--color-secondary-ink)] bg-[var(--color-background)]',
  next: 'border-[var(--color-accent-ink)] bg-[var(--color-background)]',
};

const PILL: Record<JourneyOutcomeKind, string> = {
  action: 'bg-[var(--color-status-green-bg)] text-[var(--color-status-green-ink)]',
  insight: 'bg-[var(--color-secondary-wash)] text-[var(--color-secondary-ink)]',
  tension: 'bg-[var(--color-status-yellow-bg)] text-[var(--color-status-yellow-ink)]',
};

const PILL_BASE =
  'inline-flex h-[22px] items-center rounded-full px-2.5 text-[11px] whitespace-nowrap';

const TAG =
  'inline-flex h-[25px] items-center rounded-full bg-[var(--color-pill)] px-2.5 text-[11.5px] text-muted-foreground';

function plural(count: number, kind: JourneyOutcomeKind): string {
  return `${count} ${kind}${count === 1 ? '' : 's'}`;
}

/**
 * The date a stop sits at: "4 March", or "4 March 2025" outside this year.
 * Formatted in the reader's own time zone, so the server's render may differ
 * by a day near midnight; the browser's wins without a warning.
 */
function formatWhen(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return 'Undated';
  const thisYear = at.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    ...(thisYear ? {} : { year: 'numeric' }),
  }).format(at);
}

/** The line a closed stop shows: its summary, or the start of an own entry's words. */
export function stopLine(entry: JourneyEntry): string {
  if (entry.summary) return entry.summary;
  const words = entry.body.replace(/\s+/g, ' ').trim();
  return words.length > 120 ? `${words.slice(0, 117).trimEnd()}…` : words;
}

/* ----------------------------------------------------------- the frame */

interface StopFrameProps {
  tone: StopTone;
  /** The thread below this stop: solid to the next entry, dashed to the signpost, none after the last. */
  thread: 'solid' | 'dashed' | 'none';
  open: boolean;
  onToggle: () => void;
  when: React.ReactNode;
  line: string;
  pills?: React.ReactNode;
  children: React.ReactNode;
}

/** One stop on the thread: a dot, the head that opens it, and its body when open. */
function StopFrame({ tone, thread, open, onToggle, when, line, pills, children }: StopFrameProps) {
  const bodyId = useId();
  const next = tone === 'next';
  return (
    <li className={cn('relative pb-[30px] last:pb-1', next && 'mt-2')}>
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-[14px] -left-[25px] z-[1] size-[14px] rounded-full border-2',
          DOT[tone]
        )}
      />
      {thread === 'none' ? null : (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[28px] -bottom-[14px] -left-[19px]',
            thread === 'solid'
              ? 'w-[2px] bg-[var(--color-divider)]'
              : 'w-0 border-l-2 border-dashed border-[var(--color-border)]'
          )}
        />
      )}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        className={cn(
          'flex w-full flex-wrap items-baseline gap-x-3.5 gap-y-2 rounded-xl py-[9px] pr-3 pl-2.5 text-left',
          'transition-colors duration-200 ease-[var(--ease-brand)] hover:bg-[var(--color-pill)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] focus-visible:outline-solid',
          next &&
            'border border-dashed border-[var(--color-border)] bg-[var(--color-popover)] hover:border-[var(--color-accent-ink)]'
        )}
      >
        <span
          className={cn(
            'w-[142px] flex-none text-[11px] tracking-[0.11em]',
            next ? 'font-medium text-[var(--color-accent-ink)]' : 'text-muted-foreground'
          )}
        >
          {when}
        </span>
        <span
          className={cn(
            'min-w-0 flex-[1_1_220px] text-[15px] leading-[1.5]',
            next ? 'text-muted-foreground' : 'text-[var(--color-heading)]',
            tone === 'draft' && 'font-medium'
          )}
        >
          {line}
        </span>
        {pills ? <span className="flex flex-none flex-wrap gap-1.5">{pills}</span> : null}
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          aria-hidden="true"
          className={cn(
            'text-muted-foreground flex-none self-center transition-transform duration-[220ms] ease-[var(--ease-brand)]',
            open && 'rotate-180'
          )}
        />
      </button>
      {/*
        Mounted while closed, only hidden: the body holds the person's unsent
        work (unticked notes, a half-written change), and opening another stop
        must not throw it away.
      */}
      <div id={bodyId} hidden={!open} className="pt-0.5 pr-3 pb-1.5 pl-2.5">
        {children}
      </div>
    </li>
  );
}

/* ------------------------------------------------------- what it shows */

function OutcomePills({ entry }: { entry: JourneyEntry }) {
  const counts = countOutcomes(entry.outcomes);
  return (
    <>
      {entry.state === 'draft' ? (
        <i
          className={cn(PILL_BASE, 'bg-[var(--color-pill)] text-[var(--color-heading)] not-italic')}
        >
          waiting for you
        </i>
      ) : null}
      {entry.kind === 'own' ? (
        <i className={cn(PILL_BASE, 'text-muted-foreground bg-[var(--color-pill)] not-italic')}>
          your words
        </i>
      ) : null}
      {JOURNEY_OUTCOME_KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
        <i key={kind} className={cn(PILL_BASE, PILL[kind], 'not-italic')}>
          {plural(counts[kind], kind)}
        </i>
      ))}
    </>
  );
}

function Said({ text }: { text: string }) {
  return (
    <div className="mt-1 flex flex-col gap-3">
      {text.split(/\n{2,}/).map((paragraph, index) => (
        <p key={index} className="text-[14px] leading-[1.65] whitespace-pre-line">
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function Outcomes({ entry }: { entry: JourneyEntry }) {
  if (entry.outcomes.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-col gap-[7px]">
      {entry.outcomes.map((outcome, index) => (
        <li key={index} className="text-muted-foreground flex gap-[9px] text-[13px] leading-[1.55]">
          <i
            aria-hidden="true"
            className="mt-[7px] size-[5px] flex-none rounded-full bg-[var(--color-accent-ink)]"
          />
          <span>
            <span className="sr-only">{OUTCOME_WORDS[outcome.kind]}: </span>
            {outcome.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The modules a session touched, each linking to its module. Usually none in release 1. */
function Modules({
  modules,
  labels,
}: {
  modules: string[];
  labels: Readonly<Record<string, string>>;
}) {
  if (modules.length === 0) {
    return (
      <p className="text-muted-foreground mt-3 text-[12.5px]">
        No module was opened in this session.
      </p>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {modules.map((slug) => (
        <Link
          key={slug}
          href={modulePath(slug)}
          className={cn(
            TAG,
            'hover:bg-[var(--color-pill-hover)] hover:text-[var(--color-heading)]'
          )}
        >
          {labels[slug] ?? slug.replace(/[_-]/g, ' ')}
        </Link>
      ))}
    </div>
  );
}

function Refusal({ action }: { action: JourneyAction }) {
  if (!action.error) return null;
  return (
    <Banner tone="error" className="mt-3" role="alert">
      {action.error}
    </Banner>
  );
}

/** A destructive step asked twice, inline: no browser dialog. */
function ConfirmRemove({
  question,
  confirmLabel,
  action,
  onConfirm,
  onCancel,
}: {
  question: string;
  confirmLabel: string;
  action: JourneyAction;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <p className="text-[13px] text-[var(--color-heading)]">{question}</p>
      <Button size="sm" variant="destructive" disabled={action.busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
      <Button size="sm" variant="ghost" disabled={action.busy} onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------- a synopsis */

type SynopsisMode = 'reading' | 'editing' | 'steering' | 'removing' | 'deleting';

function SteerForm({
  left,
  action,
  onSubmit,
  onCancel,
}: {
  left: number;
  action: JourneyAction;
  onSubmit: (steer: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [steer, setSteer] = useState('');
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(steer.trim());
      }}
    >
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className={LABEL}>
          What should be different? <span className="text-muted-foreground">(optional)</span>
        </label>
        <FieldHelp title="Asking for another draft">
          Lelañea writes the account again from the same session, with what you say here in mind:
          shorter, warmer, or something it missed. It replaces this draft, which is still a draft
          until you keep it.
        </FieldHelp>
      </div>
      <textarea
        id={id}
        value={steer}
        maxLength={SYNOPSIS_STEER_MAX}
        rows={2}
        onChange={(event) => setSteer(event.currentTarget.value)}
        className={cn(FIELD, 'resize-y')}
      />
      <p className="text-muted-foreground text-[12px]">
        {left === 1 ? 'This is the last draft you can ask for.' : `You can ask ${left} more times.`}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={action.busy}>
          {action.busy ? 'Writing another…' : 'Ask for another'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={action.busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function SynopsisBody({
  entry,
  notes,
  moduleLabels,
}: {
  entry: JourneyEntry;
  notes: ListedNote[];
  moduleLabels: Readonly<Record<string, string>>;
}) {
  const action = useJourneyAction();
  const [mode, setMode] = useState<SynopsisMode>('reading');
  /** The slugs the person unticked (`journey-notes.tsx`, `tickedRefs`). */
  const [unticked, setUnticked] = useState<Set<string>>(() => new Set());
  /*
   * The version a change was started from. Keeping is conditional on what the
   * person was shown, and an editor holds the text it opened with, so a change
   * started before a redraft (another tab) must not keep over the redraft. When
   * the entry moves on underneath an open editor, the editor keeps the
   * person's words but can no longer keep them: it says so, and Cancel shows
   * the version that is there now.
   */
  const [editingFrom, setEditingFrom] = useState<string | null>(null);
  const overtaken = mode === 'editing' && editingFrom !== null && editingFrom !== entry.updatedAt;
  const startEditing = () => {
    setEditingFrom(entry.updatedAt);
    setMode('editing');
  };
  const keep = (edit?: SynopsisText) =>
    action.run(() =>
      keepSynopsis(entry.id, {
        seen: edit && editingFrom ? editingFrom : entry.updatedAt,
        confirm: tickedRefs(notes, unticked),
        ...(edit ? { edit } : {}),
      })
    );
  /**
   * Finish the notes an earlier keep still owes: every listed note the person
   * has not unticked, as listed. keep.ts decides what each one needs (one an
   * interrupted keep already confirmed is recognised there), so the page does
   * not filter by version here.
   */
  const finishNotes = () =>
    action.run(() =>
      keepSynopsis(entry.id, {
        seen: entry.updatedAt,
        confirm: entry.notes.filter((ref) => !unticked.has(ref.slotSlug)),
      })
    );
  const draft = entry.state === 'draft';
  const deleting = mode === 'deleting' && canDeleteSession(entry);
  const toggle = (slotSlug: string) =>
    setUnticked((all) => {
      const next = new Set(all);
      if (next.has(slotSlug)) next.delete(slotSlug);
      else next.add(slotSlug);
      return next;
    });
  const ticks = (
    <NoteTicks notes={notes} unticked={unticked} onToggle={toggle} disabled={action.busy} />
  );
  const done = (went: boolean) => {
    if (went) setMode('reading');
  };

  if (mode === 'editing') {
    return (
      <>
        {overtaken ? (
          <Banner tone="warning" className="mt-2" role="status">
            This account changed since you started, perhaps in another tab, so your version can’t be
            kept over it. Copy anything you want to keep, then cancel to see the new version.
          </Banner>
        ) : null}
        <SynopsisEditor
          initial={{ summary: entry.summary ?? '', body: entry.body, outcomes: entry.outcomes }}
          notes={ticks}
          busy={action.busy}
          locked={overtaken}
          submitLabel={draft ? 'Keep my version' : 'Keep this change'}
          onCancel={() => {
            setEditingFrom(null);
            setMode('reading');
          }}
          onSubmit={(edit) => void keep(edit).then(done)}
        />
        <Refusal action={action} />
      </>
    );
  }

  return (
    <>
      {draft ? (
        <p className="text-muted-foreground mb-2 text-[12.5px]">
          A draft of what this session was about. It is not in your journey until you keep it, and
          Lelañea does not read it.
        </p>
      ) : null}
      {entry.sourceRemoved ? (
        <Banner tone="warning" className="mb-2">
          This was written from part of a conversation you have since deleted, so it may still
          describe it. Change it or remove it if it does.
        </Banner>
      ) : null}
      <Said text={entry.body} />
      <Outcomes entry={entry} />
      <Modules modules={entry.modules} labels={moduleLabels} />
      {draft ? ticks : <ConfirmedNotes notes={notes} />}
      {entry.notesPending ? (
        <Banner tone="warning" className="mt-3" role="status">
          Your account is kept, but Lelañea has not yet confirmed the notes listed with it, so they
          are as they were.{' '}
          <button
            type="button"
            disabled={action.busy}
            onClick={() => void finishNotes()}
            className="underline underline-offset-[3px]"
          >
            Try the notes again
          </button>
        </Banner>
      ) : null}

      {mode === 'steering' && entry.regenerationsLeft ? (
        <SteerForm
          left={entry.regenerationsLeft}
          action={action}
          onCancel={() => setMode('reading')}
          onSubmit={(steer) =>
            void action.run(() => regenerateSynopsis(entry.id, steer)).then(done)
          }
        />
      ) : mode === 'removing' ? (
        <ConfirmRemove
          question={
            draft
              ? 'Discard this draft? This session will not be drafted again.'
              : 'Remove this from your journey? Its words go with it.'
          }
          confirmLabel={draft ? 'Discard' : 'Remove'}
          action={action}
          onCancel={() => setMode('reading')}
          onConfirm={() => void action.run(() => removeEntry(entry.id))}
        />
      ) : deleting ? (
        <DeleteSessionConfirm
          entry={entry}
          action={action}
          onCancel={() => setMode('reading')}
          onDeleted={() => setMode('reading')}
        />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {draft ? (
            <Button size="sm" disabled={action.busy} onClick={() => void keep()}>
              Keep this
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={draft ? 'secondary' : 'ghost'}
            disabled={action.busy}
            onClick={startEditing}
          >
            {draft ? 'Change it' : 'Change this account'}
          </Button>
          {draft && entry.regenerationsLeft ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={action.busy}
              onClick={() => setMode('steering')}
            >
              Ask for another
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={action.busy}
            onClick={() => setMode('removing')}
          >
            {draft ? 'Discard' : 'Remove'}
          </Button>
          {canDeleteSession(entry) ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={action.busy}
              onClick={() => setMode('deleting')}
            >
              Delete this session
            </Button>
          ) : null}
        </div>
      )}
      {/* The session's confirmation says its own refusal, beside the choice it refused. */}
      {deleting ? null : <Refusal action={action} />}
    </>
  );
}

/* --------------------------------------------------------- an own entry */

type OwnMode = 'reading' | 'editing' | 'removing';

function OwnBody({ entry }: { entry: JourneyEntry }) {
  const action = useJourneyAction();
  const [mode, setMode] = useState<OwnMode>('reading');

  if (mode === 'editing') {
    return (
      <>
        <OwnEntryForm
          initial={{
            summary: entry.summary ?? '',
            body: entry.body,
            withheldFromAgent: entry.withheldFromAgent,
          }}
          busy={action.busy}
          submitLabel="Save"
          onCancel={() => setMode('reading')}
          onSubmit={(words) =>
            void action
              .run(() => changeOwnEntry(entry.id, words))
              .then((went) => went && setMode('reading'))
          }
        />
        <Refusal action={action} />
      </>
    );
  }

  return (
    <>
      <Said text={entry.body} />
      <p className="text-muted-foreground mt-3 text-[12.5px]">
        {entry.withheldFromAgent
          ? 'Kept from Lelañea: it never reads this entry.'
          : 'Lelañea can read this, so a conversation can pick it up.'}
      </p>
      {mode === 'removing' ? (
        <ConfirmRemove
          question="Remove this from your journey? Its words go with it."
          confirmLabel="Remove"
          action={action}
          onCancel={() => setMode('reading')}
          onConfirm={() => void action.run(() => removeEntry(entry.id))}
        />
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={action.busy}
            onClick={() => setMode('editing')}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={action.busy}
            onClick={() =>
              void action.run(() =>
                changeOwnEntry(entry.id, { withheldFromAgent: !entry.withheldFromAgent })
              )
            }
          >
            {entry.withheldFromAgent ? 'Let Lelañea read this' : 'Keep this from Lelañea'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={action.busy}
            onClick={() => setMode('removing')}
          >
            Remove
          </Button>
        </div>
      )}
      <Refusal action={action} />
    </>
  );
}

/* ---------------------------------------------------------------- stops */

export interface JourneyStopProps {
  entry: JourneyEntry;
  notes: readonly JourneyListedNote[];
  moduleLabels: Readonly<Record<string, string>>;
  thread: StopFrameProps['thread'];
  open: boolean;
  onToggle: () => void;
}

/** One entry in the record: a session's account, a draft of one, or the person's own words. */
export function JourneyStop({
  entry,
  notes,
  moduleLabels,
  thread,
  open,
  onToggle,
}: JourneyStopProps) {
  const tone: StopTone = entry.kind === 'own' ? 'own' : entry.state === 'draft' ? 'draft' : 'kept';
  return (
    <StopFrame
      tone={tone}
      thread={thread}
      open={open}
      onToggle={onToggle}
      when={
        <time dateTime={entry.occurredAt} suppressHydrationWarning>
          {formatWhen(entry.occurredAt)}
        </time>
      }
      line={stopLine(entry)}
      pills={<OutcomePills entry={entry} />}
    >
      {entry.kind === 'own' ? (
        <OwnBody entry={entry} />
      ) : (
        <SynopsisBody
          entry={entry}
          notes={listedNotes(entry.notes, notes)}
          moduleLabels={moduleLabels}
        />
      )}
    </StopFrame>
  );
}

/** The signpost pinned last: where the map goes next. Not an entry, and never counted. */
export function NextStop({
  next,
  open,
  onToggle,
}: {
  next: JourneySignpost;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <StopFrame
      tone="next"
      thread="none"
      open={open}
      onToggle={onToggle}
      when="What’s next"
      line={
        next.standing === 'current'
          ? `You are in ${next.label}.`
          : `${next.label} comes next on the map, unless you say otherwise.`
      }
    >
      <p className="mt-1 text-[14px] leading-[1.65]">
        Nothing has been decided about what comes next. Every module stays open to you, and you can
        go wherever you want to.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Link
          href={next.href}
          className={cn(
            TAG,
            'hover:bg-[var(--color-pill-hover)] hover:text-[var(--color-heading)]'
          )}
        >
          {next.label}
        </Link>
      </div>
    </StopFrame>
  );
}
