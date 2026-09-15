'use client';

import { Columns2, Menu, MessageCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { ICON_RADIUS } from '@/components/app/shell/chrome';
import { NAV_TOGGLE_ATTR, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { TIER_INKS } from '@/components/app/shell/map-drawer';
import { Eyebrow } from '@/components/app/ui/eyebrow';
import { modulePath, RECENTS_STORAGE_KEY, type RecentModule } from '@/lib/app/journey/paths';
import { useLocalStorage } from '@/lib/hooks/use-local-storage';
import { cn } from '@/lib/utils';

/**
 * The top bar: 58px, ruled off from the panes below it.
 *
 * ## What is deliberately absent, and why the bar still earns its place
 *
 * The prototype's bar carries five things. Two of them still cannot be honest:
 *
 * - **The budget meter** needs metered spend. Nothing calls a model until phase
 *   2, so `$12.40 left` would be a number we invented (D6, `B31`).
 * - **The `prototype` tag** is the prototype labelling itself.
 *
 * **Recents was the third, and is not any more.** It was omitted because nothing
 * opened a module until §05 and the strip would have been permanently empty.
 * §05 landed: `RememberModule` records each visit, so the strip now shows real
 * ones and says so plainly when there are none. That is the difference between
 * an empty strip and an absent one — the first tells a new reader the app is
 * keeping their place, the second tells them nothing at all.
 *
 * **The fourth, the theme toggle, left rather than never arrived.** It was here
 * until 15 September 2026 and now lives in the account menu
 * (`account-menu.tsx`) with everything else about the person — owner ruling:
 * one place, not two. Do not put it back to fill space; recents does that, and
 * the rest of the bar is the burger and the pane switch, both ≤900px controls.
 */
export function ShellTopbar() {
  const { width, wsOpen, navOpen, setNavOpen, pane, setPane } = useShellLayout();

  const small = width === 'small';

  return (
    <header
      className={cn(
        'bg-background flex h-[58px] flex-none items-center gap-3',
        'border-b border-[var(--color-divider)] pr-[18px] pl-[22px]'
      )}
    >
      {/*
        Both of these are ≤900px controls, and neither is rendered above it —
        the nav is a column there with nothing to open, and both panes are on
        screen together with nothing to switch between. A control that exists
        but does nothing is the thing `t-9` refused to ship, and rendering them
        hidden would be the same refusal with extra steps.
      */}
      {small ? (
        <button
          type="button"
          // The drawer hands focus back here when it closes — see `closeNav`.
          {...{ [NAV_TOGGLE_ATTR]: '' }}
          onClick={() => setNavOpen(!navOpen)}
          aria-label={navOpen ? 'Close the menu' : 'Open the menu'}
          aria-expanded={navOpen}
          className={cn(
            'text-muted-foreground hover:text-foreground flex h-9 w-9 flex-none items-center',
            'justify-center hover:bg-[var(--color-pill-hover)]',
            ICON_RADIUS,
            'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
            'motion-reduce:transition-none',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
            'focus-visible:outline-[var(--color-ring)]'
          )}
        >
          <Menu size={19} strokeWidth={1.6} aria-hidden="true" />
        </button>
      ) : null}

      {small && wsOpen ? (
        <div
          role="group"
          aria-label="Show"
          className="relative flex min-w-0 flex-1 items-stretch self-stretch"
        >
          {(
            [
              { id: 'chat', label: 'Conversation', Icon: MessageCircle },
              { id: 'ws', label: 'Workspace', Icon: Columns2 },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setPane(id)}
              aria-pressed={pane === id}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-center gap-[7px] px-1.5 text-sm',
                'text-muted-foreground aria-pressed:text-[var(--color-heading)]',
                'aria-pressed:font-medium'
              )}
            >
              <Icon size={15} strokeWidth={1.6} aria-hidden="true" />
              <span className="min-w-0 truncate">{label}</span>
            </button>
          ))}
          {/* The underline slides where the panes slide, so the swipe has a readout. */}
          <span
            aria-hidden="true"
            className={cn(
              'absolute bottom-[-1px] left-0 z-[1] h-0.5 w-1/2 rounded-t-sm',
              'bg-[var(--color-accent-ink)]',
              'transition-transform duration-[340ms] ease-[var(--ease-brand)]',
              'motion-reduce:transition-none',
              pane === 'ws' ? 'translate-x-full' : 'translate-x-0'
            )}
          />
        </div>
      ) : (
        <Recents />
      )}
    </header>
  );
}

