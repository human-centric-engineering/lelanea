// @vitest-environment happy-dom

/**
 * The left nav — the two things about it that a screenshot cannot check.
 *
 * 1. **Which item is current.** `/app` is every view's prefix, so the obvious
 *    `startsWith` implementation lights "The conversation" on every page in the
 *    product — including the page that is actually current, so two items claim
 *    it at once. That is invisible in a screenshot of `/app` itself, which is
 *    the screen anyone checking would look at.
 *
 * 2. **The account footer carries the real person.** It is the one part of the
 *    nav fed by the session rather than by a constant, and `initialsFor` has to
 *    survive names the prototype's "Maya Reyes" never tested it against.
 *
 * @see components/app/shell/shell-nav.tsx
 */

import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialsFor, ShellNav } from '@/components/app/shell/shell-nav';
import { ShellTopbar } from '@/components/app/shell/shell-topbar';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
}));

// `ShellTopbar` renders alongside the nav in the drawer cases below — the burger
// is the only thing that opens the drawer, so the two have to be tested together.
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));

const USER = { name: 'Maya Reyes', email: 'maya@example.com' };

/**
 * `large` by default, and stated deliberately: at happy-dom's own 1024px default
 * the provider auto-slims the nav, so every label and tooltip case below would
 * be silently asserting against a collapsed menu.
 */
function renderAt(pathname: string, width: WidthName = 'large') {
  mockPathname.current = pathname;
  return renderInShell(<ShellNav user={USER} />, width);
}

/** The nav item whose `aria-current` is set, by accessible name. */
function currentItems(): string[] {
  return screen
    .getAllByRole('link')
    .filter((el) => el.getAttribute('aria-current') === 'page')
    .map((el) => el.textContent?.trim() ?? '');
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app';
});

describe('ShellNav — which destination reads as current', () => {
  it('marks exactly one item on the shell root', () => {
    renderAt('/app');
    expect(currentItems()).toEqual(['The conversation']);
  });

  it('does not leave "The conversation" current on a nested view', () => {
    // The `startsWith('/app')` bug, stated directly: this is the assertion that
    // fails if the prefix test is ever loosened.
    renderAt('/app/situations');
    expect(currentItems()).toEqual(['Life situations']);
  });

  it('keeps the section current on a deeper path within it', () => {
    renderAt('/app/situations/3');
    expect(currentItems()).toEqual(['Life situations']);
  });

  it('does not mark a sibling that merely shares a prefix', () => {
    // `/app/share` vs a hypothetical `/app/shared`: a bare `startsWith` with no
    // separator would light "Share with Lelañea" on both.
    renderAt('/app/shared-thing');
    expect(currentItems()).toEqual([]);
  });

  it('renders all seven destinations', () => {
    renderAt('/app');
    for (const label of [
      'The conversation',
      'Workspace',
      'Your journey',
      'Life situations',
      'Share with Lelañea',
      'Usage and billing',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
  });
});

describe('ShellNav — the account footer is the real person', () => {
  it('shows the session name and email, not a placeholder', () => {
    renderAt('/app');
    expect(screen.getByText('Maya Reyes')).toBeTruthy();
    expect(screen.getByText('maya@example.com')).toBeTruthy();
    expect(screen.getByText('MR')).toBeTruthy();
  });

  it('invents no session count', () => {
    // The prototype's footer reads "eleven sessions". Nothing counts sessions
    // yet, so D6 says omit rather than fake — and a digit in this subtree is
    // how that would come back.
    const { container } = renderAt('/app');
    const footer = screen.getByRole('link', { name: /Maya Reyes/ });
    expect(footer.textContent).not.toMatch(/\d/);
    expect(container.querySelector('[href="/app/account"]')).toBeTruthy();
  });
});

describe('ShellNav — slim mode', () => {
  const toggle = () => screen.getByRole('button', { name: /the menu/ });

  it('starts labelled', () => {
    renderAt('/app');
    expect(screen.getByText('Lelañea')).toBeTruthy();
    expect(toggle().getAttribute('aria-label')).toBe('Collapse the menu');
  });

  it('hides the labels and keeps the destinations reachable', async () => {
    renderAt('/app');
    await userEvent.click(toggle());

    // The wordmark and the visible labels go; the accessible names must not,
    // or a screen-reader user loses the nav entirely at 64px.
    expect(screen.queryByText('Lelañea')).toBeNull();
    expect(screen.getByRole('link', { name: 'Life situations' })).toBeTruthy();
    // Seven destinations, the account footer, and the wordmark — which keeps
    // its own `aria-label` when its text is hidden, so it stays a link.
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: 'Lelañea, back to the site' })).toBeTruthy();
  });

  it('gives every item a tooltip carrying its hint', async () => {
    // In slim mode the label is hidden, so `label — hint` on the title is the
    // only thing telling two icons apart.
    renderAt('/app');
    await userEvent.click(toggle());

    expect(screen.getByRole('link', { name: 'Life situations' }).getAttribute('title')).toBe(
      'Life situations — What you are living through'
    );
  });

  it('drops the tooltips again when labelled, so they are not doubled', async () => {
    renderAt('/app');
    const item = screen.getByRole('link', { name: /Life situations/ });
    expect(item.getAttribute('title')).toBeNull();
  });

  it('offers the way back', async () => {
    renderAt('/app');
    await userEvent.click(toggle());
    expect(toggle().getAttribute('aria-label')).toBe('Expand the menu');

    await userEvent.click(toggle());
    expect(screen.getByText('Lelañea')).toBeTruthy();
  });

  it('remembers the choice for this browser', async () => {
    renderAt('/app');
    await userEvent.click(toggle());
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBe('true');
  });

  it('keeps the account footer reachable at 64px', async () => {
    renderAt('/app');
    await userEvent.click(toggle());

    const account = screen.getByRole('link', { name: /Your account/ });
    expect(account.getAttribute('href')).toBe('/app/account');
    expect(screen.getByText('MR')).toBeTruthy();
  });

  it('still marks the current item', async () => {
    renderAt('/app/situations');
    await userEvent.click(toggle());
    expect(currentItems()).toEqual(['Life situations']);
  });
});

