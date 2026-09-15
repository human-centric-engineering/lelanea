// @vitest-environment happy-dom

/**
 * Resize, fold, and the Escape chain.
 *
 * All three are keyboard-reachable on purpose and none is visible in a
 * screenshot, so this is the only place they are checked. The resize handle in
 * particular has to work with no pointer at all — that is what `role="separator"`
 * with the `aria-value*` trio promises, and a promise nothing tests is a promise
 * that quietly stops being true.
 *
 * @see components/app/shell/use-shell-layout.tsx · conversation-pane.tsx
 */

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Panes } from '@/components/app/shell/panes';
import { ShellNav } from '@/components/app/shell/shell-nav';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { ShellTopbar } from '@/components/app/shell/shell-topbar';
import { CHAT_MAX, CHAT_MIN } from '@/components/app/shell/use-shell-layout';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));
// `ShellNav` mounts the account menu, whose hooks want their providers. Neither
// theme nor analytics is what this file measures, so both are stubbed.
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  useAnalytics: () => ({ track: vi.fn(), reset: vi.fn() }),
  EVENTS: { USER_LOGGED_OUT: 'user_logged_out' },
}));

function renderShell(width: WidthName | number = 'large') {
  return renderInShell(
    <>
      <ShellNav user={{ name: 'Simon H', email: 'simon@example.com', role: null }} />
      <ShellRail />
      <Panes>the module</Panes>
    </>,
    width
  );
}

const handle = () => screen.getByRole('separator', { name: 'Resize the conversation' });
const widthNow = () => Number(handle().getAttribute('aria-valuenow'));
const strip = () => screen.queryByRole('button', { name: 'Open the conversation' });

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
});

describe('resizing the conversation with the keyboard', () => {
  it('moves by 16px, and by 48 with shift', async () => {
    renderShell();
    handle().focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(widthNow()).toBe(456);

    await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(widthNow()).toBe(504);
  });

  it('stops at the bounds rather than running past them', async () => {
    renderShell();
    handle().focus();

    // Far more presses than the range needs, so a missing clamp overshoots.
    await userEvent.keyboard('{Shift>}{ArrowRight>20/}{/Shift}');
    expect(widthNow()).toBe(CHAT_MAX);

    // AND the stored value, which is the assertion that can actually see the
    // clamp. `aria-valuenow` alone cannot: the width is re-clamped on the way
    // back OUT of storage, so removing the clamp on the way in leaves the
    // displayed number correct and the stored one wrong. Proved by sabotage —
    // without this line, deleting the clamp entirely still passed.
    expect(window.localStorage.getItem('lelanea.chat.width')).toBe(String(CHAT_MAX));

    await userEvent.keyboard('{Shift>}{ArrowLeft>3/}{/Shift}');
    expect(widthNow()).toBeGreaterThanOrEqual(CHAT_MIN);
  });

  it('remembers the width for this browser', async () => {
    renderShell();
    handle().focus();
    await userEvent.keyboard('{ArrowRight}');

    expect(window.localStorage.getItem('lelanea.chat.width')).toBe('456');
  });
});

describe('folding it into the strip', () => {
  it('folds when squeezed past 296, rather than clamping at the minimum', async () => {
    // The distinction that matters: squeezing it narrow is a way of asking for
    // it GONE. Clamping at 330 instead would make the fold unreachable by
    // keyboard entirely.
    renderShell();
    handle().focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft>6/}{/Shift}');

    expect(strip()).not.toBeNull();
  });

  it('brings it back when the strip is pressed', async () => {
    renderShell();
    handle().focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft>6/}{/Shift}');

    await userEvent.click(strip()!);
    expect(strip()).toBeNull();
  });
});

describe('the Escape chain', () => {
  it('closes an open drawer first', async () => {
    renderShell();
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));
    expect(screen.getByRole('button', { name: /Your map/ }).getAttribute('aria-expanded')).toBe(
      'true'
    );

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Your map/ }).getAttribute('aria-expanded')).toBe(
      'false'
    );
  });

  it('parks the conversation on a tablet before it touches anything else', async () => {
    // At medium the strip is ALWAYS present — it rides on the panel's right
    // edge — so parked-ness is the panel's transform, not the strip's presence.
    renderShell('medium');
    const chat = () => document.querySelector('[data-pane="chat"]')!;
    expect(chat().className).toContain('-translate-x-[364px]');

    await userEvent.click(strip()!);
    expect(chat().className).toContain('translate-x-0');

    await userEvent.keyboard('{Escape}');
    expect(chat().className).toContain('-translate-x-[364px]');
  });

  it('un-folds the conversation when there is nothing else left to close', async () => {
    renderShell();
    handle().focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft>6/}{/Shift}');
    expect(strip()).not.toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(strip()).toBeNull();
  });

  it('takes the rungs in order — the drawer before the fold', async () => {
    // Both are open at once, so a chain that fired independent handlers would
    // close both on one press. The order is the whole design.
    renderShell();
    handle().focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft>6/}{/Shift}');
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /Your map/ }).getAttribute('aria-expanded')).toBe(
      'false'
    );
    expect(strip(), 'the fold should survive the press that closed the drawer').not.toBeNull();
  });
});

