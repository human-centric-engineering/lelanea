'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchGenerationStatus,
  fetchTranscript,
  fetchVoiceInput,
  type GenerationStatus,
  mintTurnId,
  streamOpening,
  streamTurn,
  TurnRefused,
  type VoiceInputState,
} from '@/lib/app/conversation/client';
import type {
  CeilingFigures,
  ConversationEvent,
  CrisisResource,
} from '@/lib/app/conversation/events';
import { CONVERSATION_SEAT } from '@/lib/app/conversation/seats';
import { OPENING_TURN_ID } from '@/lib/app/conversation/opening-id';
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
import {
  suggestionFromResult,
  uniqueSuggestions,
  type ResourceSuggestion,
} from '@/lib/app/resources/suggestion';
import { SLOT_WRITE_CAPABILITY } from '@/lib/app/slots/notes-view';
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
 * - `live` — the turn in flight, if any: the person's words, the reply so far,
 *   whether it has passed the first-words deadline, and how it ended. On
 *   `done` it is folded into `entries` as a reply; on an ending it becomes an
 *   `ending` entry, which the transcript renders in the pane's ending copy.
 * - `draft` — the composer's text. It clears on `start`, not on send: the
 *   words leave the box only once the server has them (§8.1).
 * - `status` — the last word from the status read, for the line above the
 *   composer.
 *
 * One turn at a time. `send` while one is running is a no-op, the way the
 * prototype's `S.busy` guard makes it; the composer disables its send
 * control to say so.
 *
 * ## When the agent can't answer (t-65)
 *
 * §8.1: *a message that fails to send stays in the box, retryable, with the
 * conversation intact around it.* So on an ending the words go back into the
 * box — not into the transcript as a bubble as well, which would show them
 * twice — and the ending row stands where the reply would have been. The one
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
 * ## The AI speaks first, once (t-122)
 *
 * When the transcript read says `opening`, the hook asks for the AI's opening
 * (`streamOpening`) as soon as the transcript is idle and empty, and asks the
 * read again whenever `checkOpening` changes — the shell bumps it when the
 * journey moves, which is when the hand-off happens. The opening is a live
 * turn like any other, with three differences: there is no bubble of the
 * person's (the words are the app's, and never shown); nothing goes into the
 * box; and an opening that does not complete leaves nothing behind — the
 * person can simply speak, and the next read offers it again if it is still
 * owed. A connection that drops mid-opening reads the transcript again at
 * once: the turn ran on server-side, so the reply is adopted, or asked for. One still running (a reload, a second tab) is asked again every few
 * seconds, showing the thinking row, until it lands as a replay.
 *
 * **The status read** is asked once on mount and again after every ending,
 * never on a timer. `paused` and `unavailable` put a line above the composer;
 * `available`, or a turn that completes, clears it.
 */

export type ConversationPhase = 'loading' | 'idle' | 'sending' | 'thinking' | 'streaming';

/**
 * How a live turn ended without a reply. Client-only; never persisted.
 * `message` is the frame's own words — the neutral contract — which the row
 * replaces with the pane's own copy where it knows the code (`CONVERSATION_COPY.endings`).
 */
export interface EndingEntry {
  kind: 'ending';
  turnId: string;
  code: string;
  message: string;
  /** A hard crisis frame's resource, laid out in place of any ending copy. */
  resource?: CrisisResource;
  /**
   * What a `ceiling_reached` frame carried — spent, limit, reset — for the
   * ending's words about it (`ceilingEnding`, t-96). Absent when the frame's figures did
   * not parse; the row still says what happened.
   */
  ceiling?: CeilingFigures;
}

/**
 * A reply that arrived in this session. `streamed` is what tells the view to
 * pace it as typed; a reply read back on load is shown whole.
 */
export type StreamedReplyEntry = Extract<TranscriptEntry, { kind: 'reply' }> & {
  streamed?: true;
  /** A soft crisis frame that came ahead of the agent's turn, laid out before the reply. */
  resource?: CrisisResource;
  /** Its `message` — the whole resource as text — shown when `resource` did not parse. */
  crisisText?: string;
};

export type ConversationEntry = TranscriptEntry | StreamedReplyEntry | EndingEntry;

