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

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Panes } from '@/components/app/shell/panes';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { CHAT_MAX, CHAT_MIN } from '@/components/app/shell/use-shell-layout';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));

function renderShell(width: WidthName = 'large') {
  return renderInShell(
    <>
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
    // Medium with the workspace open already parks it, so un-parking first is
    // what makes this a test of the rung rather than of the initial state.
    renderShell('medium');
    await userEvent.click(strip()!);
    expect(strip()).toBeNull();

    await userEvent.keyboard('{Escape}');
    expect(strip()).not.toBeNull();
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
    expect(strip()).not.toBeNull();
  });

  it('leaves it alone on the clean view', () => {
    mockPathname.current = '/app';
    renderShell('medium');
    expect(strip()).toBeNull();
  });
});
