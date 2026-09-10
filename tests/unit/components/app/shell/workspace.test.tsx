// @vitest-environment happy-dom

/**
 * The workspace surface — the frame t-11's views arrive inside.
 *
 * Two things here are structural rather than cosmetic, and both would be easy to
 * lose later: the workspace closes by NAVIGATING (so the URL and the frame can
 * never disagree, including on a back press), and the surface body owns its own
 * scrolling (so a long view inside `h-dvh overflow-hidden` is not clipped
 * unreachable — the defect t-9 hit with the error card).
 *
 * @see components/app/shell/workspace.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { Workspace } from '@/components/app/shell/workspace';
import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));

/** The conversation renders alongside: the park/un-park cases act on its strip. */
function renderWorkspace(width: WidthName = 'large', pathname = '/app/journey') {
  mockPathname.current = pathname;
  return renderInShell(
    <>
      <ConversationPane />
      <Workspace>the module</Workspace>
    </>,
    width
  );
}

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
});

describe('when it is open', () => {
  it('is open on any route below /app, and closed on /app itself', () => {
    renderWorkspace('large', '/app').unmount();
    expect(document.querySelector('[data-pane="ws"]')).toBeNull();

    renderWorkspace('large', '/app/journey');
    expect(document.querySelector('[data-pane="ws"]')).not.toBeNull();
  });

  it('renders whatever the route put in it', () => {
    renderWorkspace();
    expect(screen.getByText('the module')).toBeTruthy();
  });
});

describe('closing it', () => {
  it('closes by navigating, not by calling a setter', () => {
    // `wsOpen` is derived from the route. A button flipping a boolean would be a
    // second source of truth for something the URL already knows, and the two
    // would disagree the moment someone pressed the back button.
    renderWorkspace();
    const back = screen.getByRole('link', { name: /Return to the conversation/ });
    expect(back.getAttribute('href')).toBe('/app');
  });
});

describe('the surface body scrolls, not the frame', () => {
  it('owns its own scroll container', () => {
    // The shell is `h-dvh overflow-hidden`, so without this a long view is
    // clipped with nothing able to reach it — including `error.tsx`, which
    // renders here.
    renderWorkspace();
    const body = screen.getByText('the module');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
  });

  it('leaves room for a focus ring at the horizontal edge', () => {
    // `overflow-y` set to a non-visible value takes `overflow-x` with it, so a
    // ring on a focused control at the edge is clipped without the padding pair.
    // The same trap that clipped the nav's active item in t-9.
    renderWorkspace();
    const body = screen.getByText('the module');
    expect(body.className).toContain('-mx-1');
    expect(body.className).toContain('px-1');
  });
});

describe('the tablet re-parks the conversation', () => {
  it('parks it when the surface is clicked at medium', async () => {
    renderWorkspace('medium');
    // Medium with the workspace open parks it already, so un-park first — that
    // is what makes this a test of the click rather than of the initial state.
    await userEvent.click(screen.getByRole('button', { name: 'Open the conversation' }));
    expect(screen.queryByRole('button', { name: 'Open the conversation' })).toBeNull();

    await userEvent.click(screen.getByText('the module'));
    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });

  it('does nothing on a click at large, where both panes are on screen', async () => {
    renderWorkspace('large');
    await userEvent.click(screen.getByText('the module'));
    expect(screen.queryByRole('button', { name: 'Open the conversation' })).toBeNull();
  });
});