export interface LiveTurn {
  turnId: string;
  userText: string;
  /** The reply so far, as the server sent it — the pacing is the view's. */
  replyText: string;
  stillThinking: boolean;
  /** Capability slugs the turn called, for the account row. */
  capabilities: string[];
  /** What the turn offered — a video, audio piece or article, by id (t-77). */
  suggestions: ResourceSuggestion[];
  /** A soft crisis frame shown ahead of the agent's turn. */
  resource?: CrisisResource;
  /** The same frame's `message` — the whole resource as text — shown when `resource` did not parse. */
  crisisText?: string;
  /** The AI's opening (t-122): there are no words of the person's to show. */
  opening?: true;
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
  /** Whether the microphone is offered (t-67); `null` until the route has answered, or when it could not. */
  voiceInput: VoiceInputState | null;
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
  /**
   * A turn ended having written to Lelañea's notes (t-73). Called **once per turn**,
   * whatever the turn wrote and however it ended — the panel re-reads the whole
   * page, so three notes is still one refresh, and a turn that wrote and then
   * failed has still written.
   */
  onSlotsWritten?: () => void;
  /**
   * A turn is over, however it ended (t-95). Called **once per turn**, from
   * `finish` — the one place every outcome passes through — and never per
   * streamed frame, so the spend meter that listens re-reads at most once for
   * each thing a person sends. A turn abandoned by unmounting never finishes,
   * and does not call it.
   */
  onTurnSettled?: () => void;
  /**
   * Ask the transcript read again whether the AI's opening is owed (t-122),
   * whenever this changes. The shell passes its journey-moved count: beginning
   * the journey is what makes the opening owed.
   */
  checkOpening?: number;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

/** How many times an opening that did not land reads the transcript again (t-122). */
export const MAX_OPENING_RECHECKS = 2;

export function useConversation(options: Options = {}): ConversationState {
  const seat = options.seat ?? CONVERSATION_SEAT;
  const fetchImpl = options.fetchImpl;
  const { onSlotsWritten, onTurnSettled, checkOpening } = options;
  // Read through a ref so `send` does not have to be rebuilt when a parent
  // passes a fresh closure — the whole callback list below is a dependency of
  // the composer's `onSend`, and this one changes on every render of the pane.
  const notifySlots = useRef(onSlotsWritten);
  useEffect(() => {
    notifySlots.current = onSlotsWritten;
  }, [onSlotsWritten]);
  const notifyTurn = useRef(onTurnSettled);
  useEffect(() => {
    notifyTurn.current = onTurnSettled;
  }, [onTurnSettled]);

  const [phase, setPhase] = useState<ConversationPhase>('loading');
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [draft, setDraft] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  const [status, setStatus] = useState<GenerationStatus | null>(null);
  const [voiceInput, setVoiceInput] = useState<VoiceInputState | null>(null);
  // The transcript read said the AI's opening is owed (t-122).
  const [openingOwed, setOpeningOwed] = useState(false);
  // Aborted when the seat changes: what was read for one seat is not the next's.
  const seatScope = useRef(new AbortController());
  // How many times an opening that did not land has read the transcript again.
  const openingRechecks = useRef(0);

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

  // A new seat is a different conversation (t-105: onboarding, then the
  // facilitator). Start it from nothing — no entries, no turn, no ending — and
  // loading, so nothing can be sent into the old one's transcript while the new
  // one is read. Adjusted during render rather than in an effect, so the old
  // seat's transcript is never painted under the new seat.
  const [seatShown, setSeatShown] = useState(seat);
  if (seatShown !== seat) {
    setSeatShown(seat);
    setEntries([]);
    setLive(null);
    setUnreadable(false);
    setOpeningOwed(false);
    setPhase('loading');
  }
  // ...and let go of the old seat's turn. It carries on server-side and is
  // recorded in ITS transcript (§08 t-55); here it must not finish into the new
  // one, and its id must not be retried on another seat. Runs on unmount too,
  // which aborts exactly as the effect below already does.
  useEffect(
    () => () => {
      inFlight.current?.abort();
      inFlight.current = null;
      busy.current = false;
      kept.current = null;
      // A re-read for the old seat's opening must not land in the new seat.
      seatScope.current.abort();
      seatScope.current = new AbortController();
      openingRechecks.current = 0;
    },
    [seat]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchTranscript(seat, { signal: controller.signal, fetchImpl })
      .then((transcript) => {
        setEntries(transcript.entries);
        // Only ever raised here: a slower first read must not cancel an
        // opening a newer read already found owed. The seat change clears it.
        if (transcript.opening === true) setOpeningOwed(true);
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

  // Once: whether to offer the microphone. Unanswered means not offered.
  useEffect(() => {
    const controller = new AbortController();
    fetchVoiceInput({ signal: controller.signal, fetchImpl })
      .then((state) => {
        if (!controller.signal.aborted) setVoiceInput(state);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        logger.warn('Voice input availability could not be read', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => controller.abort();
  }, [fetchImpl]);

  // What the transcript holds, readable from a read that lands later.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  /**
   * Read the transcript again for the AI's opening (t-122), while the pane
   * still has nothing in it. An opening that landed meanwhile is adopted; one
   * still owed is asked for. A pane already holding a conversation has nothing
   * to ask.
   */
  const recheckOpening = useCallback(
    (signal?: AbortSignal) => {
      if (seat !== CONVERSATION_SEAT || entriesRef.current.length > 0) return;
      fetchTranscript(seat, { signal, fetchImpl })
        .then((transcript) => {
          if (signal?.aborted || busy.current || entriesRef.current.length > 0) return;
          if (transcript.entries.length > 0) setEntries(transcript.entries);
          else if (transcript.opening === true) setOpeningOwed(true);
        })
        .catch((error: unknown) => {
          if (signal?.aborted) return;
          logger.warn('Opening could not be checked', {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    },
    [seat, fetchImpl]
  );

  /**
   * Run one turn to its end: a member's (`message`, posted with `turnId`), or
   * the AI's opening (`message: null`, t-122). The caller has set `busy`.
   */
  const run = useCallback(
    (turnId: string, message: string | null) => {
      const controller = new AbortController();
      inFlight.current = controller;

      setPhase('sending');
      setLive({
        turnId,
        userText: message ?? '',
        replyText: '',
        stillThinking: false,
        capabilities: [],
        suggestions: [],
        ...(message === null && { opening: true as const }),
      });

      // A turn let go — the pane unmounted, or the seat moved on (t-105) — is
      // no longer this pane's: whatever its stream still delivers is dropped
      // here rather than trusted to stop, because a body read does not always
      // end when its request is aborted.
      const finish = (outcome: ConversationEntry[]) => {
        if (controller.signal.aborted) return;
        setEntries((previous) => [...previous, ...outcome]);
        setLive(null);
        setPhase('idle');
        busy.current = false;
        inFlight.current = null;
        notifyTurn.current?.();
      };

      void (async () => {
        const startedAt = new Date().toISOString();
        let replyText = '';
        let capabilities: string[] = [];
        let suggestions: ResourceSuggestion[] = [];
        /**
         * Tell the notes panel, if this turn wrote one, and tell it once.
         *
         * Read off `capabilities` rather than a flag of its own, because that
         * list is already "the calls that ANSWERED" — a `fill_slot` the
         * platform refused (`tool_not_advertised`), or one that threw, wrote
         * nothing and must not cause a refresh that finds nothing new.
         *
         * A turn settles exactly once — `done` breaks the loop, an `error`
         * frame settles through `end`, and both post-loop paths are guarded by
         * `ended` — so `told` is a belt rather than the mechanism. It is here
         * because "exactly one refresh per turn" is a property the panel
         * depends on, and a future path through this function would not know it
         * had to preserve it.
         */
        let told = false;
        const settled = () => {
          if (told || !capabilities.includes(SLOT_WRITE_CAPABILITY)) return;
          told = true;
          notifySlots.current?.();
        };
        let resource: CrisisResource | undefined;
        let crisisText: string | undefined;
        let citations: Citation[] = [];
        // The person's words, for the transcript. The opening has none.
        const userEntries: TranscriptEntry[] =
          message === null
            ? []
            : [{ kind: 'user', id: `live:${turnId}`, text: message, at: startedAt, turnId }];

        /**
         * A turn that ended without a reply. The words go back into the box —
         * `start` cleared it, and "what you wrote is still in the box" has to
         * be true where the person looks (§8.1) — and the id stays bound to
         * them for the retry, unless a retry could not help. A box already
         * holding a newer thought is left alone, and the words stay in the
         * transcript as their bubble instead, so they are never nowhere.
         */
        const end = (ending: EndingEntry, options: { keepId: boolean; recheck?: boolean }) => {
          // Let go, as `finish` says: not this pane's ending, nor its id to keep.
          if (controller.signal.aborted) return;
          if (message === null) {
            // An opening that did not land leaves nothing: no words of the
            // person's to give back, and an ending row would stand in an
            // empty conversation explaining a turn they never took.
            logger.warn('Conversation opening did not land', { code: ending.code });
            finish([]);
            // A connection that dropped, or an opening still in flight past
            // the client's patience: the turn runs on server-side, so read
            // again — the reply if it landed, the opening again if not. A few
            // times at most, and never after an ending the server chose (an
            // error frame, a refusal): asking again would only meet it again.
            if (options.recheck && openingRechecks.current < MAX_OPENING_RECHECKS) {
              openingRechecks.current += 1;
              recheckOpening(seatScope.current.signal);
            }
          } else {
            const boxed = draftRef.current.trim() === '' || draftRef.current.trim() === message;
            if (boxed) setDraft(message);
            if (options.keepId) kept.current = { turnId, message };
            finish(boxed ? [ending] : [...userEntries, ending]);
          }
          // A turn that captured and then ended without a reply has still written:
          // the note is in the profile, and a panel left stale until the next
          // turn would be showing the person less than the app holds. The
          // retry writes nothing further — `app_turn_slot_write` suppresses a
          // second write under the same turn id (`lib/app/slots/capture.ts`).
          settled();
          refreshStatus();
        };

        const apply = (event: ConversationEvent) => {
          if (controller.signal.aborted) return;
          switch (event.type) {
            case 'start':
              // The server has the words: now they may leave the box.
              if (message !== null) {
                setDraft((current) => (current.trim() === message ? '' : current));
              }
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
                const suggestion = suggestionFromResult(event.result);
                if (suggestion) suggestions = uniqueSuggestions([...suggestions, suggestion]);
                setLive((current) => current && { ...current, capabilities, suggestions });
              }
              return;
            case 'capability_results': {
              const answered = event.results.filter((r) => capabilityAnswered(r.result));
              capabilities = [...capabilities, ...answered.map((r) => r.capabilitySlug)];
              suggestions = uniqueSuggestions([
                ...suggestions,
                ...answered.flatMap((r) => {
                  const suggestion = suggestionFromResult(r.result);
                  return suggestion ? [suggestion] : [];
                }),
              ]);
              setLive((current) => current && { ...current, capabilities, suggestions });
              return;
            }
            case 'citations':
              citations = event.citations;
              return;
            case 'status':
              // The platform's operator strings. Never shown.
              return;
            case 'done':
              // A reply arrived: whatever the status read said, the agent is answering.
              setStatus('available');
              // Before `finish`, so the panel is asked to re-read in the same
              // batch that puts the reply in the transcript — §3.3's pairing is
              // that the consequence appears beside the words, not after them.
              settled();
              finish([
                ...userEntries,
                {
                  kind: 'reply',
                  streamed: true,
                  id: `live:${turnId}:reply`,
                  text: replyText,
                  at: new Date().toISOString(),
                  turnId,
                  citations,
                  capabilities,
                  suggestions,
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
                  ...(event.ceiling ? { ceiling: event.ceiling } : {}),
                },
                // A refused message meets the same refusal again; everything
                // else — a failure, a pause, the ceiling, a hard crisis frame —
                // is answered by the same id once it can be.
                { keepId: event.code !== ENDING_NOT_SENT }
              );
              return;
          }
        };

        const frames = () =>
          message === null
            ? streamOpening({ signal: controller.signal, fetchImpl })
            : streamTurn({ seat, message, turnId, signal: controller.signal, fetchImpl });

        try {
          let ended = false;
          for await (const event of frames()) {
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
              { keepId: true, recheck: true }
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
          if (message !== null) {
            logger.warn('Conversation turn did not run', { seat, code: refused ?? code });
          }
          end(
            { kind: 'ending', turnId, code, message: ENDING_MESSAGES.unavailable },
            {
              keepId: refused !== TURN_ID_REUSED,
              // No answer at all, or one still being answered: worth a read.
              recheck: refused === null || refused === TURN_IN_FLIGHT,
            }
          );
        }
      })();
    },
    [seat, fetchImpl, refreshStatus, recheckOpening]
  );

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
      run(turnId, message);
    },
    [draft, phase, run]
  );

  // The AI's opening (t-122): once the transcript is idle and still empty.
  // `openingOwed` is cleared as it starts, so it is asked for once per read.
  useEffect(() => {
    if (!openingOwed || phase !== 'idle' || entries.length > 0 || busy.current) return;
    if (seat !== CONVERSATION_SEAT) return;
    setOpeningOwed(false);
    busy.current = true;
    run(OPENING_TURN_ID, null);
  }, [openingOwed, phase, entries.length, seat, run]);

  // Ask again whether it is owed when the shell says the journey moved. Not on
  // mount: the transcript read above already answered that.
  const openingChecked = useRef(checkOpening);
  useEffect(() => {
    if (checkOpening === openingChecked.current) return;
    openingChecked.current = checkOpening;
    openingRechecks.current = 0;
    const controller = new AbortController();
    recheckOpening(controller.signal);
    return () => controller.abort();
  }, [checkOpening, recheckOpening]);

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

  return { phase, entries, live, draft, setDraft, unreadable, status, voiceInput, send, revealed };
}
