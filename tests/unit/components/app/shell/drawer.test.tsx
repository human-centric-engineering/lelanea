// @vitest-environment happy-dom

/**
 * The drawers: a mechanism now, contents later.
 *
 * Both panels are stubs (D6) — the map needs §05's modules, the resources need
 * phase 3 — so what is worth testing is the machinery §05 and f-resources will
 * inherit rather than build: the slide, the scrim, the focus handling and the
 * Escape rung.
 *
 * Focus is the half that has no visual tell at all. Closing a drawer that drops
 * focus on `<body>` puts a keyboard reader back at the top of the document, and
 * nothing on screen says it happened.
 *
 * @see components/app/shell/drawer.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawers } from '@/components/app/shell/drawer';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/journey' }));

function renderDrawers() {
  return renderInShell(
    <>
      <ShellRail />
      <Drawers />
    </>
  );
}

const mapButton = () => screen.getByRole('button', { name: /Your map/ });
/*
 * Queried by `data-drawer`, not by role: the closed panel carries the `hidden`
 * ATTRIBUTE, which removes it from the accessibility tree altogether — so a role
 * query cannot see the very state half these cases are about, even with
 * `hidden: true`.
 */
const panel = (id: 'map' | 'resources') => document.querySelector(`[data-drawer="${id}"]`);

beforeEach(() => {
  window.localStorage.clear();
});

describe('opening and closing', () => {
  it('keeps the closed panel out of the tab order, not merely off-screen', async () => {
    // `hidden` and not just a transform: a panel parked off-canvas that is still
    // focusable means tabbing walks into a panel nobody can see.
    renderDrawers();
    expect(panel('map')?.hasAttribute('hidden')).toBe(true);

    await userEvent.click(mapButton());
    expect(panel('map')?.hasAttribute('hidden')).toBe(false);
  });

  it('closes on its own ✕', async () => {
    renderDrawers();
    await userEvent.click(mapButton());
    await userEvent.click(screen.getByRole('button', { name: 'Close your map' }));

    expect(panel('map')?.hasAttribute('hidden')).toBe(true);
  });

  it('closes on the scrim', async () => {
    renderDrawers();
    await userEvent.click(mapButton());

    const scrim = document.querySelector('.fixed.inset-0.z-40')!;
    await userEvent.click(scrim);
    expect(panel('map')?.hasAttribute('hidden')).toBe(true);
  });

  it('leaves the scrim inert when nothing is open, so it cannot eat a click', async () => {
    renderDrawers();
    const scrim = document.querySelector('.fixed.inset-0.z-40')!;
    expect(scrim.className).toContain('pointer-events-none');
  });
});

describe('focus', () => {
  it('moves into the panel when it opens', async () => {
    renderDrawers();
    await userEvent.click(mapButton());

    expect(document.activeElement).toBe(panel('map'));
  });

  it('comes back to the control that opened it', async () => {
    // Without this, Escape leaves a keyboard reader at the top of the document
    // with no indication anything moved.
    renderDrawers();
    const trigger = mapButton();
    await userEvent.click(trigger);
    await userEvent.keyboard('{Escape}');

    expect(document.activeElement).toBe(trigger);
  });
});

describe('what the stubs say', () => {
  it('says what each will hold rather than showing an empty list', () => {
    // An empty panel reads as broken; a panel that says what it is for reads as
    // unfinished, which is what it is (D6, B31).
    renderDrawers();
    expect(screen.getByText(/sixteen modules/)).toBeTruthy();
    expect(screen.getByText(/Films and reading/)).toBeTruthy();
  });

  it('invents no counts', () => {
    const { container } = renderDrawers();
    const panels = Array.from(container.querySelectorAll('[role="dialog"]'));
    for (const p of panels) expect(p.textContent ?? '').not.toMatch(/\d/);
  });
});
