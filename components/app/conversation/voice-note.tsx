'use client';

import { Loader2, Mic, Square } from 'lucide-react';
import * as React from 'react';

import { transcribeClip, TurnRefused } from '@/lib/app/conversation/client';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { useVoiceRecording } from '@/lib/hooks/use-voice-recording';
import { cn } from '@/lib/utils';

/**
 * The microphone in the composer's foot (§10 t-67; product description §3.3).
 *
 * Press to record, press to stop; the clip goes to the member transcribe
 * route and the words land in the box for the person to read, edit, and
 * send — or not. **Never sent for them.** The recording goes nowhere: the
 * route hands it to the provider and discards it, and the control's own name
 * says so, because that is the fact a person wants before they speak about
 * their marriage into it (owner ruling, 19 Sept 2026).
 *
 * ## Re-derived from the admin `MicButton`, not imported (`fp5`)
 *
 * The platform's control is admin-styled, carries admin copy, a level meter
 * and a one-time hint in `localStorage`. What transfers is the mechanism —
 * `useVoiceRecording`, the platform's `MediaRecorder` lifecycle hook, which
 * picks a supported MIME, clamps the length under the server's cap and tells
 * a denied permission apart from a failed capture. Ours is one disc that
 * changes glyph: the mic, a square while recording, a spinner while the
 * words are on their way.
 *
 * ## Degrading, not erroring
 *
 * A browser with no `MediaRecorder` gets the disabled disc with its reason as
 * its name — the same state the stub shipped with, now honest about why. One
 * that was told no at the permission prompt keeps the disc live, named with
 * that reason: Chrome reports a *dismissed* prompt the same way as a refused
 * one, so a press has to be able to ask again (review round 1). A clip that
 * could not be transcribed leaves the box untouched and says so in the
 * status row; the disc is live again for another go.
 *
 * ## The two-minute cap is ours to enforce
 *
 * The hook's own auto-stop calls `stop()` and drops the clip on the floor —
 * nothing holds the promise. So the cap is watched here, from `elapsedMs`,
 * and the stop is ours, which sends the clip; the hook's is set a little
 * later so it never wins. While a turn is in flight only *starting* is
 * refused — a recording under way can always be stopped.
 *
 * Whether the control is offered at all — the two switches, a provider — is
 * the composer's question, asked of the route once, on mount. A switch turned
 * off while the pane is open answers the next clip with `VOICE_DISABLED` (or
 * `NO_AUDIO_PROVIDER`); the control withdraws itself then, saying so once,
 * rather than inviting a retry that cannot succeed (review round 2).
 *
 * A transcription in flight is not aborted on unmount: the pane's composer
 * unmounts when the pane is parked on a tablet, and the words are the
 * person's — paid for, and the draft they land in lives above the pane. The
 * only thing the unmount stops is this component's own state.
 */

const MAX_CLIP_MS = 120_000;
/** A clip too short to hold a word is not sent: the mic was pressed twice. */
const MIN_CLIP_MS = 300;

