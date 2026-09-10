// @vitest-environment happy-dom

/**
 * The three width classes, and what changes between them.
 *
 * This is the coordination-heavy part of the shell, and almost none of it is
 * checkable from a screenshot of one width: which pane is hidden from assistive
 * technology, whether the off-screen one still takes a tap, whether a swipe on a
 * scrolling thumb changes panes. Each case here names the width it is about,
 * because `happy-dom` defaults to 1024 — inside the medium band — so a test that
 * says nothing about width is silently a tablet test.
 *
 * @see components/app/shell/panes.tsx
 */

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Panes } from '@/components/app/shell/panes';
import { ShellTopbar } from '@/components/app/shell/shell-topbar';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));
vi.mock('@/hooks/use-theme', () => ({ useTheme: () => ({ theme: 'light', setTheme: vi.fn() }) }));

/**
 * The topbar renders alongside, because the pane switch lives there and driving
 * the carousel through anything else would be testing a path no reader has.
 */
function renderPanes(width: WidthName = 'large', pathname = '/app/journey') {
  mockPathname.current = pathname;
  return renderInShell(
    <>
      <ShellTopbar />
      <Panes>the module</Panes>
    </>,
    width
  );
}

/*
 * Queried by `data-pane`, not by role. A `<section aria-hidden="true">` is
 * exactly what half these cases are about, and role queries have their own
 * opinions about hidden subtrees — so the assertion would start depending on
 * Testing Library's accessibility-tree computation rather than on the DOM the
 * component produced.
 */
const chat = () => document.querySelector('[data-pane="chat"]');
const workspace = () => document.querySelector('[data-pane="ws"]');

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
});

describe("the route's own output always reaches the screen", () => {
  it('renders children on /app, where there is no workspace', () => {
    // THE ONE THAT MATTERED. `Workspace` returns null on `/app`, so rendering
    // children only inside it dropped the route's output there — and in App
    // Router `error.tsx` and `loading.tsx` ARE that output. An error thrown on
    // `/app`, the route every signed-in visitor lands on, painted a blank pane
    // with no message and no way back but the browser's own button.
    renderPanes('large', '/app');
    expect(screen.getByText('the module')).toBeTruthy();
  });

  it('renders children on a module route, inside the surface', () => {
    renderPanes('large', '/app/journey');
    const body = screen.getByText('the module');
    expect(body.closest('[data-pane="ws"]')).not.toBeNull();
  });

  it('puts them outside the surface on the clean view, since there is none', () => {
    renderPanes('large', '/app');
    expect(screen.getByText('the module').closest('[data-pane="ws"]')).toBeNull();
  });
});

describe('the clean view — /app', () => {
  it('is the conversation, filling the frame', () => {
    renderPanes('large', '/app');
    expect(chat()).not.toBeNull();
    expect(workspace()).toBeNull();
  });

  it('gives the conversation no resize handle, since there is nothing to size against', () => {
    renderPanes('large', '/app');
    expect(screen.queryByRole('separator')).toBeNull();
  });
});

describe('large — the two panes share the width', () => {
  it('shows both, and neither is hidden from assistive technology', () => {
    renderPanes('large');
    expect(chat()?.getAttribute('aria-hidden')).toBeNull();
    expect(workspace()?.getAttribute('aria-hidden')).toBeNull();
  });

  it('offers the resize handle as a real slider', () => {
    renderPanes('large');
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    // `aria-value*` is what makes it a slider rather than a rule: without them a
    // screen reader can focus it and learn nothing about what it does.
    expect(handle.getAttribute('aria-valuemin')).toBe('330');
    expect(handle.getAttribute('aria-valuemax')).toBe('660');
    expect(handle.getAttribute('aria-valuenow')).toBe('440');
  });
});

