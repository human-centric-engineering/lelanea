'use client';

import { ExternalLink, Headphones, Pause, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { announcePlay, onOtherPlay } from '@/components/app/shell/media-playback';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { TIMED_CARD_CLASS } from '@/components/app/shell/video-card';
import type { AudioPlayer } from '@/lib/app/content/audio-hosts';
import type { ResourceAudioView } from '@/lib/app/content/resources';
import { cn } from '@/lib/utils';

/** `754` → `12:34`; `3723` → `1:02:03`. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = String(whole % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/**
 * An audio piece in the resources drawer, playing inline in its card (owner
 * ruling, 1 Oct 2026; f-resources t-120). The prototype has no audio, so this is
 * the design: the card the drawer's other timed pieces use, with a play/pause
 * disc where the glyph was, and a progress bar and the time beneath.
 *
 * ## What it fetches, and when
 *
 * `preload="none"`: nothing is downloaded until the reader presses play, so a
 * drawer listing three pieces costs nothing. Until then the total shown is the
 * length the admin entered; once the file's own length is known it is that.
 * The progress bar is disabled until then too, since there is nothing to seek
 * in.
 *
 * ## When it stops
 *
 * Starting a piece, or opening a video, pauses any other (`media-playback.ts`),
 * announced only once playback has actually started, so a play the browser
 * declines stops nothing. Closing the drawer pauses it: the panel stays mounted
 * when closed, so its sound would otherwise carry on behind the work. Moving to
 * something else in the workspace unmounts the card when the drawer's pieces
 * change, and a media element taken out of the page stops. When they do not
 * change (a piece belonging to everything, beside a page with nothing of its
 * own), it keeps playing, which is what a reader moving on with it would want.
 *
 * The drawer keys the card by its file, so an edited link starts a fresh card
 * rather than carrying the old file's length or failure.
 *
 * ## No captions yet
 *
 * Audio needs a transcript for a reader who cannot hear it. None exists for
 * her audio, so the card carries no `<track>` rather than an empty one, and a
 * transcript per piece is a Hub idea for when her audio arrives.
 *
 * ## When the file will not play
 *
 * The browser refuses media from an origin the CSP does not allow (sunrise#841
 * is the ask for an app seam), and a link can simply be gone. Either way the
 * card says it could not be played here and offers the link, rather than a
 * play button that does nothing.
 */
export function AudioCard({
  piece,
  player,
}: {
  piece: Pick<ResourceAudioView, 'id' | 'title' | 'subtitle' | 'duration' | 'href'>;
  player: AudioPlayer;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const progressId = useId();
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const { drawer } = useShellLayout();

  // Another piece started, or a video opened: stop this one.
  useEffect(() => onOtherPlay(piece.id, () => audioRef.current?.pause()), [piece.id]);

  // The drawer closed.
  useEffect(() => {
    if (drawer !== 'resources') audioRef.current?.pause();
  }, [drawer]);

  const takeLength = (seconds: number) => {
    if (Number.isFinite(seconds) && seconds > 0) setLength(seconds);
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    // A rejected play() is either the file failing, which the `error` event
    // reports, or the browser declining, which leaves the button as it was and
    // stops nothing, since only an actual start is announced.
    audio.play()?.catch(() => undefined);
  };

  const total = length === null ? piece.duration : formatClock(length);
  const Icon = playing ? Pause : Play;

  return (
    // The shared card frame, without its hover lift: this card is not one
    // thing to click but a player with controls inside it.
    <div
      className={cn(
        'px-[13px] pt-[11px] pb-3',
        TIMED_CARD_CLASS,
        'hover:translate-y-0 hover:shadow-none'
      )}
    >
      {/*
        No <track>: there are no captions or transcripts for her audio yet, and
        an empty track would satisfy the rule while helping nobody. A
        transcript per piece is the real remedy, raised as a Hub idea (t-120).
      */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- no transcript exists yet; see above */}
      <audio
        ref={audioRef}
        src={player.src}
        preload="none"
        onPlay={() => {
          setPlaying(true);
          announcePlay(piece.id);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        // Some files report no finite length at first (`Infinity`) and give
        // it later, so both events are read.
        onLoadedMetadata={(event) => takeLength(event.currentTarget.duration)}
        onDurationChange={(event) => takeLength(event.currentTarget.duration)}
        onError={() => {
          setFailed(true);
          setPlaying(false);
        }}
      />
      <div className="flex items-start gap-3">
        {failed ? (
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full',
              'bg-[var(--color-pill)] text-[var(--color-secondary-ink)]'
            )}
          >
            <Headphones size={15} strokeWidth={1.6} />
          </span>
        ) : (
          <button
            type="button"
            onClick={toggle}
            // The label says the state ("Pause …" while it plays), so no
            // `aria-pressed`: a toggle's name must not change with its state.
            aria-label={`${playing ? 'Pause' : 'Play'} ${piece.title}`}
            className={cn(
              'mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full',
              'bg-[var(--color-pill)] text-[var(--color-secondary-ink)]',
              'transition-colors duration-200 ease-[var(--ease-brand)] hover:bg-[var(--color-pill-hover)]',
              'motion-reduce:transition-none',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
              'focus-visible:outline-[var(--color-ring)]'
            )}
          >
            <Icon size={15} strokeWidth={1.6} fill="currentColor" aria-hidden="true" />
          </button>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-[1.35] font-medium text-[var(--color-heading)]">
            {piece.title}
          </span>
          <span className="text-muted-foreground mt-[3px] block text-[12px] leading-[1.5]">
            {piece.subtitle}
          </span>
        </span>
      </div>

      {failed ? (
        <p role="status" className="text-muted-foreground mt-2.5 text-[12px] leading-[1.5]">
          This could not be played here.{' '}
          <a
            href={piece.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[var(--color-secondary-ink)] underline underline-offset-2"
          >
            Open it
            <ExternalLink size={11} strokeWidth={1.6} aria-hidden="true" />
          </a>
        </p>
      ) : (
        <div className="mt-2.5 flex items-center gap-3">
          <label htmlFor={progressId} className="sr-only">
            Position in {piece.title}
          </label>
          <input
            id={progressId}
            type="range"
            min={0}
            max={length ?? 0}
            step={1}
            value={Math.min(current, length ?? 0)}
            disabled={length === null}
            aria-valuetext={`${formatClock(current)} of ${total}`}
            onChange={(event) => {
              const audio = audioRef.current;
              if (audio) audio.currentTime = Number(event.target.value);
            }}
            className={cn(
              'h-1 min-w-0 flex-1 cursor-pointer accent-[var(--color-primary)]',
              'disabled:cursor-default disabled:opacity-50'
            )}
          />
          <span className="text-muted-foreground flex-none text-[11.5px] tabular-nums">
            {formatClock(current)} / {total}
          </span>
        </div>
      )}
    </div>
  );
}