export interface VoiceNoteProps {
  /** The words, for the box. Called once per clip, never with an empty string. */
  onText: (text: string) => void;
  /** A turn is in flight: nothing records. */
  disabled?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'failed' | 'unreachable' | 'withdrawn';

/** Refusals that mean the control should not be here any more. */
const WITHDRAWING_CODES = new Set(['VOICE_DISABLED', 'NO_AUDIO_PROVIDER']);

export function VoiceNote({ onText, disabled, fetchImpl }: VoiceNoteProps) {
  // The hook's cap sits behind ours, so ours — which sends the clip — fires first.
  const recording = useVoiceRecording({ maxDurationMs: MAX_CLIP_MS + 5_000 });
  const [phase, setPhaseState] = React.useState<Phase>('idle');
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const setPhase = React.useCallback((next: Phase) => {
    if (mounted.current) setPhaseState(next);
  }, []);

  // The hook's state is the truth about the recorder; ours is about the words.
  const isRecording = recording.state === 'recording' || recording.state === 'stopping';
  const denied = recording.error?.code === 'permission_denied';
  const cannot = !recording.supported;

  const send = React.useCallback(
    async (clip: { blob: Blob; mimeType: string; durationMs: number }) => {
      if (clip.durationMs < MIN_CLIP_MS || clip.blob.size === 0) {
        setPhase('idle');
        return;
      }
      setPhase('transcribing');
      try {
        const text = (await transcribeClip(clip, { fetchImpl })).trim();
        if (text) onText(text);
        setPhase('idle');
      } catch (error) {
        const code = error instanceof TurnRefused ? error.code : null;
        setPhase(code !== null && WITHDRAWING_CODES.has(code) ? 'withdrawn' : 'failed');
      }
    },
    [fetchImpl, onText, setPhase]
  );

  const stopAndSend = React.useCallback(async () => {
    const clip = await recording.stop();
    if (clip) await send(clip);
    else setPhase('failed');
  }, [recording, send, setPhase]);

  const press = async () => {
    if (isRecording) {
      await stopAndSend();
      return;
    }
    if (disabled) return;
    setPhase('idle');
    await recording.start();
  };

  // The cap, watched from here so the clip is sent rather than dropped.
  const stopping = React.useRef(false);
  React.useEffect(() => {
    if (recording.state !== 'recording') {
      stopping.current = false;
      return;
    }
    if (recording.elapsedMs >= MAX_CLIP_MS && !stopping.current) {
      stopping.current = true;
      void stopAndSend();
    }
  }, [recording.state, recording.elapsedMs, stopAndSend]);

  // The hook's `capture_failed` covers both a microphone that could not be
  // reached at all (held by another app, no device) and a recorder that failed
  // mid-clip. Either way no clip was made, so the words are about the
  // microphone, not about a clip that could not be transcribed.
  React.useEffect(() => {
    if (recording.error?.code === 'capture_failed') setPhase('unreachable');
  }, [recording.error, setPhase]);

  if (phase === 'withdrawn') {
    return (
      <span role="status" className="text-muted-foreground text-[12px] leading-[1.5]">
        {CONVERSATION_COPY.micWithdrawn}
      </span>
    );
  }

  const label = cannot
    ? CONVERSATION_COPY.micUnsupported
    : isRecording
      ? CONVERSATION_COPY.micStop
      : denied
        ? CONVERSATION_COPY.micDenied
        : CONVERSATION_COPY.mic;

  const seconds = Math.floor(recording.elapsedMs / 1000);
  const status =
    phase === 'transcribing'
      ? CONVERSATION_COPY.micTranscribing
      : phase === 'failed'
        ? CONVERSATION_COPY.micFailed
        : phase === 'unreachable'
          ? CONVERSATION_COPY.micUnreachable
          : isRecording
            ? `${CONVERSATION_COPY.micRecording} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
            : null;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => void press()}
        // A recording under way can always be stopped; only starting waits on a turn.
        disabled={cannot || phase === 'transcribing' || (disabled && !isRecording)}
        aria-label={label}
        title={label}
        aria-pressed={isRecording}
        className={cn(
          'flex h-9 w-9 flex-none items-center justify-center rounded-full',
          'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]',
          isRecording
            ? 'bg-[var(--color-secondary-wash)] text-[var(--color-secondary-ink)]'
            : 'text-muted-foreground hover:text-foreground hover:bg-[var(--color-pill-hover)]',
          'disabled:opacity-50 disabled:hover:bg-transparent'
        )}
      >
        {phase === 'transcribing' ? (
          <Loader2 size={18} strokeWidth={1.5} aria-hidden="true" className="animate-spin" />
        ) : isRecording ? (
          <Square size={16} strokeWidth={1.7} aria-hidden="true" />
        ) : (
          <Mic size={18} strokeWidth={1.5} aria-hidden="true" />
        )}
      </button>
      {status ? (
        <span
          role="status"
          className="text-muted-foreground min-w-0 truncate text-[12px] leading-[1.5]"
        >
          {status}
        </span>
      ) : null}
    </span>
  );
}
