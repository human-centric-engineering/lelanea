'use client';

import { useId, useState } from 'react';

import { FIELD, LABEL } from '@/components/app/journey/fields';
import { Button } from '@/components/app/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import { JOURNEY_BODY_MAX, JOURNEY_SUMMARY_MAX } from '@/lib/app/journey-record/entry';
import type { OwnEntryWords } from '@/lib/app/journey-record/client';
import { cn } from '@/lib/utils';

export interface OwnEntryFormProps {
  initial?: OwnEntryWords;
  busy: boolean;
  submitLabel: string;
  onSubmit: (words: OwnEntryWords) => void;
  onCancel: () => void;
}

/** What the person writes into their journey themselves: kept the moment it is written (t-148). */
export function OwnEntryForm({
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
}: OwnEntryFormProps) {
  const ids = { summary: useId(), body: useId(), withheld: useId() };
  const [summary, setSummary] = useState(initial?.summary ?? '');
  const [body, setBody] = useState(initial?.body ?? '');
  const [withheld, setWithheld] = useState(initial?.withheldFromAgent ?? false);
  const ready = body.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) {
          onSubmit({ summary: summary.trim(), body: body.trim(), withheldFromAgent: withheld });
        }
      }}
    >
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <label htmlFor={ids.summary} className={LABEL}>
            In a line <span className="text-muted-foreground">(optional)</span>
          </label>
          <FieldHelp title="The line">
            What this entry shows while it is closed. Leave it blank and the start of what you wrote
            is shown instead.
          </FieldHelp>
        </div>
        <input
          id={ids.summary}
          value={summary}
          maxLength={JOURNEY_SUMMARY_MAX}
          onChange={(event) => setSummary(event.currentTarget.value)}
          className={FIELD}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.body} className={LABEL}>
          Your words
        </label>
        <textarea
          id={ids.body}
          value={body}
          maxLength={JOURNEY_BODY_MAX}
          required
          rows={5}
          onChange={(event) => setBody(event.currentTarget.value)}
          className={cn(FIELD, 'resize-y')}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          id={ids.withheld}
          type="checkbox"
          checked={withheld}
          onChange={(event) => setWithheld(event.currentTarget.checked)}
          className="size-4 accent-[var(--color-accent-ink)]"
        />
        <label htmlFor={ids.withheld} className="text-[13px] text-[var(--color-heading)]">
          Keep this from Lelañea
        </label>
        <FieldHelp title="Keeping an entry from Lelañea">
          Lelañea reads what is in your journey, so a conversation can pick up where you left off.
          Tick this and it never reads this entry. It stays here for you, and you can change your
          mind at any time.
        </FieldHelp>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button type="submit" size="sm" disabled={busy || !ready}>
          {submitLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
