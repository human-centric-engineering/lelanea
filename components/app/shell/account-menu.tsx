'use client';

import { Gauge, LogOut, Shield, SlidersHorizontal, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';

import { ICON_RADIUS } from '@/components/app/shell/chrome';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTheme } from '@/hooks/use-theme';
import { EVENTS, useAnalytics } from '@/lib/analytics';
import { authClient } from '@/lib/auth/client';
import { logger } from '@/lib/logging';
import { cn } from '@/lib/utils';

export interface AccountMenuUser {
  /**
   * Never blank: the shell layout falls back to the email when the account
   * has no name, so this is the trigger's whole accessible name and needs no
   * generic fallback label.
   */
  name: string;
  email: string;
  /** `'ADMIN'` shows the Admin row; anything else, including `null`, does not. */
  role: string | null;
}

/**
 * The rows every signed-in person gets, in order. A table rather than inline
 * JSX so `shell-view-pages.test.tsx` can derive "every destination offered has
 * a page" from it, as it does from `SHELL_NAV` — a row added here without a
 * route fails there rather than in someone's browser. Admin is not in it: it
 * is role-gated and leaves the shell.
 */
export const ACCOUNT_MENU_LINKS = [
  { href: '/app/account', label: 'Your account', icon: UserRound },
  { href: '/app/settings', label: 'Settings', icon: SlidersHorizontal },
  { href: '/app/usage', label: 'Usage and billing', icon: Gauge },
] as const;

export interface AccountMenuProps {
  user: AccountMenuUser;
  /** Initials for the avatar disc — `initialsFor` in `shell-nav.tsx`. */
  initials: string;
  /** The 64px rail: the avatar is the whole control. */
  slim: boolean;
  /**
   * Called when a row is chosen inside the ≤900px drawer, so the drawer closes
   * behind the navigation the way a nav item does. `undefined` above 900px,
   * where the nav is a column with nothing to close.
   */
  onNavigate?: () => void;
}

/**
 * The account block at the foot of the left nav, and the popover it opens.
 *
 * Everything about the PERSON rather than the work lives here — their account,
 * settings, usage, the admin door when they have one, the theme, and the way
 * out — so the nav can be about destinations and the topbar about the panes.
 * Owner ruling, 15 September 2026: Settings and Usage came out of `SHELL_NAV`
 * and the theme toggle came out of `ShellTopbar` to make this the one place.
 *
 * Composed from Sunrise's `DropdownMenu` and `Avatar` rather than mounting
 * `components/auth/user-button.tsx`, which is close but not reusable here: it
 * takes no props and renders its own avatar-only trigger, hardcodes
 * `align="end"` with no `side`, and shows its admin link unconditionally.
 * Tracked upstream as sunrise#706 (a trigger slot plus `align`/`side`); when
 * that lands, this can shrink to `UserButton` with a trigger. Until then, no
 * platform file is edited. The same composition, and the reasoning below,
 * were worked out first in HCE Hub (`components/hub/account/account-menu.tsx`).
 *
 * ## The four things that make the failure path work
 *
 * Each looks removable and is not:
 *
 * - `preventDefault()` on the Sign out item's `onSelect`. Radix closes the menu
 *   on select, which unmounts the content — taking the "Signing out…" label, the
 *   double-submit guard and any failure message with it before any can be seen.
 *   On success the redirect replaces the document, so nothing is left open.
 * - `track()` / `reset()` in their own `try` inside `onSuccess`. The server
 *   session is already gone at that point; an analytics rejection escaping would
 *   skip the redirect and leave the reader on an app page with a dead session.
 * - The failure message's `role="alert"` plus the Sign out item's
 *   `aria-describedby`. `alert` announces it when it appears; `describedby`
 *   attaches it to the item the reader is still focused on. A *disabled* item
 *   would not do: Radix drops disabled entries from its roving focus, so a
 *   keyboard user could never reach it again.
 * - `signOutFailed` cleared on CLOSE, unless a sign-out is still in flight.
 *   This component stays mounted while the content unmounts, so without a reset
 *   a failure is still rendered — and re-announced — the next time the menu
 *   opens, describing an attempt long over. Clearing on open (the Hub's shape)
 *   has a hole: a click outside dismisses the menu mid-request, the failure
 *   lands against a closed menu, and the reopen wipes it before anyone sees it —
 *   the reader is still signed in with no explanation. Clearing on close skips
 *   the in-flight case, so a late failure survives to the next open.
 *
 * ## Why sign-out lands on `/`
 *
 * A hard `window.location` load, not `router.push()`. better-auth 1.7 already
 * clears the session cookie, its cache and the client atom; what a document
 * load additionally discards is Next's client Router Cache, which can hold RSC
 * payloads rendered for the person who just left. `/` rather than `/login`
 * because (1) the public site header now shows a plain "Log in" to a visitor —
 * the trap `site-header.tsx` documents, where `/` had no way back in, is
 * fixed — and a front door is the honest place to be after leaving; (2) the
 * login page's "welcome back" is the wrong greeting for someone who just ended
 * a session, and on a shared machine may not even be for them; and (3) it is
 * where Sunrise's own `UserButton` sends a sign-out from `/profile` and
 * `/settings`, so the app has one exit rather than two.
 *
 * ## Inside the drawer
 *
 * Two collisions with the shell's own ≤900px behaviour, both handled here
 * rather than in `use-shell-layout.tsx`:
 *
 * - The layout's Escape chain closes the nav drawer on any document-level
 *   Escape. Radix dismisses the menu on Escape too, but does not stop the event,
 *   so one press would close the menu AND the drawer under it. `stopPropagation`
 *   in `onEscapeKeyDown` — Radix listens in the capture phase and the shell in
 *   the bubble phase, both on `document`, so stopping it there is enough.
 * - The drawer panel is `z-[60]`; Sunrise's content is `z-50` in a portal on
 *   `body`, so without an override the menu opened BEHIND the drawer.
 *
 * ## Dark mode
 *
 * A checkbox item, not a `Switch` inside a menu item: it carries
 * `role="menuitemcheckbox"` and `aria-checked` for free, where a nested control
 * would be neither reachable nor announced. `preventDefault` on select keeps
 * the menu open so the repaint is visible. It persists a choice exactly as the
 * topbar toggle it replaces did; "follow the device" (D4) stays in Settings,
 * which is the page that can show all three states honestly.
 *
 * No leading icon on that row on purpose: the tick sits in `pl-8`'s reserved
 * column, which is where the other rows' icons sit, so every label starts on
 * the same edge.
 */
