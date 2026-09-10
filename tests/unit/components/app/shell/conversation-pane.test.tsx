// @vitest-environment happy-dom

/**
 * The conversation pane: the honest stub, and the drag that sizes it.
 *
 * The stub's rules moved here from `shell-home-page.test.tsx` when t-10 made the
 * pane the clean view. They matter more here than they did there, because this
 * is the surface phase 2 fills in — and the way a fake arrives is somebody
 * porting the prototype's transcript wholesale to "see how it looks".
 *
 * @see components/app/shell/conversation-pane.tsx
 */

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
});

describe('the composer is present, and inert', () => {
  it('renders a real textarea rather than a picture of one', () => {
    // The layout has to survive a growing composer before anything real is
    // typed into it, which is why this is a textarea now and not a later job.
    renderInShell(<ConversationPane />);
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeTruthy();
  });

  it('disables everything a person could try to send with', () => {
    renderInShell(<ConversationPane />);
    expect(screen.getByRole('textbox', { name: 'Message Lelañea' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Send/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /^Record a voice note/ })).toBeDisabled();
  });

  it('says why, where a person can actually read it', () => {
    // The same lesson as the rail's: a `title` on a disabled control never
    // fires, so the reason goes on an enabled wrapper and in the accessible
    // name.
    renderInShell(<ConversationPane />);
    const send = screen.getByRole('button', { name: /^Send/ });

    expect(send.getAttribute('aria-label')).toMatch(/arrives with the conversation/);
    expect(send.parentElement?.getAttribute('title')).toMatch(/arrives with the conversation/);
  });

  it('mocks up no conversation, and invents no number', () => {
    const { container } = renderInShell(<ConversationPane />);
    expect(container.textContent ?? '').not.toMatch(/\d/);
    // A transcript would arrive as list items or article elements.
    expect(container.querySelectorAll('article')).toHaveLength(0);
  });
});

describe('dragging the pane', () => {
  it('tracks the pointer', () => {
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 560, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe('500');

    fireEvent.pointerUp(handle, { clientX: 560, pointerId: 1 });
  });

  it('stops tracking once the pointer is released', () => {
    // A drag that keeps listening after `pointerup` follows the cursor around
    // the page — the classic resize bug, and invisible until you let go.
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 540, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 540, pointerId: 1 });

    const settled = handle.getAttribute('aria-valuenow');
    fireEvent.pointerMove(handle, { clientX: 640, pointerId: 1 });
    expect(handle.getAttribute('aria-valuenow')).toBe(settled);
  });

  it('folds to the strip when dragged past the fold', () => {
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });

    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });

    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });
});

describe('the strip', () => {
  it('is the whole button, not a disabled pane with a control on it', () => {
    renderInShell(<ConversationPane />);
    const handle = screen.getByRole('separator', { name: 'Resize the conversation' });
    fireEvent.pointerDown(handle, { clientX: 500, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 200, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 200, pointerId: 1 });

    const strip = screen.getByRole('button', { name: 'Open the conversation' });
    expect(strip.textContent).toContain('Ask Lelañea');
  });
});

describe('collapsing the conversation', () => {
  it('offers a control to do it, not only the Escape key', () => {
    // There was NO affordance at all: the surface click is a fallback, and
    // nothing on screen said the pane could collapse. Escape was the only way,
    // which is not a thing anyone discovers.
    renderInShell(<ConversationPane />, 'large');
    expect(screen.getByRole('button', { name: 'Collapse the conversation' })).toBeTruthy();
  });

  it('collapses to the strip when it is pressed', async () => {
    renderInShell(<ConversationPane />, 'large');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse the conversation' }));

    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });

  it('offers none on the clean view, where there is nothing to give the width to', () => {
    mockPathname.current = '/app';
    renderInShell(<ConversationPane />, 'large');
    expect(screen.queryByRole('button', { name: 'Collapse the conversation' })).toBeNull();
  });

  it('offers none on a phone, where the pane switch does this job', () => {
    renderInShell(<ConversationPane />, 'small');
    expect(screen.queryByRole('button', { name: 'Collapse the conversation' })).toBeNull();
  });
});