describe('ShellNav — collapsing changes the width and nothing else', () => {
  /** The nav's three regions, in order: brand, scrolling items, pinned footer. */
  const regions = () => Array.from(document.querySelectorAll('nav > div'));

  it('keeps the brand row the same height in both states', async () => {
    // The defect this guards: the prototype stacks the mark above the collapse
    // control when slim, which made the top area taller in one state than the
    // other — so every nav icon below it shifted down as the menu collapsed.
    // Collapsing should move the right edge and nothing else.
    renderAt('/app');
    const expanded = regions()[0].className;

    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    const slim = regions()[0].className;

    expect(slim).toContain('h-8');
    expect(expanded).toContain('h-8');
    // A column direction is what made it taller; height alone would not catch
    // a future `flex-col` whose children happen to fit.
    expect(slim).not.toContain('flex-col');
    expect(expanded).not.toContain('flex-col');
  });

  it('keeps the toggle out of the brand row, so it cannot push the items down', () => {
    renderAt('/app');
    const [brand, , footer] = regions();

    expect(brand.querySelector('button')).toBeNull();
    expect(footer.querySelector('button')).not.toBeNull();
    expect(footer.textContent).toContain(USER.name);
  });

  it('leaves room for the active border and the focus ring when slim', async () => {
    // The active item is `w-11` (44px). At `px-2.5` the slim nav's inner box is
    // exactly 44px, so the border sat flush against the scroll container's clip
    // edge and the `outline-offset-2` focus ring was cut off entirely. 9px is
    // what the prototype uses, and the scroll container carries `-mx-1 px-1` so
    // an outline has somewhere to go.
    renderAt('/app');
    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));

    const nav = document.querySelector('nav');
    expect(nav?.className).toContain('px-[9px]');
    expect(nav?.className).not.toContain('px-2.5');

    const [, body] = regions();
    expect(body.className).toContain('-mx-1');
    expect(body.className).toContain('px-1');
    // `overflow-x-hidden` would clip the ring however much padding it had.
    expect(body.className).not.toContain('overflow-x-hidden');
  });
});

