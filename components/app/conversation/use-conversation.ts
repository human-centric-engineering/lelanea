'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchTranscript,
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
  ENDING_UNAVAILABLE,
  STILL_THINKING,
} from '@/lib/app/agent/endings';
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
 *   `ending` entry, which the transcript renders and t-65 makes retryable.
 * - `draft` — the composer's text. It clears on `start`, not on send: the
 *   words leave the box only once the server has them (§8.1).
 *
 * One turn at a time. `send` while one is running is a no-op, the way the
 * prototype's `S.busy` guard makes it; the composer disables its send
 * control to say so.
 */

export type ConversationPhase = 'loading' | 'idle' | 'sending' | 'thinking' | 'streaming';

/** How a live turn ended without her answer. Client-only; never persisted. */
export interface EndingEntry {
  kind: 'ending';
  turnId: string;
  code: string;
  message: string;
  resource?: CrisisResource;
}

/**
 * A reply that arrived in this session. `streamed` is what tells the view to
 * pace it as typed; a reply read back on load is shown whole.
 */
export type StreamedReplyEntry = Extract<TranscriptEntry, { kind: 'reply' }> & {
  streamed?: true;
  /** A soft crisis frame that came ahead of her turn (laid out by t-65). */
  resource?: CrisisResource;
  /** Its `message`, shown as text meanwhile. */
  crisisText?: string;
};

export type ConversationEntry = TranscriptEntry | StreamedReplyEntry | EndingEntry;

export interface LiveTurn {
  turnId: string;
  userText: string;
  /** Her words so far, as the server sent them — the pacing is the view's. */
  replyText: string;
  stillThinking: boolean;
  /** Capability slugs the turn called, for the drawer (t-66). */
  capabilities: string[];
  /** A soft crisis frame shown ahead of her turn. */
  resource?: CrisisResource;
  /** The same frame's `message` — the whole resource as text — shown until t-65 lays `resource` out. */
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

  // The in-flight request, so an unmount ends it. The turn itself carries on
  // server-side and is recorded (§08 t-55): closing the tab loses nothing.
  const inFlight = useRef<AbortController | null>(null);
  const busy = useRef(false);

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

  useEffect(() => () => inFlight.current?.abort(), []);

  const send = useCallback(
    (text?: string) => {
      const message = (text ?? draft).trim();
      if (!message || busy.current || phase === 'loading') return;
      busy.current = true;

      const turnId = mintTurnId();
      const controller = new AbortController();
      inFlight.current = controller;

      setPhase('sending');
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
         * A turn that ended without her. The words go back into the box if
         * it is empty — `start` cleared it, and "your message is kept" has to
         * be true where the person looks for it (§8.1). Found looking at it:
         * with no provider the server sends `start` and then the ending, and
         * the box sat empty under a line saying the message was kept. The
         * retry under the same turn id is t-65's.
         */
        const end = (ending: EndingEntry) => {
          setDraft((current) => (current.trim() ? current : message));
          finish([userEntry, ending]);
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
              capabilities = [...capabilities, event.capabilitySlug];
              setLive((current) => current && { ...current, capabilities });
              return;
            case 'capability_results':
              capabilities = [...capabilities, ...event.results.map((r) => r.capabilitySlug)];
              setLive((current) => current && { ...current, capabilities });
              return;
            case 'citations':
              citations = event.citations;
              return;
            case 'status':
              // The platform's operator strings. Never shown.
              return;
            case 'done':
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
              end({
                kind: 'ending',
                turnId,
                code: event.code,
                message: event.message,
                ...(event.resource ? { resource: event.resource } : {}),
              });
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
            // dropped. The turn goes on server-side and the id can be sent
            // again to get the whole answer (t-65).
            end({
              kind: 'ending',
              turnId,
              code: ENDING_UNAVAILABLE,
              message: ENDING_MESSAGES.unavailable,
            });
          }
        } catch (error: unknown) {
          if (controller.signal.aborted) return;
          const code = error instanceof TurnRefused ? error.code : ENDING_UNAVAILABLE;
          logger.warn('Conversation turn did not run', { seat, code });
          end({ kind: 'ending', turnId, code, message: ENDING_MESSAGES.unavailable });
        }
      })();
    },
    [draft, phase, seat, fetchImpl]
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

  return { phase, entries, live, draft, setDraft, unreadable, send, revealed };
}