describe('the tablet parks the conversation when a module opens', () => {
  it('folds it as soon as the workspace is open at medium', () => {
    renderShell('medium');
    expect(document.querySelector('[data-pane="chat"]')?.className).toContain(
      '-translate-x-[364px]'
    );
  });

  it('leaves it alone on the clean view', () => {
    // No workspace, so nothing to park against and no panel at all.
    mockPathname.current = '/app';
    renderShell('medium');
    expect(strip()).toBeNull();
    expect(document.querySelector('[data-pane="chat"]')?.className).not.toContain('absolute');
  });
});

describe('leaving a module', () => {
  /** Same provider instance, route changes — what a client navigation does. */
  function navigate(to: string, rerender: (ui: React.ReactElement) => void) {
    mockPathname.current = to;
    rerender(
      <>
        <ShellRail />
        <Panes>the module</Panes>
      </>
    );
  }

  it('un-folds the conversation, because there is nothing left to fold against', () => {
    // At medium the workspace parks the conversation. Resetting only `pane` on
    // the way out left `chatSlim` set — so "Return to the conversation" produced
    // a screen with no conversation on it: the workspace unmounts, the panel
    // stops being an overlay, and the pane takes its folded early return. A
    // 56px strip beside empty space.
    const { rerender } = renderShell('medium');
    expect(document.querySelector('[data-pane="chat"]')?.className).toContain(
      '-translate-x-[364px]'
    );

    navigate('/app', rerender);
    expect(document.querySelector('[data-pane="chat"]')).not.toBeNull();
    expect(strip()).toBeNull();
  });

  it('un-folds a conversation the reader folded themselves, too', async () => {
    // Not only the automatic park: with no work to give the width to, a fold
    // means nothing whoever asked for it.
    const { rerender } = renderShell('large');
    handle().focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft>6/}{/Shift}');
    expect(strip()).not.toBeNull();

    navigate('/app', rerender);
    expect(strip()).toBeNull();
  });
});

describe('the auto-slim fires on crossing, not on every resize', () => {
  function resizeTo(px: number) {
    Object.defineProperty(window, 'innerWidth', { value: px, writable: true, configurable: true });
    fireEvent(window, new Event('resize'));
  }

  it('does not undo an explicit expand on the next resize event', () => {
    // `resize` fires continuously while a window is dragged. Re-asserting the
    // slim on each one meant that between 901 and 1099 an expand was undone by
    // the very next event, and the toggle appeared not to work at all.
    // 1050, not 1100: the threshold is `< 1100`, so 1100 itself is outside it.
    renderShell(1050);
    const nav = () => document.querySelector('nav[aria-label="Main"]');
    expect(nav()?.getAttribute('data-slim')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /the menu/ }));
    expect(nav()?.getAttribute('data-slim')).toBe('false');

    resizeTo(1050); // still inside the band — must not re-slim
    expect(nav()?.getAttribute('data-slim')).toBe('false');
  });

  it('still slims when the threshold is actually crossed', () => {
    renderShell('large');
    const nav = () => document.querySelector('nav[aria-label="Main"]');
    expect(nav()?.getAttribute('data-slim')).toBe('false');

    resizeTo(1000);
    expect(nav()?.getAttribute('data-slim')).toBe('true');
  });
});

