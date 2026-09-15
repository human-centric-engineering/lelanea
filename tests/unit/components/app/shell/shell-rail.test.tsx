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

import { fireEvent, screen } from '@testing-library/react';
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

  it('is two full-width keys down there, not two shrunken rail cells', () => {
    // The complaint this answers: the footer arrived as two small icon-and-
    // caption cells huddled in the middle of a bare strip — hard to hit, and
    // not reading as the two main ways out of the conversation. `justify-center`
    // is the tell, and `flex-1` on each key is the fix.
    renderInShell(<ShellRail />, 'small');
    const rail = screen.getByRole('navigation', { name: 'Panels' });
    expect(rail.className).not.toContain('justify-center');

    for (const name of [/Your map/, /Resources/]) {
      const key = screen.getByRole('button', { name });
      expect(key.className).toContain('flex-1');
      expect(key.className).toContain('h-12'); // a thumb target, not a 34px cell
      expect(key.className).toContain('border');
      // Sentence case at body size, not the rail's 8.5px uppercase caption.
      expect(key.className).not.toContain('uppercase');
      expect(key.className).not.toContain('text-[8.5px]');
      // Icon BESIDE the label, so the key reads as `⌖ Map`.
      expect(key.className).not.toContain('flex-col');
    }
  });

  it('keeps the open key visibly selected in its wide form', () => {
    // The active state was carried by a wash that reads on a 62px cell and gets
    // lost across a half-width key, so it takes the border too.
    renderInShell(<ShellRail />, 'small');
    const map = screen.getByRole('button', { name: /Your map/ });
    expect(map.className).not.toContain('secondary-wash');

    fireEvent.click(map);
    expect(map.className).toContain('var(--color-secondary-wash)');
    expect(map.className).toContain('border-[var(--color-secondary-ink)]');
  });

  it('keeps the vertical rail a vertical rail above 900px', () => {
    renderInShell(<ShellRail />, 'large');
    const map = screen.getByRole('button', { name: /Your map/ });
    expect(map.className).toContain('flex-col');
    expect(map.className).toContain('uppercase');
    expect(map.className).toContain('w-[62px]');
  });

  it('carries the brand tooltip on the vertical rail, and never the browser one', () => {
    renderInShell(<ShellRail />, 'large');
    const map = screen.getByRole('button', { name: /Your map/ });
    expect(map.getAttribute('title')).toBeNull();

    const bubble = map.nextElementSibling;
    expect(bubble?.textContent).toBe('Your map — the sixteen modules');
    expect(bubble?.getAttribute('aria-hidden')).toBe('true');
  });

  it('drops the tooltip in the footer, where it could not be read anyway', () => {
    // Geometry, not belt-and-braces. The bubble points LEFT — the only
    // direction that works beside a right-hand rail — and is measured from its
    // trigger's left edge. Against a full-width key that puts the left one's
    // bubble off the screen entirely and the right one's on top of its
    // neighbour. Nothing is lost: each key already says `Map` in sentence case
    // at body size, which is the whole reason the vertical rail needs a bubble
    // and the footer does not.
    renderInShell(<ShellRail />, 'small');
    const map = screen.getByRole('button', { name: /Your map/ });

    expect(map.getAttribute('title')).toBeNull();
    // No bubble anywhere in the footer. Asserted by TEXT rather than by
    // `nextElementSibling`: with no bubble rendered, a key's next sibling is
    // simply the other key, so a sibling check would pass for the wrong reason.
    const rail = screen.getByRole('navigation', { name: 'Panels' });
    expect(
      Array.from(rail.querySelectorAll('span')).some(
        (el) => el.textContent === 'Your map — the sixteen modules'
      )
    ).toBe(false);
    // The name is still there for anyone reading with a screen reader.
    expect(map.getAttribute('aria-label')).toBe('Your map — the sixteen modules');
  });
});
