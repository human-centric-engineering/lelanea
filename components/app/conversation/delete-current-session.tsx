'use client';

import { MoreHorizontal } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { SESSION_DELETE_CONFIRM } from '@/components/app/journey/delete-session';
import { ICON_RADIUS } from '@/components/app/shell/chrome';
import { Banner } from '@/components/app/ui/banner';
import { Button } from '@/components/app/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type CurrentSession,
  deleteSession,
  fetchCurrentSession,
  JourneyRefused,
} from '@/lib/app/journey-record/client';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

/** Said once it has gone through, until the person next speaks. */
export const CURRENT_SESSION_DELETED = 'Deleted. What you said in this session is gone.';

/** The menu item, and the confirm's button. */
export const DELETE_THIS_SESSION = 'Delete this session';

export interface CurrentSessionOffer {
  /** The current session has something of the person's in it, and nothing is running. */
  offered: boolean;
  confirming: boolean;
  /** The delete is out, or the re-reads after it. */
  busy: boolean;
  /** What the delete's refusal said, written to be shown. */
  error: string | null;
  /** It went through, and the person has not spoken since. */
  done: boolean;
  open: () => void;
  cancel: () => void;
  confirm: () => void;
}

interface OfferOptions {
  /** The shell's settled-turn count: a turn may have put the person's words in the session. */
  turnsSettled: number;
  /** A turn is running: the server would refuse the delete, so it is not offered. */
  turnRunning: boolean;
  /** The person has sent something: the line saying a deletion went is retired. */
  personSpoke: boolean;
  /** It went through: whatever shows the session must read again. */
  onDeleted: () => void;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/**
 * The offer to delete the session the person is in, from the conversation
 * pane (f-forget-session t-158; owner ruling, 8 Oct 2026).
 *
 * The journey view offers it on synopsis stops only, and the current session
 * has none until it closes. Here the pane reads which session is current, and
 * whether the person has said anything in it, on mount and again after every
 * turn: a sitting that had nothing in it a moment ago may have now, and one
 * that went quiet may have been replaced by a new one.
 *
 * The delete is t-154's, with its confirm copy and its refusals: a turn still
 * being answered is a 409 whose words say to wait. The current session never
 * has a kept account (it is drafted when it closes), so there is no tick, and
 * it sends `removeAccount: false`: if it has closed and been kept since this
 * read, the account the person never saw a tick for is flagged, not removed.
 */
export function useCurrentSessionOffer({
  turnsSettled,
  turnRunning,
  personSpoke,
  onDeleted,
  fetchImpl,
}: OfferOptions): CurrentSessionOffer {
  const router = useRouter();
  const [session, setSession] = useState<CurrentSession>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reads can overlap (on mount, after each turn, after a delete), and a slow
  // early one must not land over a later one: only the newest read's answer
  // is kept.
  const latestRead = useRef(0);
  const read = useCallback(async () => {
    const seq = ++latestRead.current;
    const stillLatest = () => mounted.current && seq === latestRead.current;
    try {
      const current = await fetchCurrentSession({ fetchImpl });
      if (stillLatest()) setSession(current);
    } catch (caught: unknown) {
      // No offer is the honest answer to a read that failed.
      logger.warn('Current session could not be read', {
        error: caught instanceof Error ? caught.message : String(caught),
      });
      if (stillLatest()) setSession(null);
    }
  }, [fetchImpl]);

  // On mount, and after every turn.
  useEffect(() => {
    void read();
  }, [turnsSettled, read]);

  // The person speaking retires the line saying the deletion went, and a
  // refusal left standing. Not any turn: the recap the emptied session is
  // owed runs straight after a deletion.
  if (personSpoke && (done || error !== null)) {
    setDone(false);
    setError(null);
  }

  const confirm = useCallback(() => {
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    void deleteSession(session.id, false, { fetchImpl })
      .then(async () => {
        if (!mounted.current) return;
        setConfirming(false);
        setDone(true);
        onDeleted();
        router.refresh();
        await read();
      })
      .catch(async (caught: unknown) => {
        if (!mounted.current) return;
        if (caught instanceof JourneyRefused) {
          setError(caught.message);
          // Not found: the session the pane read is not this person's current
          // one any more. Read again, which withdraws or renews the offer.
          if (caught.status === 404) await read();
        } else {
          logger.warn('Current session deletion failed', {
            error: caught instanceof Error ? caught.message : String(caught),
          });
          setError('That did not go through. Check your connection and try again.');
        }
      })
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  }, [session, busy, fetchImpl, onDeleted, router, read]);

  const offered = session?.hasTurns === true && !turnRunning;
  // A confirm left open while a turn began, or after the offer went, closes:
  // it is never shown again unasked. A refusal it was showing stays said
  // (`CurrentSessionConfirm`), since a 404 that withdrew the offer is the
  // only word the person gets on why nothing was deleted.
  if (confirming && !offered && !busy) setConfirming(false);
  return {
    offered,
    confirming: confirming && (offered || busy),
    busy,
    error,
    done,
    open: () => {
      setError(null);
      setDone(false);
      setConfirming(true);
    },
    cancel: () => {
      setConfirming(false);
      setError(null);
    },
    confirm,
  };
}

/** The pane head's quiet menu, holding the offer. Renders nothing when there is none. */
export function CurrentSessionMenu({ offer }: { offer: CurrentSessionOffer }) {
  if (!offer.offered) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Conversation options"
        title="Conversation options"
        className={cn(
          'text-muted-foreground hover:text-foreground ml-auto flex h-8 w-8 flex-none',
          'items-center justify-center',
          ICON_RADIUS,
          'hover:bg-[var(--color-pill-hover)]',
          'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]'
        )}
      >
        <MoreHorizontal size={17} strokeWidth={1.6} aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={offer.busy} onSelect={offer.open}>
          {DELETE_THIS_SESSION}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The confirmation, asked in place under the pane's head as every destructive
 * step in the app is, and the line saying it went.
 */
export function CurrentSessionConfirm({ offer }: { offer: CurrentSessionOffer }) {
  if (offer.done && !offer.confirming) {
    return (
      <div className="flex-none px-6 pt-2 max-[760px]:px-3.5">
        <Banner tone="success">{CURRENT_SESSION_DELETED}</Banner>
      </div>
    );
  }
  if (!offer.confirming) {
    return offer.error ? (
      <div className="flex-none px-6 pt-2 max-[760px]:px-3.5">
        <Banner tone="info" lead="Not deleted.">
          {offer.error}
        </Banner>
      </div>
    ) : null;
  }
  return (
    <div
      className="flex-none px-6 pt-2 max-[760px]:px-3.5"
      role="group"
      aria-label="Delete this session?"
    >
      <p className="text-[13.5px] leading-[1.6] text-[var(--color-heading)]">
        {SESSION_DELETE_CONFIRM}
      </p>
      {offer.error ? (
        <Banner tone="error" className="mt-2.5" lead="Not deleted.">
          {offer.error}
        </Banner>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="destructive" disabled={offer.busy} onClick={offer.confirm}>
          {offer.busy ? 'Deleting…' : DELETE_THIS_SESSION}
        </Button>
        <Button size="sm" variant="ghost" disabled={offer.busy} onClick={offer.cancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
