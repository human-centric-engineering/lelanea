'use client';

import { X } from 'lucide-react';
import { useId, useState } from 'react';

import { FIELD, LABEL } from '@/components/app/journey/fields';
import { Button } from '@/components/app/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import {
  JOURNEY_BODY_MAX,
  JOURNEY_OUTCOME_KINDS,
  JOURNEY_OUTCOME_TEXT_MAX,
  JOURNEY_OUTCOMES_MAX,
  JOURNEY_SUMMARY_MAX,
  type JourneyOutcome,
  type JourneyOutcomeKind,
} from '@/lib/app/journey-record/entry';
import { cn } from '@/lib/utils';

export const OUTCOME_WORDS: Record<JourneyOutcomeKind, string> = {
  action: 'Action',
  insight: 'Insight',
  tension: 'Tension',
};

export interface SynopsisText {
  summary: string;
  body: string;
  outcomes: JourneyOutcome[];
}

export interface SynopsisEditorProps {
  initial: SynopsisText;
  /** The note ticks, which keeping sends with the change. */
  notes?: React.ReactNode;
  busy: boolean;
  /** The text can still be edited and copied, but not kept: the entry moved on underneath it. */
  locked?: boolean;
  /** "Keep my version" on a draft; "Keep this change" on a kept synopsis. */
  submitLabel: string;
  onSubmit: (text: SynopsisText) => void;
  onCancel: () => void;
}

/**
 * Changing an account before keeping it, or after (t-148, over t-147's keep
 * route). The line, the account and its outcomes, each as the person wants
 * them. Outcomes left blank are dropped rather than refused.
 */
export function SynopsisEditor({
  initial,
  notes,
  busy,
  locked = false,
  submitLabel,
  onSubmit,
  onCancel,
}: SynopsisEditorProps) {
  const ids = { summary: useId(), body: useId(), outcomes: useId() };
  const [summary, setSummary] = useState(initial.summary);
  const [body, setBody] = useState(initial.body);
  const [outcomes, setOutcomes] = useState<JourneyOutcome[]>(initial.outcomes);

  const setOutcome = (index: number, change: Partial<JourneyOutcome>) =>
    setOutcomes((all) => all.map((o, i) => (i === index ? { ...o, ...change } : o)));

  const kept = outcomes
    .map((o) => ({ kind: o.kind, text: o.text.trim() }))
    .filter((o) => o.text.length > 0);
  const ready = summary.trim().length > 0 && body.trim().length > 0;

  return (
    <form
      className="mt-2 flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready && !locked) {
          onSubmit({ summary: summary.trim(), body: body.trim(), outcomes: kept });
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label htmlFor={ids.summary} className={LABEL}>
            In a line
          </label>
          <FieldHelp title="The line">
            What this stop shows while it is closed, so you can find the session again at a glance.
          </FieldHelp>
        </div>
        <input
          id={ids.summary}
          value={summary}
          maxLength={JOURNEY_SUMMARY_MAX}
          required
          onChange={(event) => setSummary(event.currentTarget.value)}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.body} className={LABEL}>
          What happened
        </label>
        <textarea
          id={ids.body}
          value={body}
          maxLength={JOURNEY_BODY_MAX}
          required
          rows={6}
          onChange={(event) => setBody(event.currentTarget.value)}
          className={cn(FIELD, 'resize-y')}
        />
      </div>

      <fieldset className="flex flex-col gap-2" aria-labelledby={ids.outcomes}>
        <div className="flex items-center gap-1.5">
          <span id={ids.outcomes} className={LABEL}>
            What came out of it
          </span>
          <FieldHelp title="Outcomes">
            An action is something you decided to do. An insight is something you came to see. A
            tension is something still open. They are what the pills on each stop count.
          </FieldHelp>
        </div>
        {outcomes.map((outcome, index) => (
          <div key={index} className="flex items-start gap-2">
            <label className="sr-only" htmlFor={`${ids.outcomes}-kind-${index}`}>
              Kind of outcome
            </label>
            <select
              id={`${ids.outcomes}-kind-${index}`}
              value={outcome.kind}
              onChange={(event) => {
                const kind = JOURNEY_OUTCOME_KINDS.find((k) => k === event.currentTarget.value);
                if (kind) setOutcome(index, { kind });
              }}
              className={cn(FIELD, 'w-auto flex-none cursor-pointer py-[7px] text-[13px]')}
            >
              {JOURNEY_OUTCOME_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {OUTCOME_WORDS[kind]}
                </option>
              ))}
            </select>
            <label className="sr-only" htmlFor={`${ids.outcomes}-text-${index}`}>
              Outcome
            </label>
            <input
              id={`${ids.outcomes}-text-${index}`}
              value={outcome.text}
              maxLength={JOURNEY_OUTCOME_TEXT_MAX}
              onChange={(event) => setOutcome(index, { text: event.currentTarget.value })}
              className={cn(FIELD, 'py-[7px] text-[13px]')}
            />
            <button
              type="button"
              aria-label="Remove this outcome"
              onClick={() => setOutcomes((all) => all.filter((_, i) => i !== index))}
              className="text-muted-foreground mt-2 flex-none rounded-full p-0.5 hover:text-[var(--color-heading)]"
            >
              <X size={15} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        ))}
        {outcomes.length < JOURNEY_OUTCOMES_MAX ? (
          <button
            type="button"
            onClick={() => setOutcomes((all) => [...all, { kind: 'insight', text: '' }])}
            className="self-start text-[13px] text-[var(--color-heading)] underline underline-offset-[3px]"
          >
            Add an outcome
          </button>
        ) : null}
      </fieldset>

      {notes}

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" size="sm" disabled={busy || locked || !ready}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
