'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import { Card } from '@/components/app/ui/card';
import { deleteModuleExchanges, NotesRefused } from '@/lib/app/slots/notes-client';
import { logger } from '@/lib/logging';

/** What the offer says before it is opened. */
export const MODULE_DELETE_OFFER =
  'You can delete everything you said while you were in this module, and Lelañea’s replies to it.';

/** What deleting a module's worth takes, said before it happens. */
export const MODULE_DELETE_CONFIRM =
  'This deletes what you said while you were in this module and Lelañea’s replies, from the conversation and from everything Lelañea keeps. The notes Lelañea made from it are removed, and so is any recap Lelañea gave of those sessions. An account you kept of one of them stays, marked as written from a conversation you have since deleted. This can’t be undone.';

/**
 * The plain limit of what it covers (t-155). Turns were not stamped with their
 * module before t-152, so anything older is not part of any module's worth.
 */
export const MODULE_DELETE_COVERS =
  'It covers only conversations since Lelañea began noting which module you were in. Anything you said before that can be deleted by session from your journey, or one exchange at a time from your notes.';

/** What stays, said so the person does not think their place was lost. */
export const MODULE_DELETE_KEEPS = 'Where you are in the module stays as it is.';

/** Said once it has gone through. */
export const MODULE_DELETE_DONE = 'Deleted. What you said in this module is gone.';

/**
 * The offer to delete everything the person said in one module, at the foot of
 * its page (f-forget-session t-155), confirmed in place as every destructive
 * step in the app is.
 *
 * The page renders it only for a signed-in person, with how many of their turns
 * are stamped with the module. With none there is nothing to offer, so it
 * renders nothing: never a button that would delete nothing and read as done
 * (`B31`). After a deletion the page re-reads, the count comes back zero, and
 * what stays is the line saying it went.
 */
export function DeleteModuleExchanges({
  moduleSlug,
  exchanges,
}: {
  moduleSlug: string;
  /** How many of the person's turns are stamped with this module. */
  exchanges: number;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [calling, setCalling] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busy = calling || refreshing;

  if (done) {
    return (
      <Banner tone="success" className="max-w-[52rem]">
        {MODULE_DELETE_DONE}
      </Banner>
    );
  }
  if (exchanges === 0) return null;

  async function remove() {
    setCalling(true);
    setError(null);
    try {
      await deleteModuleExchanges(moduleSlug);
      setDone(true);
      startRefresh(() => router.refresh());
    } catch (caught: unknown) {
      if (caught instanceof NotesRefused) {
        setError(caught.message);
        // Nothing left to delete: the page is behind (deleted in another tab).
        if (caught.status === 404) startRefresh(() => router.refresh());
      } else {
        logger.warn('Module deletion failed', {
          error: caught instanceof Error ? caught.message : String(caught),
        });
        setError('That did not go through. Check your connection and try again.');
      }
    } finally {
      setCalling(false);
    }
  }

  return (
    <Card title="What you said here" className="max-w-[52rem]">
      {confirming ? (
        <div role="group" aria-label="Delete what you said in this module?">
          <p className="text-[13.5px] leading-[1.6] text-[var(--color-heading)]">
            {MODULE_DELETE_CONFIRM}
          </p>
          <p className="text-muted-foreground mt-2 text-[13px] leading-[1.6]">
            {MODULE_DELETE_COVERS} {MODULE_DELETE_KEEPS}
          </p>
          {error ? (
            <Banner tone="error" className="mt-2.5" lead="Not deleted.">
              {error}
            </Banner>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void remove()}>
              {busy ? 'Deleting…' : 'Delete what I said here'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3">
          <p className="text-muted-foreground max-w-[52ch] text-[14px] leading-[1.65]">
            {MODULE_DELETE_OFFER}
          </p>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Delete what I said in this module
          </Button>
        </div>
      )}
    </Card>
  );
}