export function AccountMenu({ user, initials, slim, onNavigate }: AccountMenuProps) {
  const signOutErrorId = useId();
  const { theme, setTheme } = useTheme();
  const { track, reset } = useAnalytics();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);

  const handleSignOut = async (): Promise<void> => {
    setIsSigningOut(true);
    setSignOutFailed(false);
    try {
      await authClient.signOut({
        fetchOptions: {
          onSuccess: async () => {
            try {
              await track(EVENTS.USER_LOGGED_OUT);
              await reset();
            } catch (error) {
              logger.error('Sign-out analytics failed; redirecting anyway', error);
            }
            window.location.href = '/';
          },
          onError: (ctx) => {
            logger.error('Sign out failed', ctx.error);
            setIsSigningOut(false);
            setSignOutFailed(true);
          },
        },
      });
    } catch (error) {
      logger.error('Sign out threw', error);
      setIsSigningOut(false);
      setSignOutFailed(true);
    }
  };

  const rows = [
    ...ACCOUNT_MENU_LINKS,
    ...(user.role === 'ADMIN' ? [{ href: '/admin', label: 'Admin', icon: Shield }] : []),
  ];

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open && !isSigningOut) setSignOutFailed(false);
      }}
    >
      <DropdownMenuTrigger
        title={slim ? user.name : undefined}
        className={cn(
          'flex h-12 flex-none items-center gap-[11px] text-left',
          ICON_RADIUS,
          'hover:bg-[var(--color-pill-hover)] data-[state=open]:bg-[var(--color-pill-hover)]',
          'transition-[background-color] duration-200 ease-[var(--ease-brand)]',
          'motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-solid',
          'focus-visible:outline-[var(--color-ring)]',
          slim ? 'w-11 justify-center px-0' : 'w-full px-2'
        )}
      >
        {/*
          `aria-hidden` on the wrapper, not `alt=""` on an image: with no picture
          the FALLBACK is what renders, and its initials are text inside the
          button, so unhidden they join its name and it reads "MR Maya Reyes".
          t-40 adds the image inside this same wrapper.
        */}
        <Avatar aria-hidden className="h-[34px] w-[34px]">
          <AvatarFallback className="bg-secondary text-secondary-foreground text-[13px] font-medium">
            {initials}
          </AvatarFallback>
        </Avatar>
        {slim ? (
          <span className="sr-only">{user.name}</span>
        ) : (
          <span className="min-w-0">
            <b className="text-foreground block text-[13.5px] font-medium">{user.name}</b>
            <span className="text-muted-foreground block truncate text-[11.5px]">{user.email}</span>
          </span>
        )}
      </DropdownMenuTrigger>

      {/*
        Opens upward, left-aligned with the trigger: the menu belongs to the nav
        column and should read as part of it. In the 64px rail it necessarily
        escapes the column; Radix's collision handling keeps it on screen.
      */}
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={6}
        className="z-[70] w-56"
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        <DropdownMenuLabel className="font-normal">
          <span className="flex flex-col gap-0.5">
            <span className="text-foreground truncate text-[13px] leading-none font-medium">
              {user.name}
            </span>
            <span className="text-muted-foreground truncate text-[11px] leading-none">
              {user.email}
            </span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {rows.map(({ href, label, icon: Icon }) => (
          <DropdownMenuItem key={href} asChild onSelect={onNavigate}>
            <Link href={href} className="cursor-pointer no-underline hover:no-underline">
              <Icon strokeWidth={1.5} aria-hidden="true" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={theme === 'dark'}
          onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          onSelect={(event) => event.preventDefault()}
          className="cursor-pointer"
        >
          Dark mode
        </DropdownMenuCheckboxItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleSignOut();
          }}
          disabled={isSigningOut}
          aria-describedby={signOutFailed ? signOutErrorId : undefined}
          className="cursor-pointer"
        >
          <LogOut strokeWidth={1.5} aria-hidden="true" />
          {isSigningOut ? 'Signing out…' : 'Sign out'}
        </DropdownMenuItem>
        {signOutFailed ? (
          <DropdownMenuLabel
            id={signOutErrorId}
            role="alert"
            className="text-destructive px-2 pt-0 pb-1 text-[11px] font-normal"
          >
            Couldn&rsquo;t sign out &mdash; try again.
          </DropdownMenuLabel>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
