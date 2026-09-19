'use client';

import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';

import type {
  ConversationEntry,
  ConversationPhase,
  LiveTurn,
} from '@/components/app/conversation/use-conversation';
import {
  CrisisRow,
  EndingRow,
  ReplyTurn,
  ThinkingRow,
  UserTurn,
} from '@/components/app/conversation/turns';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { cn } from '@/lib/utils';

export interface TranscriptProps {
  phase: ConversationPhase;
  entries: ConversationEntry[];
  live: LiveTurn | null;
  unreadable: boolean;
  /** The hook's `revealed`: a reply shown to its end stops being `streamed`. */
  onRevealed?: (turnId: string) => void;
}

/**
 * The transcript: a scroll container at the 604px measure, the turns in
 * order, and whatever the live turn is doing at the foot (§10 t-64).
 *
 * ## One list, and why the keys matter
 *
 * The live turn is rendered as the same `ReplyTurn` the finished reply will
 * be, with the same key (`reply:<turnId>`), so when `done` folds it into
 * `entries` React keeps the element and `useTypedText` keeps its place — the
 * words go on arriving at their pace rather than snapping whole. Replies read
 * back on load are shown whole (`streamed` is not on them).
 *
 * ## Scroll
 *
 * Follows the foot, as the prototype's `scrollLog()` does, whenever a turn is
 * added or her words grow — including the paced reveal, which goes on after
 * the last chunk has landed and which `ReplyTurn` reports through `onGrow`.
 * A reader who has scrolled up to re-read is not pinned there; that
 * refinement is deliberately not in this task.
 */
export function Transcript({ phase, entries, live, unreadable, onRevealed }: TranscriptProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const liveText = live?.replyText ?? '';

  const follow = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(follow, [entries.length, liveText, phase, follow]);

  const empty = phase !== 'loading' && entries.length === 0 && !live;

  // ONE flat array, live turn included. A fragment or a second array beside
  // the map is a different reconciliation slot, and the same key in a
  // different slot is a remount — which is exactly the snap the shared key
  // exists to prevent.
  // A reply still `streamed` is one this session has not yet shown to its end;
  // its turn — the person's words and the reply — is the only thing that rises
  // and types. Once revealed the flag is retired, so a remount (the pane folded
  // and unfolded) paints the turn whole, like the read-back transcript.
  const arriving = new Set(
    entries.flatMap((entry) =>
      entry.kind === 'reply' && 'streamed' in entry ? [entry.turnId] : []
    )
  );
  const nodes: React.ReactNode[] = entries.flatMap((entry, index) => {
    const rise = entry.kind !== 'ending' && entry.turnId !== null && arriving.has(entry.turnId);
    if (entry.kind === 'user') {
      return <UserTurn key={`user:${entry.id}`} text={entry.text} rise={rise} />;
    }
    if (entry.kind === 'ending') {
      return <EndingRow key={`ending:${entry.turnId}:${index}`} message={entry.message} />;
    }
    const turnId = entry.turnId;
    const reply = (
      <ReplyTurn
        key={`reply:${turnId ?? entry.id}`}
        text={entry.text}
        settled
        animate={rise}
        rise={rise}
        onGrow={follow}
        onRevealed={turnId !== null && onRevealed ? () => onRevealed(turnId) : undefined}
      />
    );
    // A soft crisis frame came ahead of her turn: the resource is shown first,
    // whatever her reply then says (safety.md).
    return 'crisisText' in entry && entry.crisisText
      ? [<CrisisRow key={`crisis:${entry.id}`} text={entry.crisisText} />, reply]
      : [reply];
  });
  if (live) {
    nodes.push(<UserTurn key={`user:live:${live.turnId}`} text={live.userText} rise />);
    if (live.crisisText) {
      nodes.push(<CrisisRow key={`crisis:live:${live.turnId}`} text={live.crisisText} />);
    }
    nodes.push(
      live.replyText ? (
        <ReplyTurn
          key={`reply:${live.turnId}`}
          text={live.replyText}
          settled={false}
          animate
          rise
          onGrow={follow}
        />
      ) : (
        <ThinkingRow key={`thinking:${live.turnId}`} stillThinking={live.stillThinking} />
      )
    );
  }

  return (
    <div
      ref={scroller}
      role="log"
      aria-label={CONVERSATION_COPY.transcriptLabel}
      className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-5 pb-2 max-[760px]:px-3.5 max-[760px]:pt-4"
    >
      <div
        className={cn(
          'mx-auto flex w-full max-w-[604px] flex-col gap-5',
          // With nothing to show, the one line sits in the middle of the column
          // as the stub's did; once there is a turn the column is a list.
          (empty || phase === 'loading') && 'flex-1 items-center justify-center text-center'
        )}
      >
        {phase === 'loading' ? (
          <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
            {CONVERSATION_COPY.loading}
          </p>
        ) : null}

        {unreadable && phase !== 'loading' ? (
          <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
            {CONVERSATION_COPY.unreadable}
          </p>
        ) : null}

        {empty && !unreadable ? (
          <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
            {CONVERSATION_COPY.empty}
          </p>
        ) : null}

        {nodes}
      </div>
    </div>
  );
}
