'use client';

import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { Tipped } from '@/components/app/ui/tipped';
import { AccountMenu, type AccountMenuUser } from '@/components/app/shell/account-menu';
import { isNavItem, SHELL_NAV } from '@/components/app/shell/nav-items';
import { SHELL_OVERLAY_ATTR, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { FOCUSABLE } from '@/components/app/shell/focusable';
import { LAST_MODULE_STORAGE_KEY, MODULES_PATH_PREFIX, modulePath } from '@/lib/app/journey/paths';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { cn } from '@/lib/utils';

/** The nav item that means "back to the module you are in". */
const WORKSPACE_HREF = '/app/workspace';

/**
 * What a click-away must NOT collapse the menu on.
 *
 * The same list `workspace.tsx` guards its re-park gesture with, and for the
 * same reason: a click on a control is a request to do that thing, not an
 * incidental press on the background. Without it, using anything at all in the
 * workspace — a button, a link, a checkbox — folded the menu as a side effect,
 * which reads as the app flinching rather than as dismissing something.
 */
const INTERACTIVE = 'a, button, input, select, textarea, [role="button"], [role="separator"]';

/**
 * The shared height of the top area, in BOTH states, and it is the whole answer
 * to why the collapse control can live up here at all.
 *
 * The prototype stacks the mark above the control when slim
 * (`.lnav.slim .lnav-top { flex-direction: column }`) and keeps them side by
 * side when open — which makes the top area taller in one state than the other,
 * so every nav icon below it shifted down as the menu collapsed. That is the
 * defect the control was moved to the footer to dodge, and dodging it was the
 * wrong fix: it cost the design's own layout.
 *
 * Reserving the taller of the two heights in both states solves it directly.
 * The row is the same height open or slim, the mark and the control simply
 * change how they sit inside it, and the first nav item starts at the same y
 * either way.
 *
 * 72px is the slim stack MEASURED, and the measurement is the point: this said
 * 70px on the strength of a "25px-tall mark", which is not what renders.
 * `LotusMark` sizes by BLOOM width, not by frame height — `lotusFrameSize(30,
 * water)` is 45.59 × 29.51, rounded to 46 × 30 — so the column is 30 + 10 + 32,
 * and every child is `flex-none`. Two pixels short of its contents is not a
 * tight fit; it is an overflow that clips into the first nav item.
 */
const NAV_TOP_H = 'h-[72px]';

export interface ShellNavProps {
  /** The signed-in person, for the pinned account menu. */
  user: AccountMenuUser;
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
 * renders comes from the server: the five destinations are static, and the
 * account footer is passed the session's user rather than fetching one.
 *
 * ## Five ways it opens and closes, and they are not interchangeable
 *
 * | Gesture                          | Direction | Where                | Persists |
 * | -------------------------------- | --------- | -------------------- | -------- |
 * | the collapse control, at the top | both      | above 900px          | yes      |
 * | a press on the menu's dead space | both      | above 900px          | yes      |
 * | a press out in the panes         | closes    | above 900px          | no       |
 * | Ask Lelañea opening / parking    | both      | `medium` + workspace | no       |
 * | crossing 1100px inward           | closes    | —                    | no       |
 *
 * The split is about what the press was aimed at. The first two are a reader
 * working the menu deliberately, so they persist; the rest are the layout
 * getting out of the way for a moment, and persisting any of those would
 * silently rewrite a choice somebody made on purpose — see `collapseNav`.
 *
 * None of the first three fire while a drawer is open: a press inside an
 * `aria-modal` dialog must not reach the shell it is covering. And the Ask
 * Lelañea row is width-conditional because its whole reason is crowding — see
 * `setChatSlim` for the geometry that decides where the two actually compete.
 *
 * ## What is deliberately absent
 *
 * The prototype's account footer carries a second line reading "eleven
 * sessions". Nothing counts sessions yet, so this renders the email instead —
 * real, useful, and honest — rather than a number that would have to be
 * invented (D6, `B31`).
 *
 * The prototype's nav also carries "Usage and billing" and "Settings" as its
 * last two rows. They moved into the account menu (`account-menu.tsx`) along
 * with the theme toggle and sign-out — one place for everything about the
 * person, so the nav is about destinations. Owner ruling, 15 September 2026.
 */
export function ShellNav({ user }: ShellNavProps) {
  const { navSlim, navOpen, setNavOpen, closeNav, toggleNavSlim, collapseNav, drawer, width } =
    useShellLayout();
  /*
   * "Workspace" resolves to the last module visited, remembered per browser
   * by the module page (`RememberModule`). Until one has been, it goes to the
   * `/app/workspace` landing that says so. Read here rather than pushed into
   * the nav item table, because the table is static and this is the one entry
   * whose destination is a fact about the reader. `null` on the server and on
   * the first client paint (the hook starts from `initial` to keep hydration
   * honest), so the href settles one effect later — a link, not a redirect, so
   * that is invisible.
   */
  const [lastModule] = useLocalStorage<string | null>(LAST_MODULE_STORAGE_KEY, null);
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

  /**
   * Pressing dead space works the menu, and WHICH dead space decides what it
   * means.
   *
   * | Where the press lands        | What it does | Writes the preference |
   * | ---------------------------- | ------------ | --------------------- |
   * | the menu's own empty space   | toggles      | yes                   |
   * | anywhere else, menu open     | collapses    | no                    |
   * | anywhere else, menu slim     | nothing      | —                     |
   *
   * The asymmetry is the point, and it is about what the press was AIMED at. A
   * press inside the menu is a deliberate act on the menu — including bringing
   * it back, which is the whole reason the collapsed rail's empty space is a
   * target at all: it is a 64px-wide column of nothing, and making it dead would
   * leave one 32px control as the only way back. That is the same act as the
   * control, so it persists like the control. A press out in the conversation is
   * a dismissal — it says nothing about how somebody likes their menu, so it
   * moves the live value and leaves storage alone (`collapseNav`).
   *
   * On `pointerdown` rather than `click`, so the menu is already moving by the
   * time the press resolves — `click` fires after `mouseup`, which on a drag or
   * a long press is noticeably late.
   *
   * It is not a scrim: above 900px the menu is a column in the flow, not a panel
   * over anything, so there is nothing to dim and nothing to swallow the press
   * with. And it never fires on a press that lands on a control (`INTERACTIVE`)
   * — including the menu's own items and its own collapse button, which have
   * their own jobs.
   *
   * Focus is safe by construction, which is why there is no focus handling here:
   * this changes the menu's WIDTH. Every item stays rendered, focusable and in
   * the same order, so a reader whose focus was on one keeps it. The case where
   * focus really would be stranded is the ≤900px drawer going `inert`, and that
   * is handled where the drawer closes — `closeNav` in `use-shell-layout.tsx`.
   */
  useEffect(() => {
    if (width === 'small') return;
    // Nothing at all while a drawer is open, and this is not belt-and-braces.
    // The drawer's scrim is a bare `<div>` and the panel's own dead space — its
    // lede, its arc headings, its padding — is not a control either, so
    // `INTERACTIVE` misses both and `navRef` does not contain them. Dismissing
    // the map by clicking its scrim therefore closed the drawer AND silently
    // collapsed the menu behind it. A press inside an `aria-modal` dialog must
    // not reach the shell it is covering; that is what modal means.
    if (drawer) return;
    const onDown = (event: PointerEvent) => {
      // The primary button only. `pointerdown` fires for button 2 as well, so a
      // right-click anywhere in the panes restructured the layout underneath
      // the context menu that was about to open.
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(INTERACTIVE)) return;
      // A full-screen overlay is covering the shell, and a press on it is not a
      // press on the shell. `pointer-events` cannot say this to a `document`
      // listener — see `SHELL_OVERLAY_ATTR`. The entry bloom is the one that
      // bit: a click during the opening animation collapsed the reader's menu
      // as their first interaction with the app.
      if (target.closest(`[${SHELL_OVERLAY_ATTR}]`)) return;
      if (navRef.current?.contains(target)) {
        toggleNavSlim();
        return;
      }
      if (!slim) collapseNav();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [width, slim, drawer, collapseNav, toggleNavSlim]);

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
        /*
         * `inert` while the drawer is shut, and ONLY at small — above it the
         * nav is an in-flow column that must stay usable.
         *
         * `invisible` alone is not enough, and the reason is the transition it
         * shares with the transform: `visibility` changes DISCRETELY at the
         * end of a transition, so for the 300ms of a close the panel is still
         * `visible` and every link in it is still tabbable while sliding off
         * screen. `drawer.tsx` answers this with `inert` and its comment
         * claimed this file already did — it did not, until t-22 went looking
         * for the pattern in order to document it.
         */
        inert={width === 'small' && !navOpen}
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
          // THIS IS WHAT WAS DEFEATING THE ANIMATION, and it was not a missing
          // transition: the transition existed and was gated behind a
          // `readerToggled` piece of state set by the very click that also
          // changed the width. Both landed in one React commit, so the class and
          // the new width arrived together and the browser had nothing to
          // transition FROM — the first collapse snapped, and the auto-slim on
          // crossing 1100px, which never set the flag, snapped every time.
          // Resolved through `cn` to be sure: at `large`, slim, untoggled, the
          // list came out with no `transition-*` in it at all.
          //
          // The flag was there to keep a width transition off the ≤900px
          // drawer, which needs its own `transition-[transform,visibility]` and
          // would have lost it to twMerge. But `width !== 'small'` already does
          // exactly that, and the two branches are mutually exclusive — so the
          // flag was buying nothing and costing the first animation.
          //
          // Emitting it unconditionally above 900px is safe on first paint:
          // `fitToWidth` runs in a LAYOUT effect, before the browser has painted
          // the server's expanded default, so the correction to slim has no
          // previous frame to animate away from.
          width !== 'small' &&
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
        The mark and the collapse control, at the top, where the prototype puts
        them (`.lnav-top`) — and at ONE HEIGHT in both states, which is what
        makes that possible without the nav items jumping. See `NAV_TOP_H`.

        Open, they sit in a row with the control pushed right. Slim, the control
        drops under the mark and both centre in the 64px rail, as
        `.lnav.slim .lnav-top` does. The row is the same height either way, so
        the first nav item below starts at the same y.
      */}
        <div
          className={cn(
            NAV_TOP_H,
            'flex flex-none',
            slim ? 'flex-col items-center justify-center gap-2.5 px-0' : 'items-center gap-2.5',
            !slim && (width === 'small' ? 'px-0' : 'px-[3px]')
          )}
        >
          {/*
          In the drawer the close control sits FIRST — where the burger that
          opened it was.

          Opening the drawer put the wordmark under the reader's cursor at
          exactly the coordinates they had just pressed, so the obvious "press it
          again to close" landed on a link to the public site and took them out
          of the app entirely. A control that moves out from under the gesture
          that summoned it, and leaves a trapdoor there, is worse than none.
        */}
          {width === 'small' ? (
            <button
              type="button"
              onClick={closeNav}
              aria-label="Close the menu"
              title="Close the menu"
              className={cn(
                'text-muted-foreground hover:text-foreground flex h-9 w-9 flex-none',
                'items-center justify-center rounded-[10px]',
                'hover:bg-[var(--color-pill-hover)]',
                'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                'motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                'focus-visible:outline-[var(--color-ring)]'
              )}
            >
              <Menu size={19} strokeWidth={1.6} aria-hidden="true" />
            </button>
          ) : null}
          <Link
            href="/"
            aria-label="Lelañea, back to the site"
            className="flex min-w-0 flex-none items-center gap-2.5 no-underline hover:no-underline"
          >
            <LotusMark size={30} />
            {slim ? null : (
              <span className="brand-display text-[22px] whitespace-nowrap">Lelañea</span>
            )}
          </Link>

          {/*
            The spacer that pushes the control to the right edge when the menu is
            open. Slim, the row is a centred column and there is nothing to push.
          */}
          {slim || width === 'small' ? null : <span className="min-w-0 flex-1" />}

          {/*
            No collapse control inside the ≤900px drawer. There the menu is
            always its full self — `slim` is ignored at that width, which the
            prototype's small block states outright — so this button would flip a
            preference with no visible effect. The burger opens and closes the
            nav at that width, and the close control above is its partner.
          */}
          {width === 'small' ? null : (
            /*
              It takes the brand tooltip when slim, like everything else in the
              64px rail. Collapsed, this is the one control that is ALWAYS
              there — and it was the only icon in the column with no hover hint
              at all, which reads as the odd one out rather than as the obvious
              way back. Expanded, the label would be noise beside a menu that
              already says what it is.
            */
            <Tipped side="right" label={slim ? 'Expand the menu' : null}>
              {(tip) => (
                <button
                  {...tip}
                  type="button"
                  onClick={toggleNavSlim}
                  aria-label={slim ? 'Expand the menu' : 'Collapse the menu'}
                  aria-expanded={!slim}
                  className={cn(
                    'text-muted-foreground hover:text-foreground hover:bg-[var(--color-pill-hover)]',
                    'flex h-8 flex-none items-center justify-center rounded-[10px]',
                    'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                    'motion-reduce:transition-none',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                    'focus-visible:outline-[var(--color-ring)]',
                    // Slim, it takes the item width so it sits on the same
                    // vertical centre line as every icon below it.
                    slim ? 'w-11' : 'w-8'
                  )}
                >
                  {slim ? (
                    <PanelLeftOpen size={18} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <PanelLeftClose size={18} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </button>
              )}
            </Tipped>
          )}
        </div>

        {/*
        `overflow-y-auto`, because the shell is `h-dvh overflow-hidden` and every
        child here is `flex-none`: the destinations, the brand row and the
        account footer came to roughly 460px when there were seven, so below
        about 500px of viewport height — a phone in landscape, a short desktop
        window — the last rows and the account footer were cut off with nothing
        on the page able to scroll to them. Five rows are shorter, not immune.

        `scrollbar-none` keeps the chrome out of a 64px column; the content is
        still reachable by wheel, trackpad, touch and keyboard focus.
      */}
        <div className="-mx-1 mt-3 flex min-h-0 flex-1 [scrollbar-width:none] flex-col gap-0.5 overflow-y-auto px-1">
          {SHELL_NAV.map((entry, i) => {
            if (!isNavItem(entry)) {
              return (
                <div
                  key={`sep-${i}`}
                  aria-hidden="true"
                  className="mx-[7px] my-[9px] h-px flex-none bg-[var(--color-divider)]"
                />
              );
            }

            // `/app` is every view's prefix, so a `startsWith` test would light
            // "The conversation" on every page in the product. Exact match for it;
            // prefix match for the rest, so `/app/situations/3` still marks
            // "Life situations" as current.
            // The Workspace item is also current on any module page: a module
            // IS the workspace, whichever URL it lives at.
            const onModule =
              entry.href === WORKSPACE_HREF && pathname.startsWith(`${MODULES_PATH_PREFIX}/`);
            const current =
              entry.href === '/app'
                ? pathname === '/app'
                : onModule || pathname === entry.href || pathname.startsWith(`${entry.href}/`);
            const href =
              entry.href === WORKSPACE_HREF && lastModule ? modulePath(lastModule) : entry.href;
            const Icon = entry.icon;

            return (
              /*
                The brand tooltip, and only when the labels are gone. An open
                menu already says what each item is, which is the prototype's
                own rule (`.lnav:not(.slim) .lnav-item::after { content: none }`).
                `null` renders the link with no bubble and no handlers.

                It REPLACES the native `title`, which was the browser's tooltip:
                a different shape, a different delay, unstyleable, and it fires
                on touch. The accessible name stays where it was — the `sr-only`
                span below — because a tooltip is not a name.
              */
              <Tipped
                key={entry.href}
                side="right"
                label={slim ? `${entry.label} — ${entry.hint}` : null}
              >
                {(tip) => (
                  <Link
                    {...tip}
                    href={href}
                    // Closes the drawer even when the route does not change —
                    // tapping the item for the page already showing otherwise
                    // left the panel and its scrim sitting over it.
                    onClick={width === 'small' ? closeNav : undefined}
                    aria-current={current ? 'page' : undefined}
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
                      // The LABEL, not the tooltip's `label — hint`. The
                      // accessible name should say the same thing in both
                      // states, and the expanded menu says the label; a name
                      // that grows a subtitle when the menu narrows is the same
                      // destination announcing itself two different ways.
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
                )}
              </Tipped>
            );
          })}
        </div>

        {/*
        The pinned footer: the account, and nothing else now that the collapse
        control has gone back up to the top where the design puts it. Outside
        the scroll container on purpose — the account should not scroll away
        with the destinations above it.
      */}
        <div className="-mx-1 flex flex-none flex-col gap-0.5 px-1 pt-1">
          <AccountMenu
            user={user}
            initials={initialsFor(user.name, user.email)}
            slim={slim}
            onNavigate={width === 'small' ? closeNav : undefined}
          />
        </div>
      </nav>
    </>
  );
}
