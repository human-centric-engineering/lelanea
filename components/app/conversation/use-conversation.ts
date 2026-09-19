'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchGenerationStatus,
  fetchTranscript,
  type GenerationStatus,
  mintTurnId,
  streamTurn,
  TurnRefused,
} from '@/lib/app/conversation/client';
import type { ConversationEvent, CrisisResource } from '@/lib/app/conversation/events';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import type { TranscriptEntry } from '@/lib/app/conversation/transcript';
import {
  ENDING_CRISIS,
  ENDING_MESSAGES,
  ENDING_NOT_SENT,
  ENDING_UNAVAILABLE,
  STILL_THINKING,
} from '@/lib/app/agent/endings';
import { TURN_ID_REUSED, TURN_IN_FLIGHT } from '@/lib/app/agent/turn-codes';
import { capabilityAnswered } from '@/lib/app/agent/capability-answers';
import { logger } from '@/lib/logging';
import type { Citation } from '@/types/orchestration';

/**
 * The state of the conversation, held in one place (§10 t-64).
 *
 * ## Where it lives, and why
 *
 * `ConversationPane` is mounted once, in the `(lelanea)/app` layout, for every
 * route in the group — so a turn survives navigating to a module. But the
 * pane's folded state is an early `return <Strip />`, which unmounts the
 * transcript and the composer. State kept in either would be lost the moment
 * a person folded the pane mid-answer. So this hook is called by the pane
 * itself, above that return, and the transcript and composer are views over
 * it (reconciliation hypothesis a).
 *
 * ## The shape
 *
 * - `entries` — what the read route returned, plus every turn finished since.
 * - `live` — the turn in flight, if any: the person's words, hers so far,
 *   whether she has passed the first-words deadline, and how it ended. On
 *   `done` it is folded into `entries` as a reply; on an ending it becomes an
 *   `ending` entry, which the transcript renders in her words.
 * - `draft` — the composer's text. It clears on `start`, not on send: the
 *   words leave the box only once the server has them (§8.1).
 * - `status` — the last word from the status read, for the line above the
 *   composer.
 *
 * One turn at a time. `send` while one is running is a no-op, the way the
 * prototype's `S.busy` guard makes it; the composer disables its send
 * control to say so.
 *
 * ## When she can't answer (t-65)
 *
 * §8.1: *a message that fails to send stays in the box, retryable, with the
 * conversation intact around it.* So on an ending the words go back into the
 * box — not into the transcript as a bubble as well, which would show them
 * twice — and the ending row stands where her reply would have been. The one
 * exception is a box already holding a newer thought: that draft is not
 * overwritten, so the failed words stay in the transcript as their bubble.
 *
 * **A second try is the same turn.** The turn id stays bound to the words
 * (`kept`), and `send` with the same words posts the same id: the seam replays
 * a turn that completed after the connection dropped, and re-runs one that
 * failed (§08 t-54). Different words are a different turn and mint a new id —
 * which is why `TURN_ID_REUSED` cannot happen from here, and is read as
 * `unavailable` with the id dropped if it ever does. `TURN_IN_FLIGHT` means
 * the earlier request is still being answered: the id is kept and no new one
 * is minted. `not_sent` keeps no id — a retry meets the same refusal.
 *
 * On a retry the earlier attempt's ending row is removed: the retry
 * supersedes it, as the transcript read collapses the attempts to one.
 *
 * **The status read** is asked once on mount and again after every ending,
 * never on a timer. `paused` and `unavailable` put a line above the composer;
 * `available`, or a turn that completes, clears it.
 */

export type ConversationPhase = 'loading' | 'idle' | 'sending' | 'thinking' | 'streaming';

/**
 * How a live turn ended without her answer. Client-only; never persisted.
 * `message` is the frame's own words — the neutral contract — which the row
 * replaces with hers where it knows the code (`CONVERSATION_COPY.endings`).
 */
export interface EndingEntry {
  kind: 'ending';
  turnId: string;
  code: string;
  message: string;
  /** A hard crisis frame's resource, laid out in place of any words of hers. */
  resource?: CrisisResource;
}

/**
 * A reply that arrived in this session. `streamed` is what tells the view to
 * pace it as typed; a reply read back on load is shown whole.
 */
export type StreamedReplyEntry = Extract<TranscriptEntry, { kind: 'reply' }> & {
  streamed?: true;
  /** A soft crisis frame that came ahead of her turn, laid out before the reply. */
  resource?: CrisisResource;
  /** Its `message` — the whole resource as text — shown when `resource` did not parse. */
  crisisText?: string;
};

export type ConversationEntry = TranscriptEntry | StreamedReplyEntry | EndingEntry;

export interface LiveTurn {
  turnId: string;
  userText: string;
  /** Her words so far, as the server sent them — the pacing is the view's. */
  replyText: string;
  stillThinking: boolean;
  /** Capability slugs the turn called, for the account row. */
  capabilities: string[];
  /** A soft crisis frame shown ahead of her turn. */
  resource?: CrisisResource;
  /** The same frame's `message` — the whole resource as text — shown when `resource` did not parse. */
  crisisText?: string;
}

