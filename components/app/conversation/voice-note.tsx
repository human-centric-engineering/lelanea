'use client';

import { Loader2, Mic, Square } from 'lucide-react';
import * as React from 'react';

import { transcribeClip } from '@/lib/app/conversation/client';
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
 * A browser with no `MediaRecorder`, or one that was told no at the
 * permission prompt, gets the disabled disc with its reason as its name — the
 * same state the stub shipped with, now honest about why. A clip that could
 * not be transcribed leaves the box untouched and says so in the status row;
 * the disc is live again for another go.
 *
 * Whether the control is offered at all — the two switches, a provider — is
 * the composer's question, asked of the route; this component assumes yes.
 */

const MAX_CLIP_MS = 120_000;

export interface VoiceNoteProps {
  /** The words, for the box. Called once per clip, never with an empty string. */
  onText: (text: string) => void;
  /** A turn is in flight: nothing records. */
  disabled?: boolean;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

type Phase = 'idle' | 'recording' | 'transcribing' | 'failed';

export function VoiceNote({ onText, disabled, fetchImpl }: VoiceNoteProps) {
  const recording = useVoiceRecording({ maxDurationMs: MAX_CLIP_MS });
  const [phase, setPhase] = React.useState<Phase>('idle');
  const inFlight = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => inFlight.current?.abort(), []);

  // The hook's state is the truth about the recorder; ours is about the words.
  const isRecording = recording.state === 'recording' || recording.state === 'stopping';
  const denied = recording.error?.code === 'permission_denied';
  const cannot = !recording.supported || denied;

  /** A clip too short to hold a word is not sent: the mic was pressed twice. */
  const MIN_CLIP_MS = 300;

  const send = React.useCallback(
    async (clip: { blob: Blob; mimeType: string; durationMs: number }) => {
      if (clip.durationMs < MIN_CLIP_MS || clip.blob.size === 0) {
        setPhase('idle');
        return;
      }
      setPhase('transcribing');
      const controller = new AbortController();
      inFlight.current = controller;
      try {
        const text = (await transcribeClip(clip, { signal: controller.signal, fetchImpl })).trim();
        if (controller.signal.aborted) return;
        if (text) onText(text);
        setPhase('idle');
      } catch {
        if (controller.signal.aborted) return;
        setPhase('failed');
      } finally {
        inFlight.current = null;
      }
    },
    [fetchImpl, onText]
  );

  const press = async () => {
    if (isRecording) {
      const clip = await recording.stop();
      if (clip) await send(clip);
      else setPhase('failed');
      return;
    }
    setPhase('idle');
    await recording.start();
  };

  // The hook reports a capture that failed after it began; treat as a clip that did not arrive.
  React.useEffect(() => {
    if (recording.error?.code === 'capture_failed') setPhase('failed');
  }, [recording.error]);

  const label = cannot
    ? denied
      ? CONVERSATION_COPY.micDenied
      : CONVERSATION_COPY.micUnsupported
    : isRecording
      ? CONVERSATION_COPY.micStop
      : CONVERSATION_COPY.mic;

  const seconds = Math.floor(recording.elapsedMs / 1000);
  const status =
    phase === 'transcribing'
      ? CONVERSATION_COPY.micTranscribing
      : phase === 'failed'
        ? CONVERSATION_COPY.micFailed
        : isRecording
          ? `${CONVERSATION_COPY.micRecording} · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
          : null;

  return (
    <span className="flex min-w-0 items-center gap-2">
      <button
        type="button"
        onClick={() => void press()}
        disabled={cannot || disabled || phase === 'transcribing'}
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
