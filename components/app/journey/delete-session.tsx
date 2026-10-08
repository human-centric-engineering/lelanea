'use client';

import { useId, useState } from 'react';

import type { JourneyAction } from '@/components/app/journey/use-journey-action';
import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { FieldHelp } from '@/components/ui/field-help';
import { deleteSession } from '@/lib/app/journey-record/client';
import type { JourneyEntry } from '@/lib/app/journey-record/entry';

/** What deleting a session takes, said before it happens. */
export const SESSION_DELETE_CONFIRM =
  'This deletes what you said in this session and Lelañea’s replies, from the conversation and from everything Lelañea keeps. The notes Lelañea made in it are removed, and so is any recap Lelañea gave of it. This can’t be undone.';

/** Said after {@link SESSION_DELETE_CONFIRM} on a draft, which always goes (owner ruling 1). */
export const SESSION_DELETE_DRAFT = 'This draft account goes with it.';

/** The tick a kept account carries, on by default (owner ruling 1). */
export const SESSION_DELETE_ACCOUNT = 'Also delete the account you kept';

/**
 * Whether a stop can offer to delete its session (t-154): a synopsis whose
 * session still has turns. A session from before turns were stamped has none,
 * so there is nothing to delete by session, and it offers nothing.
 */
export function canDeleteSession(entry: JourneyEntry): boolean {
  return entry.kind === 'synopsis' && entry.session?.hasTurns === true;
}

/**
 * The confirmation for deleting a whole session, asked in place at its stop,
 * as every destructive step on the journey view is.
 *
 * A kept account is the person's, possibly in their own edited words, so they
 * decide whether it goes too; a draft nobody kept always goes (owner ruling 1,
 * 7 Oct 2026). The page re-reads after it, through `action`: the stop goes,
 * or, with its account kept, stays marked as written from a conversation since
 * deleted.
 */
export function DeleteSessionConfirm({
  entry,
  action,
  onCancel,
  onDeleted,
}: {
  entry: JourneyEntry;
  action: JourneyAction;
  onCancel: () => void;
  /** It went through. A stop whose kept account stays is still on the page after the re-read. */
  onDeleted: () => void;
}) {
  const tickId = useId();
  const [removeAccount, setRemoveAccount] = useState(true);
  /*
   * The stop's action is shared by every control on it, so its error may be a
   * refused keep or redraft from before this opened. Only a refusal of the
   * delete itself is said here, as "Not deleted.".
   */
  const [tried, setTried] = useState(false);
  const kept = entry.state === 'kept';
  const session = entry.session;
  if (!session) return null;

  return (
    <div className="mt-3" role="group" aria-label="Delete this session?">
      <p className="text-[13.5px] leading-[1.6] text-[var(--color-heading)]">
        {SESSION_DELETE_CONFIRM}
        {kept ? null : ` ${SESSION_DELETE_DRAFT}`}
      </p>
      {kept ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <label htmlFor={tickId} className="flex items-start gap-2.5">
            <input
              id={tickId}
              type="checkbox"
              className="mt-[3px] size-4 flex-none accent-[var(--color-accent-ink)]"
              checked={removeAccount}
              disabled={action.busy}
              onChange={(event) => setRemoveAccount(event.currentTarget.checked)}
            />
            <span className="text-[13px] text-[var(--color-heading)]">
              {SESSION_DELETE_ACCOUNT}
            </span>
          </label>
          <FieldHelp title="The account you kept">
            Ticked, this account leaves your journey with the session. Unticked, it stays, marked as
            written from a conversation you have since deleted, so you can change it or remove it
            later. It may be in your own words, which is why you decide.
          </FieldHelp>
        </div>
      ) : null}
      {tried && action.error ? (
        <Banner tone="error" className="mt-2.5" lead="Not deleted.">
          {action.error}
        </Banner>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={action.busy}
          onClick={() => {
            setTried(true);
            void action
              // A draft goes whatever this says (the server drops drafts
              // unasked), so a draft sends false: if it was kept in another
              // tab since this loaded, the account the person never saw a
              // tick for is flagged, not removed.
              .run(() => deleteSession(session.id, kept && removeAccount))
              .then((went) => went && onDeleted());
          }}
        >
          {action.busy ? 'Deleting…' : 'Delete this session'}
        </Button>
        <Button size="sm" variant="ghost" disabled={action.busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
