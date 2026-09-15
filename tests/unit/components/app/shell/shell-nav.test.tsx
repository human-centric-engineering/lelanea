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
 * The footer's menu — its rows, the theme item, sign-out and the two drawer
 * collisions — has its own file, `account-menu.test.tsx`. Here it is only the
 * trigger that matters: that the nav hands it the person, in both widths.
 *
 * @see components/app/shell/shell-nav.tsx
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initialsFor, ShellNav } from '@/components/app/shell/shell-nav';
import { SHELL_OVERLAY_ATTR } from '@/components/app/shell/use-shell-layout';
import { ShellTopbar } from '@/components/app/shell/shell-topbar';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app' }));

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.current,
}));

// The account menu at the foot of the nav reads the theme and, on sign-out,
// analytics. Neither is measured here; `account-menu.test.tsx` renders the real
// `ThemeProvider` for the cases that are about it.
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  useAnalytics: () => ({ track: vi.fn(), reset: vi.fn() }),
  EVENTS: { USER_LOGGED_OUT: 'user_logged_out' },
}));

const USER = { name: 'Maya Reyes', email: 'maya@example.com', image: null, role: null };

/**
 * `large` by default, and stated deliberately: at happy-dom's own 1024px default
 * the provider auto-slims the nav, so every label and tooltip case below would
 * be silently asserting against a collapsed menu.
 */
function renderAt(pathname: string, width: WidthName = 'large') {
  mockPathname.current = pathname;
  return renderInShell(<ShellNav user={USER} />, width);
}

/**
 * The nav WITH the topbar, for the one case that has to open the drawer.
 *
 * The burger that opens it lives in `shell-topbar.tsx`, deliberately outside
 * the `<nav>` — which is what makes marking the closed panel `inert` safe. A
 * test that rendered only the nav could not reach the opener at all, and would
 * be measuring the half of the mechanism that is not the point.
 */
function renderWithTopbar(width: WidthName = 'small') {
  mockPathname.current = '/app';
  return renderInShell(
    <>
      <ShellTopbar />
      <ShellNav user={USER} />
    </>,
    width
  );
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

  it('marks "Workspace" current on a module page — a module IS the workspace', () => {
    renderAt('/app/modules/values');
    expect(currentItems()).toEqual(['Workspace']);
  });

  it('sends "Workspace" to the landing until a module has been visited', () => {
    renderAt('/app/journey');
    expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
      'href',
      '/app/workspace'
    );
  });

  it('sends "Workspace" to the last module visited, once one has been', async () => {
    // What the module page's `RememberModule` writes, in the same key.
    window.localStorage.setItem('lelanea.workspace.lastModule', JSON.stringify('boundaries'));
    renderAt('/app/journey');
    await waitFor(() =>
      expect(screen.getByRole('link', { name: 'Workspace' })).toHaveAttribute(
        'href',
        '/app/modules/boundaries'
      )
    );
  });

  it('renders the five destinations, and no longer the two that moved', () => {
    renderAt('/app');
    for (const label of [
      'The conversation',
      'Workspace',
      'Your journey',
      'Life situations',
      'Share with Lelañea',
    ]) {
      expect(screen.getByRole('link', { name: new RegExp(label) })).toBeTruthy();
    }
    // Usage and Settings live in the account menu now — one place, not two.
    // A row here again would be the duplicate the owner ruled out.
    expect(screen.queryByRole('link', { name: /Usage and billing/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /Settings/ })).toBeNull();
  });
});