describe('ShellNav — the column survives a short window', () => {
  it('scrolls rather than clipping its last items', () => {
    // The shell is `h-dvh overflow-hidden` and every nav child is `flex-none`,
    // so at roughly 460px of content there is nothing on the page able to
    // reach "Usage and billing", "Settings" or the account footer once the
    // viewport drops below about 500px — a phone in landscape, or a short
    // desktop window. The scroll container is the only thing that fixes it,
    // and jsdom cannot measure layout, so the container is what is asserted.
    const { container } = renderAt('/app');
    const list = container.querySelector('nav > div:nth-of-type(2)');

    expect(list?.className).toContain('overflow-y-auto');
    expect(list?.className).toContain('min-h-0');
  });

  it('does not animate the width when the stored preference is applied', async () => {
    // THE CASE THE FIRST FIX FAILED. `useLocalStorage` returns its `initial` on
    // the first render and adopts the stored value in a mount effect, so a
    // reader who had chosen the slim nav watched it render at 234px and slide
    // closed on every page load.
    //
    // Arming the transition from a mount effect does NOT fix that: React
    // batches both effects into one re-render, so the corrected width and the
    // armed transition land in the same style change and CSS plays it anyway.
    // The first version of this test asserted only the SERVER render and its own
    // comment admitted a DOM assertion would pass either way — so it could not
    // see the bug it was written for.
    //
    // This one waits for the correction to actually land in the DOM and then
    // checks the transition is still absent, which is the moment that matters.
    window.localStorage.setItem('lelanea.nav.slim', 'true');
    renderAt('/app');
    const nav = document.querySelector('nav');

    await waitFor(() => expect(nav?.className).toContain('w-16'));
    expect(nav?.className).not.toContain('transition-[width]');
  });

  it('does animate a width the reader asked for', async () => {
    // Suppressing it forever would be a different bug.
    renderAt('/app');
    const nav = document.querySelector('nav');
    expect(nav?.className).not.toContain('transition-[width]');

    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    expect(nav?.className).toContain('transition-[width]');
    expect(nav?.className).toContain('w-16');
  });
});