export interface ConversationState {
  phase: ConversationPhase;
  entries: ConversationEntry[];
  live: LiveTurn | null;
  draft: string;
  setDraft: (text: string) => void;
  /** Whether the transcript could not be read back. The composer still works. */
  unreadable: boolean;
  /** The status read's last word; `null` until it has answered, or when it could not. */
  status: GenerationStatus | null;
  send: (text?: string) => void;
  /**
   * The view has shown this turn's reply to its end. Retires `streamed` on
   * the entry, so a remount — the pane folded and unfolded — shows it whole
   * rather than typing it out again (review round 2).
   */
  revealed: (turnId: string) => void;
}

interface Options {
  seat?: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export function useConversation(options: Options = {}): ConversationState {
  const seat = options.seat ?? CONVERSATION_SEAT;
  const fetchImpl = options.fetchImpl;

  const [phase, setPhase] = useState<ConversationPhase>('loading');
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [draft, setDraft] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  const [status, setStatus] = useState<GenerationStatus | null>(null);

  // The in-flight request, so an unmount ends it. The turn itself carries on
  // server-side and is recorded (§08 t-55): closing the tab loses nothing.
  const inFlight = useRef<AbortController | null>(null);
  const busy = useRef(false);
  // The words a turn ended on, and the id they are bound to: sent again as
  // they are, they post the same id.
  const kept = useRef<{ turnId: string; message: string } | null>(null);
  const mounted = useRef(true);
  // What the box holds, readable from inside a turn's closure.
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  const refreshStatus = useCallback(() => {
    fetchGenerationStatus({ fetchImpl })
      .then((generation) => {
        if (mounted.current) setStatus(generation);
      })
      .catch((error: unknown) => {
        // No news — the line is a courtesy, and a turn is still tried.
        logger.warn('Generation status could not be read', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [fetchImpl]);

  useEffect(() => {
    const controller = new AbortController();
    fetchTranscript(seat, { signal: controller.signal, fetchImpl })
      .then((transcript) => {
        setEntries(transcript.entries);
        setPhase('idle');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.warn('Conversation transcript could not be read', {
          seat,
          error: error instanceof Error ? error.message : String(error),
        });
        setUnreadable(true);
        setPhase('idle');
      });
    return () => controller.abort();
  }, [seat, fetchImpl]);

  useEffect(() => {
    mounted.current = true;
    refreshStatus();
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, [refreshStatus]);

  const send = useCallback(
    (text?: string) => {
      const message = (text ?? draft).trim();
      if (!message || busy.current || phase === 'loading') return;
      busy.current = true;

      // The same words as the turn that ended: the same id, so the seam
      // replays or re-runs it. Anything else is a new turn.
      const retry = kept.current?.message === message ? kept.current.turnId : null;
      const turnId = retry ?? mintTurnId();
      kept.current = null;
      const controller = new AbortController();
      inFlight.current = controller;

      setPhase('sending');
      if (retry) {
        // The retry supersedes the earlier attempt's row (and its bubble, if
        // the words had stayed in the transcript).
        setEntries((previous) =>
          previous.filter(
            (entry) =>
              !(entry.kind === 'ending' && entry.turnId === retry) &&
              !(entry.kind === 'user' && entry.id === `live:${retry}`)
          )
        );
      }
      setLive({ turnId, userText: message, replyText: '', stillThinking: false, capabilities: [] });

      const finish = (outcome: ConversationEntry[]) => {
        setEntries((previous) => [...previous, ...outcome]);
        setLive(null);
        setPhase('idle');
        busy.current = false;
        inFlight.current = null;
      };

      void (async () => {
        const startedAt = new Date().toISOString();
        let replyText = '';
        let capabilities: string[] = [];
        let resource: CrisisResource | undefined;
        let crisisText: string | undefined;
        let citations: Citation[] = [];
        const userEntry: TranscriptEntry = {
          kind: 'user',
          id: `live:${turnId}`,
          text: message,
          at: startedAt,
          turnId,
        };

        /**
         * A turn that ended without her. The words go back into the box —
         * `start` cleared it, and "what you wrote is still in the box" has to
         * be true where the person looks (§8.1) — and the id stays bound to
         * them for the retry, unless a retry could not help. A box already
         * holding a newer thought is left alone, and the words stay in the
         * transcript as their bubble instead, so they are never nowhere.
         */
        const end = (ending: EndingEntry, options: { keepId: boolean }) => {
          const boxed = draftRef.current.trim() === '' || draftRef.current.trim() === message;
          if (boxed) setDraft(message);
          if (options.keepId) kept.current = { turnId, message };
          finish(boxed ? [ending] : [userEntry, ending]);
          refreshStatus();
        };

        const apply = (event: ConversationEvent) => {
          switch (event.type) {
            case 'start':
              // The server has the words: now they may leave the box.
              setDraft((current) => (current.trim() === message ? '' : current));
              setPhase('thinking');
              return;
            case 'content':
              replyText += event.delta;
              setPhase('streaming');
              setLive((current) => current && { ...current, replyText });
              return;
            case 'content_reset':
              replyText = '';
              setLive((current) => current && { ...current, replyText });
              return;
            case 'warning':
              if (event.code === STILL_THINKING) {
                setLive((current) => current && { ...current, stillThinking: true });
              } else if (event.code === ENDING_CRISIS) {
                // The resource, structured when it parsed; its `message` is
                // the whole resource as text either way, and is what shows.
                resource = event.resource;
                crisisText = event.message;
                setLive((current) => current && { ...current, resource, crisisText });
              }
              return;
            case 'capability_result':
              // Only a call that answered is something the turn did.
              if (capabilityAnswered(event.result)) {
                capabilities = [...capabilities, event.capabilitySlug];
                setLive((current) => current && { ...current, capabilities });
              }
              return;
            case 'capability_results':
              capabilities = [
                ...capabilities,
                ...event.results
                  .filter((r) => capabilityAnswered(r.result))
                  .map((r) => r.capabilitySlug),
              ];
              setLive((current) => current && { ...current, capabilities });
              return;
            case 'citations':
              citations = event.citations;
              return;
            case 'status':
              // The platform's operator strings. Never shown.
              return;
            case 'done':
              // A reply arrived: whatever the status read said, she is answering.
              setStatus('available');
              finish([
                userEntry,
                {
                  kind: 'reply',
                  streamed: true,
                  id: `live:${turnId}:reply`,
                  text: replyText,
                  at: new Date().toISOString(),
                  turnId,
                  citations,
                  capabilities,
                  ...(resource ? { resource } : {}),
                  ...(crisisText ? { crisisText } : {}),
                  turn: {
                    turnId,
                    seat,
                    status: 'completed',
                    attempts: 1,
                    modelId: event.model ?? null,
                    providerSlug: event.provider ?? null,
                    // Not on the wire; the read route has it on reload.
                    fingerprintVersion: null,
                    inputTokens: event.tokenUsage?.inputTokens ?? null,
                    outputTokens: event.tokenUsage?.outputTokens ?? null,
                    // A replay's `done` says `0` for an unpriced turn (turns.ts),
                    // and `0` reads as free. Unknown until the read route has
                    // the row; the turn row is what says whether it was priced.
                    costUsd: event.costUsd ? event.costUsd : null,
                    pricing: null,
                    errorCode: null,
                    startedAt,
                    completedAt: new Date().toISOString(),
                  },
                },
              ]);
              return;
            case 'error':
              end(
                {
                  kind: 'ending',
                  turnId,
                  code: event.code,
                  message: event.message,
                  ...(event.resource ? { resource: event.resource } : {}),
                },
                // A refused message meets the same refusal again; everything
                // else — a failure, a pause, the ceiling, a hard crisis frame —
                // is answered by the same id once it can be.
                { keepId: event.code !== ENDING_NOT_SENT }
              );
              return;
          }
        };

        try {
          let ended = false;
          for await (const event of streamTurn({
            seat,
            message,
            turnId,
            signal: controller.signal,
            fetchImpl,
          })) {
            apply(event);
            if (event.type === 'done' || event.type === 'error') {
              ended = true;
              break;
            }
          }
          if (!ended) {
            // The stream closed with no terminal frame — a connection that
            // dropped. The turn goes on server-side and the same id gets the
            // whole answer: a replay if it completed, a re-run if it failed.
            end(
              {
                kind: 'ending',
                turnId,
                code: ENDING_UNAVAILABLE,
                message: ENDING_MESSAGES.unavailable,
              },
              { keepId: true }
            );
          }
        } catch (error: unknown) {
          if (controller.signal.aborted) return;
          // A refusal before any frame, or a network failure before one: the
          // same path as `unavailable`, except that `TURN_IN_FLIGHT` keeps its
          // own words (the earlier request is still being answered) and
          // `TURN_ID_REUSED` — which this client cannot produce — drops the id.
          const refused = error instanceof TurnRefused ? error.code : null;
          const code = refused === TURN_IN_FLIGHT ? TURN_IN_FLIGHT : ENDING_UNAVAILABLE;
          logger.warn('Conversation turn did not run', { seat, code: refused ?? code });
          end(
            { kind: 'ending', turnId, code, message: ENDING_MESSAGES.unavailable },
            { keepId: refused !== TURN_ID_REUSED }
          );
        }
      })();
    },
    [draft, phase, seat, fetchImpl, refreshStatus]
  );

  const revealed = useCallback((turnId: string) => {
    setEntries((previous) => {
      const index = previous.findIndex(
        (entry) => entry.kind === 'reply' && entry.turnId === turnId && 'streamed' in entry
      );
      // Already retired: the same state back, so nothing re-renders.
      if (index === -1) return previous;
      const entry = previous[index];
      if (entry.kind !== 'reply' || !('streamed' in entry)) return previous;
      const { streamed: _streamed, ...rest } = entry;
      return [...previous.slice(0, index), rest, ...previous.slice(index + 1)];
    });
  }, []);

  return { phase, entries, live, draft, setDraft, unreadable, status, send, revealed };
}