describe('Ask Lelañea and the left menu are mutually exclusive WHERE THEY COMPETE', () => {
  // The owner's reason was that the two crowd the conversation off the screen,
  // and that is a statement about one geometry: at `medium` with the workspace
  // open the conversation is a fixed 420px panel riding over the work while the
  // menu is a 234px column in the flow. At `large` both panes are in the flow
  // and the reader sizes the conversation themselves. Applied everywhere, the
  // rule folded the conversation to a 56px strip on a 1600px screen, where a
  // 234px menu and a 440px pane fit with room to spare.
  const nav = () => document.querySelector('nav[aria-label="Main"]');
  const slimNow = () => nav()?.getAttribute('data-slim');

  // 1200, not the `medium` alias: that resolves below the 1100px auto-slim
  // threshold, where the nav is already slim on arrival — so a case asserting
  // "opening the conversation collapsed it" would pass without the rule
  // existing at all. 1200 is medium AND above the threshold, so the only thing
  // that can collapse the menu is the rule under test.
  it('collapses the menu when the conversation is opened on a tablet', async () => {
    renderShell(1200);
    // At medium with a workspace open the conversation parks itself, so the
    // strip is already there.
    const pull = strip();
    expect(pull).not.toBeNull();

    await userEvent.click(pull!);
    expect(slimNow()).toBe('true');
  });

  it('does NOT hand a 234px menu back to a 1000px tablet', async () => {
    // The regression the first fix introduced. `slimOverride` is one slot with
    // two writers, and releasing it to `null` handed the menu back to the
    // STORED preference even when `fit`'s auto-slim had been the one holding
    // it. At 1000px — medium, and below the 1100px threshold — a reader whose
    // stored preference is "expanded" loads slim, and parking the conversation
    // put the full menu back on a tablet with no crossing left to re-assert the
    // rule. The release asks the viewport the same question `fit` does.
    renderShell(1000);
    expect(slimNow()).toBe('true');

    await userEvent.click(strip()!);
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the conversation' }));
    expect(slimNow()).toBe('true');
  });

  it('gives the menu back when the conversation is parked again', async () => {
    // The half that was missing. The only thing that ever released the override
    // was `fit`'s outward 1100px crossing, which at a fixed window width never
    // happens — so a reader who opened the conversation once kept a collapsed
    // menu for the rest of the session. That is the failure the override exists
    // to prevent, one level down.
    renderShell(1200);
    await userEvent.click(strip()!);
    expect(slimNow()).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: 'Collapse the conversation' }));
    expect(slimNow()).toBe('false');
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBeNull();
  });

  it('parks the conversation when the menu is expanded on a tablet', async () => {
    renderShell(1200);
    await userEvent.click(strip()!);
    expect(strip()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Expand the menu' }));
    expect(strip()).not.toBeNull();
  });

  it('does NOT fold the conversation when the menu is expanded at large', async () => {
    // On a 1600px screen there is nothing to get out of the way of, and a
    // conversation vanishing reads as a bug rather than as a considerate layout.
    renderShell('large');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand the menu' }));

    expect(strip()).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
  });

  it('does NOT collapse the menu when the conversation is opened at large', async () => {
    renderShell('large');
    handle().focus();
    await userEvent.keyboard('{Shift>}{ArrowLeft>6/}{/Shift}');
    expect(strip()).not.toBeNull();

    await userEvent.click(strip()!);
    expect(slimNow()).toBe('false');
  });

  it('does not park a conversation that has no workspace beside it', async () => {
    // With nothing to give the width to, folding leaves a 56px sliver against
    // empty space — the defect the `!wsOpen` reset already exists to prevent.
    mockPathname.current = '/app';
    renderShell('medium');

    // Medium is under 1100, so the nav arrives already auto-slimmed — expanding
    // it is the gesture under test either way.
    await userEvent.click(screen.getByRole('button', { name: 'Expand the menu' }));
    expect(strip()).toBeNull();
  });

  it('opening the conversation does not rewrite the stored menu preference', () => {
    // Asking for the conversation is not a statement about how you like your
    // menu. Same reasoning as the click-away, and as the 1100px auto-slim.
    renderShell('medium');
    expect(window.localStorage.getItem('lelanea.nav.slim')).toBeNull();
  });
});

describe('Escape goes through the verbs, not the setters beneath them', () => {
  // Both verbs grew a second half in this branch — `closeNav` hands focus back
  // to the burger, `setChatSlim` releases the menu override — and a rung
  // calling the raw setter gets the first half only. That is worse than never
  // having added them: the same user-visible action then behaves one way from
  // the button and another from the key, and Escape is the rung that can least
  // afford it, being keyboard-only.
  const nav = () => document.querySelector('nav[aria-label="Main"]');

  it('releases the menu override when Escape parks the conversation', async () => {
    renderShell(1200);
    await userEvent.click(strip()!);
    expect(nav()?.getAttribute('data-slim')).toBe('true');

    await userEvent.keyboard('{Escape}');
    expect(strip()).not.toBeNull();
    // The collapse BUTTON already did this. The key has to agree with it.
    expect(nav()?.getAttribute('data-slim')).toBe('false');
  });

  it('hands focus back to the burger when Escape closes the ≤900px drawer', async () => {
    // The panel goes `inert` the instant it closes, so focus left on it drops
    // to `<body>` and the next Tab restarts from the top of the document.
    renderInShell(
      <>
        <ShellTopbar />
        <ShellNav user={{ name: 'Simon H', email: 'simon@example.com' }} />
      </>,
      'small'
    );
    const burger = screen.getByRole('button', { name: 'Open the menu' });
    await userEvent.click(burger);

    await userEvent.keyboard('{Escape}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open the menu' }));
  });
});