/**
 * The `recently` strip: where this reader has actually been.
 *
 * ## It was absent, and absent was the wrong kind of empty
 *
 * §04 left it out under D6, because nothing opened a module yet and the strip
 * would have been permanently empty — the right call at the time. §05 landed
 * modules, and `RememberModule` has been recording the last one visited ever
 * since for the Workspace nav item; it now keeps a short list beside it, so
 * there is something real to show.
 *
 * **The empty state is the point, not the leftover case.** A new reader sees the
 * label and one quiet line saying nothing has been opened yet, which tells them
 * the app is keeping their place. A strip that simply is not there tells them
 * nothing, and is indistinguishable from a feature that does not exist.
 *
 * ## Nothing here is invented
 *
 * Every pill is a module this browser actually opened, labelled with the same
 * authored `01 · Values` the conversation's way back uses, and linking to the
 * module it names. The dot takes the arc's colour from `TIER_INKS` — decorative
 * at 6px, and reusing that table rather than reviving a second one of raw hues.
 *
 * `null` from `useLocalStorage` on the server and on the first client paint, so
 * the strip settles one effect later. That is invisible: it occupies the same
 * flexible gap either way, and nothing below it moves.
 */
function Recents() {
  const [recents] = useLocalStorage<RecentModule[]>(RECENTS_STORAGE_KEY, []);
  const pathname = usePathname();

  return (
    <div
      aria-label="Recently opened"
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1.5 px-1',
        // The design's `.recents` scrolls sideways rather than wrapping or
        // squeezing the controls either side of it. No scrollbar in a 58px bar.
        '[scrollbar-width:none] overflow-x-auto',
        // Below 900px the bar carries the burger and the pane switch, and there
        // is no room for this as well — the design drops it at the same width.
        'max-[900px]:hidden'
      )}
    >
      <Eyebrow className="flex-none pr-0.5 text-[11px] tracking-[0.13em]">recently</Eyebrow>

      {recents.length === 0 ? (
        <span className="text-muted-foreground flex-none text-[12.5px]">nothing opened yet</span>
      ) : (
        recents.map((entry) => {
          const href = modulePath(entry.slug);
          return (
            <Link
              key={entry.slug}
              href={href}
              aria-current={pathname === href ? 'page' : undefined}
              className={cn(
                'text-muted-foreground flex h-7 max-w-[190px] flex-none items-center gap-[7px]',
                'rounded-full border border-transparent bg-[var(--color-pill)] px-3',
                'text-[12.5px] no-underline hover:no-underline',
                'hover:text-foreground hover:bg-[var(--color-pill-hover)]',
                'transition-[background-color,color] duration-200 ease-[var(--ease-brand)]',
                'motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
                'focus-visible:outline-[var(--color-ring)]',
                'aria-[current=page]:border-[var(--color-secondary-ink)]',
                'aria-[current=page]:bg-[var(--color-secondary-wash)]',
                'aria-[current=page]:text-[var(--color-secondary-ink)]'
              )}
            >
              <i
                aria-hidden="true"
                style={{ background: TIER_INKS[entry.tier] ?? 'var(--color-border)' }}
                className="h-1.5 w-1.5 flex-none rounded-full"
              />
              <span className="truncate">{entry.label}</span>
            </Link>
          );
        })
      )}
    </div>
  );
}
