'use client';

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { FOCUSABLE } from '@/components/app/shell/focusable';
import { cn } from '@/lib/utils';

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
  const { navSlim, navOpen, setNavOpen, closeNav, toggleNavSlim, width } = useShellLayout();
  const pathname = usePathname();

  /*
   * Inside the ≤900px drawer the menu is ALWAYS its full self, never the icon
   * rail — the prototype's small block says so in as many words
   * (`.lnav.slim .lnav-item { width: 100% }`). A drawer you deliberately opened
   * showing you icons instead of names would be the worst of both.
   */
  const slim = navSlim && width !== 'small';

  /**
   * Focus follows the drawer open.
   *
   * `ShellNav` precedes the topbar in the DOM, so a reader who pressed the
   * burger and then tabbed went FORWARD into the theme toggle and the panes —
   * behind the scrim — rather than into the menu they had just asked for. It was
   * reachable only by shift-tabbing backwards, which nobody does.
   */
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (navOpen) navRef.current?.focus();
  }, [navOpen]);

  /**
   * Keep Tab inside the open drawer, as `Drawers` does and for the same reason.
   *
   * Below 900px this is a fixed panel over a scrim, so the shell behind it is
   * meant to be unavailable — but it is not the last focusable subtree in the
   * document, so a reader who reached it walked straight out into the topbar and
   * the panes underneath on the next Tab.
   */
  useEffect(() => {
    if (!navOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const panel = navRef.current;
      if (!panel) return;

      const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === panel)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navOpen]);

  const [readerToggled, setReaderToggled] = useState(false);
  const toggleSlim = () => {
    setReaderToggled(true);
    toggleNavSlim();
  };

  return (
    <>
      {/*
        The drawer's scrim. Only below 900px, where the nav leaves the flow and
        rides over the panes — above it the nav is a column and there is nothing
        to dismiss.
      */}
      {width === 'small' ? (
        <div
          aria-hidden="true"
          onClick={() => setNavOpen(false)}
          className={cn(
            'fixed inset-0 z-[55] bg-[var(--color-scrim)]',
            'transition-opacity duration-300 ease-[var(--ease-brand)]',
            'motion-reduce:transition-none',
            navOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
        />
      ) : null}
      <nav
        ref={navRef}
        tabIndex={-1}
        aria-label="Main"
        data-slim={slim ? 'true' : 'false'}
        className={cn(
          'bg-card relative z-50 flex flex-none flex-col border-r',
          'border-[var(--color-divider)] pt-3.5 pb-13',
          // Below 900px the nav leaves the flow entirely and becomes a panel over
          // the panes. `invisible` as well as the transform, so a closed drawer is
          // out of the tab order rather than merely off-screen.
          width === 'small' && [
            'fixed top-0 bottom-0 left-0 z-[60] w-[min(320px,88vw)] px-2.5',
            'border-[var(--color-border)] shadow-[var(--shadow-lift)]',
            'transition-[transform,visibility] duration-300 ease-[var(--ease-brand)]',
            'motion-reduce:transition-none',
            navOpen ? 'visible translate-x-0' : 'invisible -translate-x-[102%]',
          ],
          // Above 900px only, for the same twMerge reason: below it the nav is a
          // drawer that SLIDES, and a width transition here replaced the
          // `transition-[transform,visibility]` it needs — so once a reader had ever
          // used the collapse control, the phone drawer stopped animating and
          // `visibility` snapped. `readerToggled` is state, so it survived the resize
          // that took them there.
          width !== 'small' &&
            readerToggled &&
            'transition-[width] duration-[260ms] ease-[var(--ease-brand)] motion-reduce:transition-none',
          // 9px when slim, not 10px, and the difference is load-bearing: the item
          // is `w-11` (44px), so at 10px the inner box is exactly 44px and the
          // active item's border sits flush against the clip edge of the scroll
          // container below. The prototype uses 9px for the same reason.
          // Above 900px ONLY. `cn` is `twMerge`, so emitting a width here
          // unconditionally replaced the drawer's own `w-[min(320px,88vw)]` above —
          // measured — and every phone got a 234px panel instead of the one the
          // prototype's small block specifies.
          width !== 'small' && (slim ? 'w-16 px-[9px]' : 'w-[234px] px-2.5')
        )}
      >
        {/*
        ONE ROW IN BOTH STATES, and that is the whole point of it.

        The prototype stacks the mark above the collapse control when slim
        (`.lnav.slim .lnav-top { flex-direction: column }`), which makes the top
        area taller in one state than the other — so every nav icon below it
        shifted down as the menu collapsed. Collapsing a menu should change its
        width and nothing else; icons that jump make the two states read as two
        different navs. Owner ruling, 10 September 2026.

        The toggle therefore lives in the footer below, where it holds one
        position in both states rather than trading places with the wordmark.
      */}
        <div
          className={cn(
            'flex h-8 flex-none items-center gap-2.5 pt-0.5',
            slim ? 'justify-center px-0' : 'px-[3px]'
          )}
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
        <div className="-mx-1 mt-3 flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto px-1">
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
                // Closes the drawer even when the route does not change —
                // tapping the item for the page already showing otherwise
                // left the panel and its scrim sitting over it.
                onClick={width === 'small' ? closeNav : undefined}
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
        </div>

        {/*
        The pinned footer: the collapse toggle and the account, in one position
        in both states. Outside the scroll container on purpose — a control for
        the nav itself should not scroll away with the nav's contents.
      */}
        <div className="-mx-1 flex flex-none flex-col gap-0.5 px-1 pt-1">
          {/*
          No collapse control inside the drawer. Below 900px the menu is always
          its full self — `slim` is ignored there, which the prototype's small
          block states outright — so this button would flip a preference with no
          visible effect. A control that does nothing is what this shell has
          refused twice already; the burger opens and closes the nav at this
          width.
        */}
          {width === 'small' ? null : (
            <button
              type="button"
              onClick={toggleSlim}
              aria-label={slim ? 'Expand the menu' : 'Collapse the menu'}
              title={slim ? 'Expand the menu' : 'Collapse the menu'}
              className={cn(
                'text-muted-foreground hover:text-foreground hover:bg-[var(--color-pill-hover)]',
                'flex h-8 flex-none items-center rounded-[10px]',
                'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                'motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                'focus-visible:outline-[var(--color-ring)]',
                slim ? 'w-11 justify-center px-0' : 'w-full justify-end px-2'
              )}
            >
              {slim ? (
                <PanelLeftOpen size={18} strokeWidth={1.5} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={18} strokeWidth={1.5} aria-hidden="true" />
              )}
            </button>
          )}

          <Link
            href="/app/account"
            onClick={width === 'small' ? closeNav : undefined}
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
    </>
  );
}
