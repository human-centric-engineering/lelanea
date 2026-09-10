'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { cn } from '@/lib/utils';

/** Per-browser, not per-account: which width the menu sits at is a device habit. */
const SLIM_KEY = 'lelanea.nav.slim';

export interface ShellNavProps {
  /** The signed-in person, for the pinned account footer. */
  user: { name: string; email: string };
}

/**
 * Initials for the account avatar.
 *
 * The prototype hard-codes `MR` beside `Maya Reyes`. A real name is not two
 * tidy words: it can be one word, three, hyphenated, or an email local-part
 * where the account was created without a name. So take the first letter of the
 * first and last whitespace-separated parts, which degrades to a single letter
 * rather than to nothing, and fall back to the email's first character.
 *
 * `Array.from` rather than `charAt`, so a name starting with an astral
 * character (an emoji, or a rarer CJK glyph) yields that character instead of
 * half of its surrogate pair.
 */
export function initialsFor(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return (Array.from(email.trim())[0] ?? '?').toUpperCase();
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/**
 * The left nav: labelled and open at 234px, collapsible to 64px icons.
 *
 * A client island because three things here are browser state — the slim
 * preference, the tooltip on hover, and which item is current. Everything it
 * renders comes from the server: the seven destinations are static, and the
 * account footer is passed the session's user rather than fetching one.
 *
 * ## What is deliberately absent
 *
 * The prototype's account footer carries a second line reading "eleven
 * sessions". Nothing counts sessions yet, so this renders the email instead —
 * real, useful, and honest — rather than a number that would have to be
 * invented (D6, `B31`).
 */
export function ShellNav({ user }: ShellNavProps) {
  const [slim, setSlim] = useLocalStorage<boolean>(SLIM_KEY, false);
  const pathname = usePathname();

  /**
   * Animate the width only after the stored preference has been applied.
   *
   * `useLocalStorage` deliberately returns its `initial` on the first render —
   * the server could not read storage, so anything else is a hydration
   * mismatch — and adopts the stored value in a post-mount effect. With the
   * 260ms width transition always live, a reader who had chosen the slim nav
   * watched it render at 234px and slide closed on every single page load.
   *
   * So the first paint is untransitioned and the correction is instant; every
   * width change after that is a real one, and animates.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);

  return (
    <nav
      aria-label="Main"
      data-slim={slim ? 'true' : 'false'}
      className={cn(
        'bg-card relative z-50 flex flex-none flex-col border-r',
        'border-[var(--color-divider)] pt-3.5 pb-13',
        settled &&
          'transition-[width] duration-[260ms] ease-[var(--ease-brand)] motion-reduce:transition-none',
        slim ? 'w-16 px-2.5' : 'w-[234px] px-2.5'
      )}
    >
      <div
        className={cn('flex items-center gap-2.5 pt-0.5 pb-3', slim ? 'flex-col px-0' : 'px-[3px]')}
      >
        <Link
          href="/"
          aria-label="Lelañea, back to the site"
          className="flex min-w-0 items-center gap-2.5 no-underline hover:no-underline"
        >
          <LotusMark size={30} />
          {slim ? null : (
            <span className="brand-display text-[22px] whitespace-nowrap">Lelañea</span>
          )}
        </Link>
        {slim ? null : <span className="flex-1" />}
        <button
          type="button"
          onClick={() => setSlim((v) => !v)}
          aria-label={slim ? 'Expand the menu' : 'Collapse the menu'}
          title={slim ? 'Expand the menu' : 'Collapse the menu'}
          className={cn(
            'text-muted-foreground hover:text-foreground hover:bg-[var(--color-pill-hover)]',
            'flex h-8 w-8 flex-none items-center justify-center rounded-[10px]',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          {slim ? (
            <PanelLeftOpen size={18} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <PanelLeftClose size={18} strokeWidth={1.5} aria-hidden="true" />
          )}
        </button>
      </div>

      {/*
        `overflow-y-auto`, because the shell is `h-dvh overflow-hidden` and every
        child here is `flex-none`: the seven destinations, the brand row and the
        account footer come to roughly 460px, so below about 500px of viewport
        height — a phone in landscape, a short desktop window — "Usage and
        billing", "Settings" and the account footer were cut off with nothing on
        the page able to scroll to them.

        `scrollbar-none` keeps the chrome out of a 64px column; the content is
        still reachable by wheel, trackpad, touch and keyboard focus.
      */}
      <div className="flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-x-hidden overflow-y-auto">
        {SHELL_NAV.map((entry, i) => {
          if (!isNavItem(entry)) {
            return entry.kind === 'separator' ? (
              <div
                key={`sep-${i}`}
                aria-hidden="true"
                className="mx-[7px] my-[9px] h-px flex-none bg-[var(--color-divider)]"
              />
            ) : (
              <span key={`spacer-${i}`} className="min-h-2.5 flex-1" />
            );
          }

          // `/app` is every view's prefix, so a `startsWith` test would light
          // "The conversation" on every page in the product. Exact match for it;
          // prefix match for the rest, so `/app/situations/3` still marks
          // "Life situations" as current.
          const current =
            entry.href === '/app'
              ? pathname === '/app'
              : pathname === entry.href || pathname.startsWith(`${entry.href}/`);
          const Icon = entry.icon;

          return (
            <Link
              key={entry.href}
              href={entry.href}
              aria-current={current ? 'page' : undefined}
              title={slim ? `${entry.label} — ${entry.hint}` : undefined}
              className={cn(
                'flex h-[42px] flex-none items-center gap-3 rounded-xl border border-transparent',
                'text-muted-foreground text-left no-underline hover:no-underline',
                'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                'motion-reduce:transition-none',
                'hover:text-foreground hover:bg-[var(--color-pill-hover)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                'focus-visible:outline-[var(--color-ring)]',
                'aria-[current=page]:border-[var(--color-secondary-ink)]',
                'aria-[current=page]:bg-[var(--color-secondary-wash)]',
                'aria-[current=page]:text-[var(--color-secondary-ink)]',
                slim ? 'w-11 justify-center px-0' : 'w-full px-[11px]'
              )}
            >
              <Icon size={18} strokeWidth={1.5} className="flex-none" aria-hidden="true" />
              {slim ? (
                <span className="sr-only">{entry.label}</span>
              ) : (
                <span
                  className={cn(
                    'min-w-0 flex-1 overflow-hidden text-[14.5px] text-ellipsis whitespace-nowrap',
                    current && 'font-medium'
                  )}
                >
                  {entry.label}
                </span>
              )}
            </Link>
          );
        })}

        <Link
          href="/app/account"
          title={slim ? `Your account — ${user.name}` : undefined}
          className={cn(
            'flex h-12 flex-none items-center gap-[11px] rounded-xl text-left',
            'no-underline hover:bg-[var(--color-pill-hover)] hover:no-underline',
            'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
            'motion-reduce:transition-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]',
            slim ? 'w-11 justify-center px-0' : 'w-full px-2'
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'bg-secondary text-secondary-foreground flex h-[34px] w-[34px] flex-none',
              'items-center justify-center rounded-full text-[13px] font-medium'
            )}
          >
            {initialsFor(user.name, user.email)}
          </span>
          {slim ? (
            <span className="sr-only">Your account — {user.name}</span>
          ) : (
            <span className="min-w-0">
              <b className="text-foreground block text-[13.5px] font-medium">{user.name}</b>
              <span className="text-muted-foreground block truncate text-[11.5px]">
                {user.email}
              </span>
            </span>
          )}
        </Link>
      </div>
    </nav>
  );
}
