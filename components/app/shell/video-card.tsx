'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Play, X } from 'lucide-react';
import { useRef } from 'react';

import type { ResourceVideoView } from '@/lib/app/content/resources';
import type { VideoPlayer } from '@/lib/app/content/video-hosts';
import { cn } from '@/lib/utils';

/**
 * A video in the resources drawer: the design's picture card, which opens a
 * lightbox playing it in the page (`lelanea.html`, `.videocard` and
 * `#lightbox`; f-resources t-119).
 *
 * ## The still and the player come from the server
 *
 * `player` is resolved on the server from the stored link (`video-hosts.ts`):
 * the host's own still, and an embed URL built from the host's validated id.
 * Nothing here reads the stored link, so an admin's link never becomes an
 * iframe `src`. The iframe's origin is the one `appFrameSrc` allows
 * (`lib/app/csp.ts`).
 *
 * ## The lightbox is modal, and it is the first rung of Escape
 *
 * Unlike the drawer it opens from, the lightbox covers everything and nothing
 * beside it is live. So it is a real modal dialog (Radix): focus moves in and
 * is trapped, and on close it returns to the card. The prototype's Escape chain
 * puts the lightbox first, so Escape closes the lightbox and leaves the drawer
 * open. On open, focus goes to the close button, not the first tabbable element
 * Radix would pick: that is the iframe, and a keypress inside a cross-origin
 * frame never reaches this page. Once a reader clicks into the player, Escape
 * is YouTube's; the close button and the scrim still close it. Radix listens on `document` in the capture phase and the shell in the
 * bubble phase, so stopping the event in `onEscapeKeyDown` is enough
 * (`account-menu.tsx` has the same collision).
 *
 * The iframe exists only while the lightbox is open. Closing it unmounts the
 * iframe, which is what stops the video.
 *
 * ## Fixed dark, in both themes
 *
 * The design's lightbox and the still's frame are near-black with light text
 * whatever the theme, as a cinema is: the `--color-cinema*` tokens in
 * `app/brand-theme.css`, declared once for both themes.
 */
export function VideoCard({
  video,
  player,
}: {
  video: Pick<ResourceVideoView, 'title' | 'subtitle' | 'duration'>;
  player: VideoPlayer;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          title={`${video.title} · ${video.duration}`}
          className={cn(
            'group block w-full overflow-hidden rounded-[16px] text-left',
            'border border-[var(--color-card-border)] bg-[var(--color-card)]',
            'transition-[box-shadow,transform] duration-[220ms] ease-[var(--ease-brand)]',
            'hover:-translate-y-px hover:shadow-[var(--shadow-rest)]',
            'motion-reduce:transition-none motion-reduce:hover:translate-y-0',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          <span className="relative block aspect-video w-full overflow-hidden bg-[var(--color-cinema)]">
            {/*
              A plain <img>: `next/image` would need the host's origin in
              `next.config.js`, which Sunrise owns. The still is decorative —
              the caption below names the video — so its alt is empty.
            */}
            {/* eslint-disable-next-line @next/next/no-img-element -- remote still; next/image needs Sunrise's next.config */}
            <img
              src={player.thumbnailUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover group-hover:brightness-105"
            />
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,var(--color-cinema-fade)_0%,transparent_46%)]"
            />
            <span
              aria-hidden="true"
              className={cn(
                'absolute top-1/2 left-1/2 z-[2] flex h-[46px] w-[46px] -translate-x-1/2 -translate-y-1/2',
                'items-center justify-center rounded-full bg-[var(--color-cinema-veil)] text-[var(--color-cinema-ink)] backdrop-blur-[6px]',
                'transition-[background-color,scale] duration-200 ease-[var(--ease-brand)]',
                'group-hover:scale-[1.06] group-hover:bg-[var(--color-primary)]',
                'motion-reduce:transition-none motion-reduce:group-hover:scale-100'
              )}
            >
              <Play size={18} strokeWidth={1.5} fill="currentColor" />
            </span>
            <span
              className={cn(
                'absolute right-2 bottom-2 z-[2] inline-flex h-[21px] items-center rounded-[6px] px-[7px]',
                'bg-[var(--color-cinema-scrim)] text-[11.5px] tracking-[0.02em] text-[var(--color-cinema-ink)] tabular-nums'
              )}
            >
              {video.duration}
            </span>
          </span>
          <span className="block px-[13px] pt-[11px] pb-[13px]">
            <span className="block text-[14px] leading-[1.35] font-medium text-[var(--color-heading)]">
              {video.title}
            </span>
            <span className="text-muted-foreground mt-[3px] block text-[12px] leading-[1.5]">
              {video.subtitle}
            </span>
          </span>
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[80] bg-[var(--color-cinema-scrim)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'motion-reduce:animate-none'
          )}
        />
        <DialogPrimitive.Content
          onEscapeKeyDown={(event) => event.stopPropagation()}
          // Radix would focus the first tabbable thing inside: the iframe. Focus
          // in a cross-origin frame takes the keyboard with it, so Escape would
          // go to YouTube and never close the lightbox. The close button keeps
          // the keyboard here, and Tab still reaches the player.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
          className={cn(
            // Centred and no wider than the frame, so the scrim around it is
            // outside the dialog and a click there closes it.
            'fixed top-1/2 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-[880px] -translate-x-1/2 -translate-y-1/2',
            'focus:outline-none sm:w-[calc(100%-4rem)]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
            'motion-reduce:animate-none'
          )}
        >
          <div>
            <div className="relative aspect-video w-full overflow-hidden rounded-[20px] bg-[var(--color-cinema)]">
              <iframe
                src={player.embedUrl}
                title={video.title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
              />
            </div>
            <div className="mt-4 flex items-center gap-4 text-[var(--color-cinema-ink)]">
              <div className="min-w-0 flex-1">
                <DialogPrimitive.Title className="brand-display text-[24px] leading-[1.2] text-[var(--color-cinema-ink)]">
                  {video.title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-[13px] text-[var(--color-cinema-ink)] tabular-nums opacity-80">
                  {video.duration} · {video.subtitle}
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close
                ref={closeRef}
                aria-label="Close"
                className={cn(
                  'flex h-10 w-10 flex-none items-center justify-center rounded-full',
                  'border border-[var(--color-cinema-line)] text-[var(--color-cinema-ink)]',
                  'transition-colors duration-200 hover:bg-[var(--color-cinema-hover)]',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                  'focus-visible:outline-[var(--color-cinema-ink)]'
                )}
              >
                <X size={17} strokeWidth={1.6} aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