describe('small — the panes take turns', () => {
  it('opens on the module the reader asked for, not on the conversation', () => {
    // Arriving at `/app/journey` on a phone should SHOW the journey. It used to
    // render it off-screen and `inert` behind the conversation, so the reader
    // had to swipe or use the switch to reach the thing they had just tapped.
    renderPanes('small');
    expect(workspace()?.getAttribute('aria-hidden')).toBeNull();
    expect(chat()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stops the off-screen pane taking a tap it cannot be seen to take', () => {
    // A transform moves a pane out of view without making it inert; without
    // this, a tap near the edge lands on a control the reader cannot see.
    renderPanes('small');
    expect(chat()?.className).toContain('pointer-events-none');
  });

  it('swaps which pane is hidden when the switch moves', async () => {
    renderPanes('small');
    await userEvent.click(screen.getByRole('button', { name: 'Conversation' }));

    expect(chat()?.getAttribute('aria-hidden')).toBeNull();
    expect(workspace()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('drops the resize handle, because the panes no longer share width', () => {
    renderPanes('small');
    expect(screen.queryByRole('separator')).toBeNull();
  });
});

describe('the swipe, and what must NOT trigger it', () => {
  /** A touch drag across the panes, in one gesture. */
  function swipe(dx: number, dy = 0, pointerType = 'touch', target?: Element) {
    const surface = document.querySelector('[data-pane="chat"]')!.parentElement!;
    const on = target ?? surface;
    fireEvent.pointerDown(on, { clientX: 200, clientY: 300, pointerType, pointerId: 1 });
    fireEvent.pointerUp(surface, {
      clientX: 200 + dx,
      clientY: 300 + dy,
      pointerType,
      pointerId: 1,
    });
  }

  it('brings the conversation in on a swipe right', () => {
    // The conversation is on the LEFT in every layout, so the direction means
    // the same thing at every width — that is the whole reason it is worth a
    // gesture rather than only a control. A module route opens on the module,
    // so right is the way back to her.
    renderPanes('small');
    swipe(120);
    expect(chat()?.getAttribute('aria-hidden')).toBeNull();
  });

  it('sends her away again on a swipe left', () => {
    renderPanes('small');
    swipe(120);
    swipe(-120);
    expect(workspace()?.getAttribute('aria-hidden')).toBeNull();
  });

  it('ignores a drag too short to be a swipe', () => {
    renderPanes('small');
    swipe(40);
    expect(chat()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores a mostly-vertical drag, which is a scroll', () => {
    // Comparing the two axes rather than thresholding x alone is what stops a
    // scrolling thumb changing panes underneath itself.
    renderPanes('small');
    swipe(80, 200);
    expect(chat()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores a mouse drag, which is a text selection', () => {
    renderPanes('small');
    swipe(120, 0, 'mouse');
    expect(chat()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('ignores a drag that starts in the composer', () => {
    // Dragging to select what you typed must not navigate away from it.
    renderPanes('small');
    // Bring her in first: on a module route the conversation starts off-screen
    // and `inert`, so its composer is not in the accessibility tree at all.
    swipe(120);
    expect(chat()?.getAttribute('aria-hidden')).toBeNull();

    // Now drag LEFT from inside the composer — the direction that WOULD move to
    // the workspace if the guard were not there. The conversation must stay.
    const composer = screen.getByRole('textbox', { name: 'Message Lelañea' });
    swipe(-120, 0, 'touch', composer);
    expect(chat()?.getAttribute('aria-hidden')).toBeNull();
    expect(workspace()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('forgets a cancelled gesture, so the next tap is not measured against it', () => {
    // `start.current` was cleared only on `pointerup`. Release outside the
    // container — over the topbar or the rail — or let the browser cancel the
    // gesture, and the origin survived: the NEXT `pointerup` to reach this
    // element measured against it, including taps whose `pointerdown` the guards
    // had deliberately ignored.
    renderPanes('small');
    const surface = document.querySelector('[data-pane="chat"]')!.parentElement!;

    fireEvent.pointerDown(surface, {
      clientX: 400,
      clientY: 300,
      pointerType: 'touch',
      pointerId: 1,
    });
    fireEvent.pointerCancel(surface, { pointerId: 1 });
    // A plain tap, far from where the cancelled drag began.
    fireEvent.pointerUp(surface, {
      clientX: 100,
      clientY: 300,
      pointerType: 'touch',
      pointerId: 1,
    });

    expect(workspace()?.getAttribute('aria-hidden')).toBeNull();
  });

  it('ignores a release whose press it never saw', () => {
    // Different pointer id — a second finger, or a release that belongs to a
    // gesture this element never started.
    renderPanes('small');
    const surface = document.querySelector('[data-pane="chat"]')!.parentElement!;

    fireEvent.pointerDown(surface, {
      clientX: 400,
      clientY: 300,
      pointerType: 'touch',
      pointerId: 1,
    });
    fireEvent.pointerUp(surface, {
      clientX: 100,
      clientY: 300,
      pointerType: 'touch',
      pointerId: 2,
    });

    expect(workspace()?.getAttribute('aria-hidden')).toBeNull();
  });

  it('does not swipe at all above 900px, where both panes are on screen', () => {
    renderPanes('large');
    swipe(-120);
    expect(workspace()?.getAttribute('aria-hidden')).toBeNull();
    expect(chat()?.getAttribute('aria-hidden')).toBeNull();
  });
});