describe('ShellNav — the account footer is the real person', () => {
  it('shows the session name and initials, not a placeholder — and no email in the row', () => {
    renderAt('/app');
    expect(screen.getByText('Maya Reyes')).toBeTruthy();
    expect(screen.getByText('MR')).toBeTruthy();
    // The email moved into the menu's header (t-40, owner ruling): the row is
    // avatar + name, as the Hub's footer is.
    expect(screen.queryByText('maya@example.com')).toBeNull();
  });

  it('invents no session count', () => {
    // The prototype's footer reads "eleven sessions". Nothing counts sessions
    // yet, so D6 says omit rather than fake — and a digit in this subtree is
    // how that would come back.
    renderAt('/app');
    const footer = screen.getByRole('button', { name: /Maya Reyes/ });
    expect(footer.textContent).not.toMatch(/\d/);
  });

  it('is a menu trigger named by the person, not a link', () => {
    // EXACT name: the avatar's initials are text inside the button, and unhidden
    // they join its name as "MR Maya Reyes…" — which a `/Maya Reyes/` match
    // would pass. `aria-haspopup` is what says the footer opens something.
    renderAt('/app');
    const trigger = screen.getByRole('button', { name: 'Maya Reyes' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(screen.queryByRole('link', { name: /Maya Reyes/ })).toBeNull();
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
    // Five destinations and the wordmark — which keeps its own `aria-label`
    // when its text is hidden, so it stays a link. The account footer is a
    // button, not a link, since it opens a menu.
    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Lelañea, back to the site' })).toBeTruthy();
  });

  it('gives every item the brand tooltip carrying its hint', async () => {
    // In slim mode the label is hidden, so `label — hint` is the only thing
    // telling two icons apart. It is the BRAND tooltip now, not the browser's
    // `title`: a different shape, an unstyleable delay, and it fires on touch.
    renderAt('/app');
    await userEvent.click(toggle());

    const item = screen.getByRole('link', { name: /Life situations/ });
    expect(item.getAttribute('title')).toBeNull();

    // The bubble is the link's own sibling, `aria-hidden`, and present in the
    // DOM from the start so it has something to fade from.
    const bubble = item.nextElementSibling;
    expect(bubble?.textContent).toBe('Life situations — What you are living through');
    expect(bubble?.getAttribute('aria-hidden')).toBe('true');
    expect(bubble?.className).toContain('invisible');
  });

  it('drops the tooltips again when labelled, so they are not doubled', () => {
    // The prototype's own rule: an open menu already says what each item is
    // (`.lnav:not(.slim) .lnav-item::after { content: none }`). With no label
    // there is no bubble element at all, not merely a hidden one.
    renderAt('/app');
    const item = screen.getByRole('link', { name: /Life situations/ });
    expect(item.getAttribute('title')).toBeNull();
    expect(item.nextElementSibling?.textContent).not.toContain('What you are living through');
  });

  it("uses the design's own collapse pair, pointing where the menu is going", async () => {
    // Two bars and a chevron — `<||` to collapse, `||>` to expand — ported
    // path-for-path from the prototype. lucide's `PanelLeftClose`/`PanelLeftOpen`
    // were the nearest thing in the kit and are a different drawing: a full
    // panel outline with an arrow inside, which reads as a window rather than
    // as an edge being pushed. This is the only glyph in the shell that has to
    // communicate a DIRECTION rather than a destination.
    renderAt('/app');
    const glyph = () => toggle().querySelector('svg')?.innerHTML ?? '';

    // Collapse: chevron pointing left, bars on the right.
    expect(glyph()).toContain('m10 9-3 3 3 3');
    expect(glyph()).toContain('M20 5v14');

    await userEvent.click(toggle());
    // Expand: chevron pointing right, bars on the left.
    expect(glyph()).toContain('m14 9 3 3-3 3');
    expect(glyph()).toContain('M4 5v14');
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

  it('gives the collapse control a tooltip too, since it is always in the rail', async () => {
    // Every other icon in the 64px rail raises one, and this is the control
    // that is ALWAYS there — the one with no hover hint reads as the odd one
    // out rather than as the obvious way back. Expanded, the label would be
    // noise beside a menu that already says what it is.
    renderAt('/app');
    const control = () => screen.getByRole('button', { name: /the menu/ });
    expect(control().nextElementSibling).toBeNull();

    await userEvent.click(control());
    expect(control().nextElementSibling?.textContent).toBe('Expand the menu');
  });

  it('keeps the account footer reachable at 64px, still named by the person', async () => {
    renderAt('/app');
    await userEvent.click(toggle());

    const account = screen.getByRole('button', { name: 'Maya Reyes' });
    expect(account.getAttribute('aria-haspopup')).toBe('menu');
    expect(account.getAttribute('title')).toBe('Maya Reyes');
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
  const regions = () => Array.from(document.querySelectorAll<HTMLElement>('nav > div'));

  it('keeps the brand row the same height in both states', async () => {
    // The defect this guards, and the reason the collapse control can live at
    // the top at all: the prototype stacks the mark above the control when slim,
    // which makes the top area taller in one state than the other — so every nav
    // icon below it shifted down as the menu collapsed. Collapsing should move
    // the right edge and nothing else.
    //
    // It is solved by RESERVING the taller of the two heights in both states,
    // not by moving the control out of the row, which is what t-22 did and what
    // t-33 was raised to undo. So `flex-col` when slim is now correct and the
    // height is what has to hold.
    renderAt('/app');
    const expanded = regions()[0].className;

    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    const slim = regions()[0].className;

    // 72px, and the number is measured rather than eyeballed: `LotusMark` sizes
    // by BLOOM width, not frame height, so `size={30}` renders 46 × 30 — the
    // slim stack is 30 + 10 + 32. This said 70 on the strength of a "25px mark"
    // and was two pixels short of its own contents, every child `flex-none`.
    expect(expanded).toContain('h-[72px]');
    expect(slim).toContain('h-[72px]');
    // The stack is the prototype's layout; only its HEIGHT was ever the problem.
    expect(slim).toContain('flex-col');
    expect(expanded).not.toContain('flex-col');
  });

  it('puts the collapse control at the top, under the mark, and nowhere else', async () => {
    renderAt('/app');
    const [brand, , footer] = regions();

    // One control, in the brand row, where the design draws it. The footer has
    // a button of its own — the account menu's trigger — so the assertion is
    // about the COLLAPSE control being absent from it, not about buttons.
    expect(brand.querySelector('button')).not.toBeNull();
    expect(within(footer).queryByRole('button', { name: /the menu/ })).toBeNull();
    // The footer is the account and only the account.
    expect(footer.textContent).toContain(USER.name);
    expect(screen.getAllByRole('button', { name: /the menu/ })).toHaveLength(1);

    // And it stays in the brand row when slim, rather than trading places.
    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    expect(regions()[0].querySelector('button')).not.toBeNull();
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

describe('ShellNav — clicking away collapses it', () => {
  /** A press on the page background, which is what a click-away actually is. */
  const pressBackground = () =>
    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

  it('collapses on a press that lands on nothing', async () => {
    renderAt('/app');
    const nav = document.querySelector('nav');
    expect(nav?.className).toContain('w-[234px]');

    pressBackground();
    await waitFor(() => expect(nav?.className).toContain('w-16'));
  });

  it('does NOT write the preference, so a stray press cannot rewrite a choice', async () => {
    // The whole reason this is a separate verb from the collapse control. The
    // control is somebody stating how they like their menu; a press that landed
    // on the background is not, and persisting it would leave them to find the
    // setting again. Divergence Row 2's rule, applied to a third cause.
    renderAt('/app');
    const nav = document.querySelector('nav');

    pressBackground();
    await waitFor(() => expect(nav?.className).toContain('w-16'));
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBeNull();
  });

  it('ignores a press on a control, so using the app does not fold the menu', async () => {
    // Without this guard every button, link and checkbox in the workspace
    // collapsed the menu as a side effect of being used — the app flinching
    // rather than dismissing something. Same list `workspace.tsx` guards its
    // own re-park gesture with.
    renderAt('/app');
    const nav = document.querySelector('nav');

    const item = screen.getByRole('link', { name: /Life situations/ });
    await act(async () => {
      item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(nav?.className).toContain('w-[234px]');
  });

  it('does nothing out in the panes once it is already slim', async () => {
    // There is nothing left to collapse, and a press out there says nothing
    // about how the reader likes their menu either way.
    renderAt('/app');
    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    const nav = document.querySelector('nav');
    expect(nav?.className).toContain('w-16');

    pressBackground();
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBe('true');
    expect(nav?.className).toContain('w-16');
  });

  it('brings the menu BACK when its own dead space is pressed', async () => {
    // The collapsed rail is a 64px column of mostly nothing. Making that dead
    // would leave one 32px control as the only way back — so a press inside the
    // menu works the menu, in both directions.
    renderAt('/app');
    const nav = document.querySelector('nav');
    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    expect(nav?.className).toContain('w-16');

    await act(async () => {
      nav!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(nav?.className).toContain('w-[234px]');
  });

  it('persists a press on its own dead space, because it is aimed at the menu', async () => {
    // The asymmetry with the click-away above, and the reason they are two
    // different verbs: this one IS a reader working the control, just with a
    // bigger target.
    renderAt('/app');
    const nav = document.querySelector('nav');

    await act(async () => {
      nav!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(nav?.className).toContain('w-16');
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBe('true');
  });

  it('ignores a right-click, which is about to open a context menu', async () => {
    // `pointerdown` fires for button 2 as well, so a right-click anywhere in
    // the panes restructured the layout underneath the menu about to appear
    // over it.
    renderAt('/app');
    const nav = document.querySelector('nav');

    act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 2 }));
    });
    expect(nav?.className).toContain('w-[234px]');
  });

  it('stands down while a full-screen overlay is up', async () => {
    // The entry bloom is `fixed inset-0 z-[100]` for its ~2.9s and deliberately
    // solid to the pointer, so a click cannot reach a nav item nobody can see.
    // `pointer-events` decides that by HIT-TESTING, and a listener bound to
    // `document` is not under anything — so a click during the opening
    // animation collapsed the reader's menu as their first interaction with the
    // app. An overlay says so with `SHELL_OVERLAY_ATTR`.
    renderAt('/app');
    const nav = document.querySelector('nav');

    const overlay = document.createElement('div');
    overlay.setAttribute(SHELL_OVERLAY_ATTR, '');
    document.body.appendChild(overlay);
    act(() => {
      overlay.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(nav?.className).toContain('w-[234px]');
    overlay.remove();
  });

  it('leaves the ≤900px drawer alone — it has a scrim of its own', async () => {
    // Below 900px the menu is a panel over a scrim, and `slim` is ignored
    // entirely. A click-away there is the scrim's job, and collapsing to a rail
    // nobody can see would be a preference flipped for no visible reason.
    renderWithTopbar('small');
    await userEvent.click(screen.getByRole('button', { name: 'Open the menu' }));

    const nav = document.querySelector('nav');
    expect(nav?.className).toContain('translate-x-0');

    pressBackground();
    expect(nav?.className).toContain('translate-x-0');
  });
});

describe('ShellNav — the column survives a short window', () => {
  it('scrolls rather than clipping its last items', () => {
    // The shell is `h-dvh overflow-hidden` and every nav child is `flex-none`,
    // so with enough rows there is nothing on the page able to reach the last
    // of them or the account footer once the viewport is short enough — a
    // phone in landscape, or a short desktop window. The scroll container is
    // the only thing that fixes it, and jsdom cannot measure layout, so the
    // container is what is asserted.
    const { container } = renderAt('/app');
    const list = container.querySelector('nav > div:nth-of-type(2)');

    expect(list?.className).toContain('overflow-y-auto');
    expect(list?.className).toContain('min-h-0');
  });

  it('never renders the stored preference at the wrong width', async () => {
    // THE CASE BOTH EARLIER FIXES GOT WRONG, and the one that makes an
    // unconditional transition safe. `useLocalStorage` returns its `initial` on
    // the first render and adopts the stored value in a plain effect — after
    // paint — so a reader who had chosen the slim nav watched it render at 234px
    // and correct to 64px on every page load.
    //
    // Suppressing the transition until the reader had used the control hid that,
    // and hid the first collapse and every auto-slim with it. The provider now
    // adopts the preference in a LAYOUT effect instead, so the correction lands
    // before the browser paints and there is no earlier frame to animate from.
    //
    // The assertion is therefore about the WIDTH, not about the transition: RTL
    // flushes layout effects synchronously, so the first DOM anyone can observe
    // is already the stored one. `w-[234px]` appearing here at all is the bug.
    window.localStorage.setItem('lelanea.nav.slim', 'true');
    renderAt('/app');
    const nav = document.querySelector('nav');

    expect(nav?.className).toContain('w-16');
    expect(nav?.className).not.toContain('w-[234px]');
    // And it stays put — nothing later in the mount undoes it.
    await waitFor(() => expect(nav?.className).toContain('w-16'));
  });

  it('animates every collapse, including the first one', async () => {
    // The old gate armed the transition from the same click that changed the
    // width, so both landed in one commit and the FIRST collapse had nothing to
    // transition from. Resolved through `cn`, the class list simply had no
    // `transition-*` in it until a reader had already collapsed the menu once.
    renderAt('/app');
    const nav = document.querySelector('nav');
    expect(nav?.className).toContain('transition-[width]');

    await userEvent.click(screen.getByRole('button', { name: /the menu/ }));
    expect(nav?.className).toContain('transition-[width]');
    expect(nav?.className).toContain('w-16');
    // `prefers-reduced-motion` still switches it off.
    expect(nav?.className).toContain('motion-reduce:transition-none');
  });
});

describe('ShellNav — the drawer is out of reach while it is shut', () => {
  it('is inert below 900px until it is opened', async () => {
    // `invisible` alone does not close this. It shares a transition with the
    // transform, and `visibility` flips DISCRETELY at the END of a transition —
    // so for the 300ms of a close every link in the panel is still tabbable
    // while sliding off screen. `drawer.tsx` answers the same problem with
    // `inert` and its comment claimed this file already did; it did not, until
    // t-22 went looking for the pattern in order to document it.
    renderWithTopbar('small');
    expect(screen.getByRole('navigation', { name: 'Main' }).hasAttribute('inert')).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Open the menu' }));
    expect(screen.getByRole('navigation', { name: 'Main' }).hasAttribute('inert')).toBe(false);
  });

  it('is never inert above 900px, where it is a column and not a panel', () => {
    // The guard that stops the fix above from making the desktop nav unusable —
    // it is the same element at every width.
    for (const width of ['medium', 'large'] as const) {
      const { unmount } = renderAt('/app', width);
      expect(screen.getByRole('navigation', { name: 'Main' }).hasAttribute('inert'), width).toBe(
        false
      );
      unmount();
    }
  });

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
