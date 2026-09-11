import * as React from 'react';

import { Eyebrow } from '@/components/app/ui/eyebrow';
import { cn } from '@/lib/utils';

export interface ViewProps {
  /** The lowercase tracked-out label — `life situations`, `your account`. */
  eyebrow: React.ReactNode;
  /** The serif line the destination is actually called, in the display register. */
  title: React.ReactNode;
  /** The serif sentence under the title: what this place is for. */
  lede?: React.ReactNode;
  /** The small print under the lede, where the honest caveat goes. */
  note?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * The frame every destination under `/app` renders inside.
 *
 * One component rather than seven copies of the same header, because the
 * eyebrow-and-serif-title pairing IS the shell's promise that a destination is
 * a real place: `shell-placeholder-page.tsx` proved how easily seven of them
 * end up sharing one indistinguishable page.
 *
 * ## Why the head is here and not in the workspace's own header
 *
 * The prototype's `wsHead()` writes into `.surface-head`, above the scrolling
 * body — so the title stays put while the view scrolls. Reproducing that here
 * would mean the title travelling UP from the page to `Workspace`, which is a
 * client component two levels above it, and the only mechanisms for that are a
 * context set from an effect (a frame of empty header on every navigation, and
 * on SSR) or a `@head` parallel-route slot (a second file for every
 * destination, plus a `default.tsx`). Neither is worth a sticky title.
 *
 * So the head renders where the words are, inside the workspace's scroll
 * container, and `Workspace`'s header keeps the one control that belongs to the
 * frame rather than to any view — "Return to the conversation". What IS still
 * published upward is the tone, which cannot be: see `view-tone.ts`.
 *
 * ## `<main>` and `<h1>`
 *
 * The shell has neither. The topbar carries the brand and the nav carries
 * links, and until t-11 the only thing under `/app` was the conversation pane —
 * so a reader landing on a view had no landmark to skip to and no top-level
 * heading naming the page. Both are this component's, which also means there is
 * exactly one of each per route by construction.
 *
 * The eyebrow is `<p>`, NOT a heading: it labels the `<h1>` directly under it,
 * and promoting it would put two headings where the design shows one.
 */
export function View({ eyebrow, title, lede, note, children }: ViewProps) {
  return (
    <main className="flex flex-col gap-[18px] px-6 pt-[22px] pb-[30px]">
      <header>
        <Eyebrow as="p" className="block">
          {eyebrow}
        </Eyebrow>
        <h1
          className={cn(
            'brand-display mt-1 text-[29px] leading-[1.08] text-[var(--color-heading)]',
            'max-[900px]:text-2xl'
          )}
        >
          {title}
        </h1>
      </header>

      {lede ? (
        <p
          className={cn(
            'brand-display max-w-[44ch] text-[25px] leading-[1.18]',
            'text-[var(--color-heading)]'
          )}
        >
          {lede}
        </p>
      ) : null}

      {note ? (
        <p className="text-muted-foreground max-w-[52ch] text-[13.5px] leading-[1.65]">{note}</p>
      ) : null}

      {children}
    </main>
  );
}