describe('ShellNav — the drawer is the full menu', () => {
  it('offers no collapse control below 900px', async () => {
    // `slim` is ignored inside the drawer, so the toggle would flip a stored
    // preference and change nothing on screen — a dead control, which is what
    // the rail and the topbar both refused. The burger is the affordance here.
    renderAt('/app', 'small');
    // The COLLAPSE control specifically. The drawer does carry a "Close the
    // menu" button — deliberately, sitting where the burger that opened it was —
    // so a loose /the menu/ match would now pass for the wrong reason.
    expect(screen.queryByRole('button', { name: /Collapse the menu|Expand the menu/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close the menu' })).toBeTruthy();
  });

  it('shows full labels in the drawer, never the icon rail', () => {
    // Even with the slim preference stored: a drawer you deliberately opened
    // showing icons instead of names would be the worst of both.
    window.localStorage.setItem('lelanea.nav.slim', 'true');
    renderAt('/app', 'small');

    expect(screen.getByRole('link', { name: /Life situations/ })).toBeTruthy();
    expect(screen.getByText('Lelañea')).toBeTruthy();
  });

  it('still offers the collapse control above 900px, and no close button', () => {
    renderAt('/app', 'large');
    expect(screen.getByRole('button', { name: /Collapse the menu/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close the menu' })).toBeNull();
  });

  it('puts the close control where the burger was, not a link off the app', async () => {
    // Opening the drawer put the wordmark under the cursor at exactly the
    // coordinates just pressed, so pressing again left the app for the public
    // site. The first thing in the drawer's brand row must be the way out of it.
    renderAt('/app/journey', 'small');
    const brandRow = document.querySelector('nav[aria-label="Main"] > div')!;
    const first = brandRow.firstElementChild!;

    expect(first.tagName).toBe('BUTTON');
    expect(first.getAttribute('aria-label')).toBe('Close the menu');
  });
});

describe('the drawer keeps its own geometry (twMerge)', () => {
  it('is min(320px,88vw) wide, not the desktop column width', async () => {
    // `cn` is `twMerge`: the desktop `w-[234px]` was emitted after the drawer's
    // own width and replaced it, so every phone got a 234px panel.
    renderAt('/app', 'small');
    const nav = document.querySelector('nav[aria-label="Main"]')!;

    expect(nav.className).toContain('w-[min(320px,88vw)]');
    expect(nav.className).not.toContain('w-[234px]');
  });

  it('slides rather than resizing, even after the collapse control has been used', async () => {
    // `readerToggled` is state and survives a resize, so a reader who had ever
    // collapsed the nav on a desktop carried a `transition-[width]` down to the
    // phone, where it replaced the drawer's `transition-[transform,visibility]`
    // and the panel popped instead of sliding.
    renderAt('/app', 'large');
    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));

    // RESIZE the live component; do not remount it. `readerToggled` is component
    // state, so a fresh mount resets the very thing the defect depends on — the
    // first version of this test did exactly that and passed against the broken
    // code.
    act(() => {
      Object.defineProperty(window, 'innerWidth', {
        value: 800,
        writable: true,
        configurable: true,
      });
      window.dispatchEvent(new Event('resize'));
    });

    const nav = document.querySelector('nav[aria-label="Main"]')!;
    expect(nav.className).toContain('transition-[transform,visibility]');
    expect(nav.className).not.toContain('transition-[width]');
  });
});

describe('initialsFor', () => {
  it.each([
    ['Maya Reyes', 'maya@example.com', 'MR'],
    // One word: a single letter beats nothing.
    ['Prince', 'p@example.com', 'P'],
    // Three words take the first and the LAST, not the first two.
    ['Ada Byron Lovelace', 'ada@example.com', 'AL'],
    ['  padded   name  ', 'p@example.com', 'PN'],
    ['ñora Díaz', 'n@example.com', 'ÑD'],
  ])('%s → %s', (name, email, expected) => {
    expect(initialsFor(name, email)).toBe(expected);
  });

  it('falls back to the email when there is no name', () => {
    // An OAuth provider that returned none, or an invite accepted before the
    // profile was filled in. The avatar must not be blank.
    expect(initialsFor('', 'zoe@example.com')).toBe('Z');
    expect(initialsFor('   ', 'zoe@example.com')).toBe('Z');
  });

  it('takes a whole astral character, not half a surrogate pair', () => {
    // `charAt(0)` here returns a lone high surrogate, which renders as a
    // replacement glyph in the avatar.
    expect(initialsFor('😀 Smith', 'a@example.com')).toBe('😀S');
  });
});

describe('the phone drawer, once it is open', () => {
  /** Nav plus the burger that opens it — the drawer has no opener of its own. */
  function renderPhoneShell(pathname = '/app/journey') {
    mockPathname.current = pathname;
    return renderInShell(
      <>
        <ShellNav user={USER} />
        <ShellTopbar />
      </>,
      'small'
    );
  }

  const navEl = () => document.querySelector('nav[aria-label="Main"]')!;
  const openBurger = () => userEvent.click(screen.getByRole('button', { name: 'Open the menu' }));

  it('is focusable, so opening it can move focus into it', () => {
    // The round-2 fix for this was a NO-OP: the ref was declared and read but
    // never attached to anything, so `.focus()` ran against null while the
    // comment above it described a repair that had not happened. Assert what is
    // in the DOM, not what the code intended.
    renderPhoneShell();
    expect(navEl().getAttribute('tabindex')).toBe('-1');
  });

  it('takes focus when the burger opens it', async () => {
    renderPhoneShell();
    await openBurger();
    expect(document.activeElement).toBe(navEl());
  });

  it('closes when a nav item is tapped', async () => {
    renderPhoneShell();
    await openBurger();
    expect(navEl().className).toContain('visible');

    await userEvent.click(screen.getByRole('link', { name: /Life situations/ }));
    expect(navEl().className).toContain('invisible');
  });

  it('closes even for the route already showing, where nothing navigates', async () => {
    // No pathname change, so the route effect never fires — the drawer and its
    // scrim stayed over the page the reader was already on, with Escape or the
    // scrim the only way out.
    renderPhoneShell('/app/journey');
    await openBurger();

    await userEvent.click(screen.getByRole('link', { name: /Your journey/ }));
    expect(navEl().className).toContain('invisible');
  });

  it('keeps Tab inside itself while it is open', async () => {
    // The shell behind a scrim is meant to be unavailable, and this panel is not
    // the last focusable subtree in the document — so without a cycle, one Tab
    // walked out into the topbar and the panes underneath.
    renderPhoneShell();
    await openBurger();

    const links = navEl().querySelectorAll('a[href]');
    (links[links.length - 1] as HTMLElement).focus();
    await userEvent.tab();

    expect(navEl().contains(document.activeElement)).toBe(true);
  });
});
