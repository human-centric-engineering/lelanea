'use client';

import { ExternalLink, Headphones, Pause, Play } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import { announcePlay, onOtherPlay } from '@/components/app/shell/media-playback';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { TIMED_CARD_CLASS, TIMED_DISC_CLASS } from '@/components/app/shell/video-card';
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
 * Starting a piece, or opening a video, pauses any other (`media-playback.ts`).
 * A piece announces itself on `playing`, when sound has actually started, so a
 * play the browser declines or a file that fails stops nothing. Closing the
 * drawer pauses it: the panel stays mounted when closed, so its sound would
 * otherwise carry on behind the work. Moving to something else in the
 * workspace stops it too: the drawer shows its loading state for the new key,
 * which takes the card out of the page, and a media element taken out of the
 * page stops.
 *
 * ## No captions yet
 *
 * Audio needs a transcript for a reader who cannot hear it. None exists for
 * her audio, so the card carries no `<track>` rather than an empty one, and a
 * transcript per piece is a Hub idea for when her audio arrives.
 *
 * ## When the file will not play
 *
 * The drawer offers this card only for a file the page may play
 * (`canPlayInPage`), so the CSP is not the usual cause. A file can still be
 * gone, or the network can drop. Then the card says it could not be played
 * here and offers the link, moving keyboard focus to that link if it was on
 * the play button, so a keyboard reader is not dropped to the top of the page.
 * Reopening the drawer lets it try again.
 */
export function AudioCard({
  piece,
  player,
}: {
  piece: Pick<ResourceAudioView, 'id' | 'title' | 'subtitle' | 'duration' | 'href'>;
  player: AudioPlayer;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  const focusOpenOnFail = useRef(false);
  const progressId = useId();
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [length, setLength] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const { drawer } = useShellLayout();

  // Another piece started, or a video opened: stop this one.
  useEffect(() => onOtherPlay(piece.id, () => audioRef.current?.pause()), [piece.id]);

  // The drawer closed: stop. It opened again: a failed piece may try again.
  useEffect(() => {
    if (drawer !== 'resources') audioRef.current?.pause();
    else setFailed(false);
  }, [drawer]);

  // The play button that had focus is gone; give focus to the link that replaced it.
  useEffect(() => {
    if (failed && focusOpenOnFail.current) {
      focusOpenOnFail.current = false;
      openRef.current?.focus();
    }
  }, [failed]);

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
        onPlay={() => setPlaying(true)}
        onPlaying={() => announcePlay(piece.id)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        // Some files report no finite length at first (`Infinity`) and give
        // it later, so both events are read.
        onLoadedMetadata={(event) => takeLength(event.currentTarget.duration)}
        onDurationChange={(event) => takeLength(event.currentTarget.duration)}
        onError={() => {
          focusOpenOnFail.current = document.activeElement === buttonRef.current;
          setFailed(true);
          setPlaying(false);
        }}
      />
      <div className="flex items-start gap-3">
        {failed ? (
          <span aria-hidden="true" className={TIMED_DISC_CLASS}>
            <Headphones size={15} strokeWidth={1.6} />
          </span>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            onClick={toggle}
            // The label says the state ("Pause …" while it plays), so no
            // `aria-pressed`: a toggle's name must not change with its state.
            aria-label={`${playing ? 'Pause' : 'Play'} ${piece.title}`}
            className={cn(
              TIMED_DISC_CLASS,
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
            ref={openRef}
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
              // The bar follows the hand at once; `timeupdate` confirms it once
              // the seek lands. Without this a drag snaps back to the old place.
              const seconds = Number(event.target.value);
              setCurrent(seconds);
              const audio = audioRef.current;
              if (audio) audio.currentTime = seconds;
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
