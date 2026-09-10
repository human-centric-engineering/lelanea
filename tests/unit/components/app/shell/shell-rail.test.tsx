// @vitest-environment happy-dom

/**
 * The right rail — a deliberate stub, and the test that keeps it deliberate.
 *
 * The two buttons open drawers `t-10` builds, so between that merge and this
 * one they do nothing. `B31` allows exactly three honest responses to that, and
 * the one taken here is the middle one: ship a stub that says what it is.
 *
 * The reason this needs a test rather than a comment is the failure mode of the
 * other two options. If `disabled` is ever dropped — by someone tidying, or by
 * `t-10` wiring one button and forgetting the other — the rail silently becomes
 * `B31`'s dishonest fourth option: a control that looks live, accepts the click,
 * and does nothing. Nothing about that fails a type-check or a screenshot.
 *
 * @see components/app/shell/shell-rail.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ShellRail } from '@/components/app/shell/shell-rail';

import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));

describe('ShellRail', () => {
  it('is the fourth column, present and labelled', () => {
    renderInShell(<ShellRail />);
    expect(screen.getByRole('navigation', { name: 'Panels' })).toBeTruthy();
  });

  it('offers the map and the resources', () => {
    renderInShell(<ShellRail />);
    expect(screen.getByRole('button', { name: /Your map/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resources/ })).toBeTruthy();
  });

  it('opens the drawer it names, and says so', async () => {
    // t-9 shipped these `disabled` because the drawers were t-10's. They are
    // live now, and `aria-expanded` is what tells a screen reader that a panel
    // appeared somewhere else on the page.
    renderInShell(<ShellRail />);
    const map = screen.getByRole('button', { name: /Your map/ });
    expect(map.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(map);
    expect(map.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the drawer when its own button is pressed again', async () => {
    renderInShell(<ShellRail />);
    const map = screen.getByRole('button', { name: /Your map/ });

    await userEvent.click(map);
    await userEvent.click(map);
    expect(map.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens one at a time, so the second replaces the first', async () => {
    renderInShell(<ShellRail />);
    const map = screen.getByRole('button', { name: /Your map/ });
    const resources = screen.getByRole('button', { name: /Resources/ });

    await userEvent.click(map);
    await userEvent.click(resources);
    expect(map.getAttribute('aria-expanded')).toBe('false');
    expect(resources.getAttribute('aria-expanded')).toBe('true');
  });

  it('becomes a footer on a phone, within reach of a thumb', () => {
    renderInShell(<ShellRail />, 'small');
    const rail = screen.getByRole('navigation', { name: 'Panels' });

    expect(rail.className).toContain('order-last');
    expect(rail.className).toContain('w-full');
    // Safe-area padding, or the last row sits under a phone's home indicator.
    expect(rail.className).toContain('env(safe-area-inset-bottom)');
  });
});
