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

import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawers } from '@/components/app/shell/drawer';
import { ShellNav } from '@/components/app/shell/shell-nav';
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
/** The scrim: the one fixed, inset overlay that is not a drawer panel. */
const scrimEl = () =>
  Array.from(document.querySelectorAll('div.fixed.inset-0')).find(
    (el) => !el.hasAttribute('data-drawer')
  )!;

beforeEach(() => {
  window.localStorage.clear();
});

describe('opening and closing', () => {
  it('keeps the closed panel out of the tab order, not merely off-screen', async () => {
    // A panel parked off-canvas that is still focusable means tabbing walks into
    // a panel nobody can see.
    renderDrawers();
    expect(panel('map')?.hasAttribute('inert')).toBe(true);

    await userEvent.click(mapButton());
    expect(panel('map')?.hasAttribute('inert')).toBe(false);
  });

  it('does it WITHOUT display:none, which would kill the slide', () => {
    // `hidden` was the first answer and it defeated the whole mechanism: display
    // and transform change in the same commit, so there is no starting style to
    // transition from and the panel pops. This component translates off-canvas
    // precisely to avoid that, so `hidden` undid the thing it was built for.
    // `visibility` transitions; `display` does not.
    renderDrawers();
    const closed = panel('map')!;

    expect(closed.hasAttribute('hidden')).toBe(false);
    expect(closed.className).toContain('invisible');
    expect(closed.className).toContain('transition-[transform,visibility]');
  });

  it('closes on its own ✕', async () => {
    renderDrawers();
    await userEvent.click(mapButton());
    await userEvent.click(screen.getByRole('button', { name: 'Close your map' }));

    expect(panel('map')?.hasAttribute('inert')).toBe(true);
  });

  it('closes on the scrim', async () => {
    renderDrawers();
    await userEvent.click(mapButton());

    const scrim = scrimEl();
    await userEvent.click(scrim);
    expect(panel('map')?.hasAttribute('inert')).toBe(true);
  });

  it('puts the scrim above the nav and the rail, not beneath them', async () => {
    // Both are `z-50`. A dialog claiming `aria-modal` while the column beside it
    // stays undimmed and clickable is telling the reader something untrue.
    renderDrawers();
    await userEvent.click(mapButton());
    expect(scrimEl().className).toContain('z-[70]');
  });

  it('leaves the scrim inert when nothing is open, so it cannot eat a click', async () => {
    renderDrawers();
    expect(scrimEl().className).toContain('pointer-events-none');
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
  it('says what each is for rather than showing an empty list', () => {
    // An empty panel reads as broken; a panel that says what it is for reads as
    // unfinished, which is what it is (D6, B31). The map is real from §05 t-14
    // (`map-drawer.test.tsx`); its head still says what it holds. The resources
    // are the designed placeholder now rather than a grey paragraph — but still
    // a placeholder, with no invented films behind it.
    renderDrawers();
    expect(screen.getByText(/Sixteen modules/)).toBeTruthy();
    expect(screen.getByText(/Films and reading/)).toBeTruthy();
    expect(screen.getByText(/arrive with the programme/)).toBeTruthy();
  });

  it("builds the resources panel's sections without inventing anything to put in them", () => {
    // The chrome and the placeholder are this task's; the films are
    // f-resources', in phase 3. So the section exists and is honestly empty,
    // rather than carrying two plausible films with a stock thumbnail on them.
    renderDrawers();
    const watch = screen.getByRole('heading', { name: 'to watch' });
    expect(watch).toBeTruthy();
    expect(screen.getByText(/Nothing to watch yet/)).toBeTruthy();
    // A duration pill is the tell that something got invented.
    expect(screen.queryByText(/\d+ ?min/i)).toBeNull();
  });

  it('invents no counts', () => {
    const { container } = renderDrawers();
    const panels = Array.from(container.querySelectorAll('[role="dialog"]'));
    for (const p of panels) expect(p.textContent ?? '').not.toMatch(/\d/);
  });
});

describe('the panel is the designed panel', () => {
  const panels = () => Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'));

  it('sets the width once, so both drawers are the same panel', () => {
    // 432px is the design's `.rdrawer`, read rather than guessed — ours was
    // `min(420px, 88vw)`, which is 12px narrow everywhere AND left a 12% strip
    // of scrim down the side of a phone, reading as a panel that failed to
    // finish opening. The `100%` half is what keeps it sane at the bottom of
    // the range; the fixed half is the point above it, because a drawer rides
    // OVER the panes rather than taking width from them.
    renderDrawers();
    const widths = new Set(panels().map((p) => (p.className.match(/w-\[[^\]]+\]/) ?? [])[0]));
    expect(widths).toEqual(new Set(['w-[min(432px,100%)]']));
  });

  it('puts the head on the pale wash and the body on the page ground', () => {
    // Not cosmetic: the map's tier labels are read on the BODY ground, and
    // their contrast is measured against it. On the card they lose about a
    // fifth of a point, which is the margin two of the five have.
    renderDrawers();
    for (const panel of panels()) {
      expect(panel.className).toContain('bg-[var(--color-background)]');
      const head = panel.querySelector('header');
      expect(head?.className).toContain('bg-[var(--color-card)]');
      expect(head?.className).toContain('border-b');
    }
  });

  it('gives each head an eyebrow, a serif title and a line of body copy', () => {
    renderDrawers();
    for (const panel of panels()) {
      const head = panel.querySelector('header');
      expect(head?.querySelector('.brand-eyebrow')).not.toBeNull();
      expect(head?.querySelector('h2')?.className).toContain('brand-display');
      expect(head?.querySelectorAll('p')).toHaveLength(2); // eyebrow + lede
    }
  });

  it('closes with an outlined button, not a bare glyph', () => {
    // `.icon-btn.bordered` — the border is what makes it read as a control
    // rather than as a decoration in the corner. Rounded square rather than the
    // design's disc, which is t-42: one circle among rounded squares reads as
    // the odd one out rather than as the pattern.
    renderDrawers();
    for (const panel of panels()) {
      const close = within(panel).getByRole('button', { name: /^Close / });
      expect(close.className).toContain('border');
      expect(close.className).toContain('rounded-[10px]');
      expect(close.className).not.toContain('rounded-full');
    }
  });
});

describe('an open drawer does not leak presses into the shell behind it', () => {
  /** The rail, the drawers AND the nav — the click-away lives on the nav. */
  const renderWithNav = () =>
    renderInShell(
      <>
        <ShellNav user={{ name: 'Maya Reyes', email: 'maya@example.com' }} />
        <ShellRail />
        <Drawers />
      </>
    );
  const navSlim = () => document.querySelector('nav[aria-label="Main"]')?.getAttribute('data-slim');

  it('leaves the left menu alone when its scrim is dismissed', async () => {
    // The scrim is a bare `<div>` and a panel's own dead space is not a control
    // either, so the nav's click-away saw neither as interactive and neither as
    // inside the nav — dismissing the map by clicking its scrim closed the
    // drawer AND silently collapsed the menu behind it. A press inside an
    // `aria-modal` dialog must not reach the shell it is covering.
    renderWithNav();
    expect(navSlim()).toBe('false');

    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));
    await act(async () => {
      scrimEl().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });

    expect(navSlim()).toBe('false');
  });

  it('leaves it alone for a press on the open panel itself', async () => {
    renderWithNav();
    await userEvent.click(screen.getByRole('button', { name: /Resources/ }));

    await act(async () => {
      panel('resources')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(navSlim()).toBe('false');
  });
});

describe('focus stays inside an open drawer', () => {
  it('cycles Tab back to the first control rather than out to the page', async () => {
    // `aria-modal="true"` is a promise that the rest of the page is unavailable.
    // Moving focus in once does not keep it there: the panel is the LAST
    // focusable subtree in the document, so a single Tab left it and landed in
    // the nav or rail underneath the scrim — controls a sighted reader cannot
    // see and a screen-reader reader has been told do not exist.
    renderDrawers();
    await userEvent.click(mapButton());

    const close = screen.getByRole('button', { name: 'Close your map' });
    close.focus();
    await userEvent.tab();

    expect(panel('map')?.contains(document.activeElement)).toBe(true);
  });

  it('cycles Shift+Tab backwards inside the panel too', async () => {
    renderDrawers();
    await userEvent.click(mapButton());

    screen.getByRole('button', { name: 'Close your map' }).focus();
    await userEvent.tab({ shift: true });

    expect(panel('map')?.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the control that opened the FIRST drawer, after switching', async () => {
    // Switching map → resources used to overwrite the return target with the
    // outgoing panel — which is `inert` by the time the second one closes — so
    // focus silently fell to `<body>`.
    renderDrawers();
    const trigger = mapButton();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: /Resources/ }));
    await userEvent.keyboard('{Escape}');

    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(document.body);
  });
});
