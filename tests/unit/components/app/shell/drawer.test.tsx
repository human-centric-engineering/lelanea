// @vitest-environment happy-dom

/**
 * The drawers: the mechanism.
 *
 * Both panels are filled now — the map from §05 (`map-drawer.test.tsx`), the
 * resources from §14 (`resources-drawer.test.tsx`) — so what this file tests is
 * what they share rather than what is in them: the slide, the scrim, the focus
 * handling and the Escape rung. Nothing here mocks the API client, so both
 * bodies sit in their loading or failed state; the chrome is what is measured.
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

// One case renders `ShellNav`, which mounts the account menu at its foot;
// neither the theme nor analytics is what this file measures.
vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light', setTheme: vi.fn() }),
}));
vi.mock('@/lib/analytics', () => ({
  useAnalytics: () => ({ track: vi.fn(), reset: vi.fn() }),
  EVENTS: { USER_LOGGED_OUT: 'user_logged_out' },
}));

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
/** The scrim: the one absolute, inset overlay that is not a drawer panel. */
const scrimEl = () =>
  Array.from(document.querySelectorAll('div.absolute.inset-0')).find(
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

  it('dims the panes and nothing else', async () => {
    // It used to be `fixed inset-0 z-[70]`, over the whole shell, on the
    // argument that a dialog claiming `aria-modal` beside an undimmed column is
    // telling the reader something untrue. That argument was right and the fix
    // was the wrong way round: the design's panel is NOT modal — it is
    // `absolute` inside `.panes`, so the topbar stays readable and the rail
    // button that opened it stays lit, which is what its own capture shows.
    // The panel dropped the claim instead; see `drawer.tsx`.
    renderDrawers();
    await userEvent.click(mapButton());

    expect(scrimEl().className).toContain('absolute');
    expect(scrimEl().className).not.toContain('fixed');
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

describe('what the heads say', () => {
  it('says what each panel is for before anything has loaded', () => {
    // A panel's head is true whether or not its body has arrived: the map's
    // lede is constant, and the resources' is the general line until the
    // selection names a module (`resources-drawer.test.tsx` covers that).
    renderDrawers();
    expect(screen.getByText(/Sixteen modules/)).toBeTruthy();
    expect(screen.getByText(/Films and reading, in her own words/)).toBeTruthy();
  });

  it('invents no counts while nothing has loaded', () => {
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

  it('carries its own colour on the top rule and the eyebrow', () => {
    // A drawer's tone is its OWN, not the view's: the design sets it per panel
    // (`#dr-map` is always the secondary ink) because a panel riding over the
    // work is not part of the work. Ours had a grey head and a muted eyebrow.
    renderDrawers();
    for (const p of panels()) {
      const head = p.querySelector('header');
      expect(head?.className).toContain('border-t-[3px]');
      expect(head?.getAttribute('style')).toContain('var(--color-secondary-ink)');

      const eyebrow = head?.querySelector('.brand-eyebrow');
      expect(eyebrow?.getAttribute('style')).toContain('var(--color-secondary-ink)');
    }
  });

  it('tints with a token measured for TYPE, not with a raw arc hue', () => {
    // The seam that matters when resources starts following the open module.
    // `--color-secondary-ink` is 4.91:1 light and 6.96:1 dark; a raw tier hue
    // like `--color-status-yellow` is 2.03:1 and would fail at this size. A 3px
    // rule is a surface and an eyebrow is 12px type — same rule as `TIER_INKS`.
    renderDrawers();
    for (const p of panels()) {
      const eyebrow = p.querySelector('header .brand-eyebrow');
      expect(eyebrow?.getAttribute('style')).toMatch(/var\(--color-[a-z-]*ink\)/);
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
      expect(close.className).toContain('rounded-[5px]');
      expect(close.className).not.toContain('rounded-full');
    }
  });
});

describe('an open drawer does not leak presses into the shell behind it', () => {
  /** The rail, the drawers AND the nav — the click-away lives on the nav. */
  const renderWithNav = () =>
    renderInShell(
      <>
        <ShellNav
          user={{ name: 'Maya Reyes', email: 'maya@example.com', image: null, role: null }}
        />
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

describe('the panel is complementary, not modal', () => {
  it('lets Tab leave for the rail beside it', async () => {
    // The inverse of what this file used to assert, and the inversion is the
    // point. A trap was correct while the scrim covered the shell; now the rail
    // is visible, undimmed and live — pressing `Map` again is how you close the
    // panel — so holding Tab inside would be a sighted reader watching the rail
    // refuse the keyboard. `role="dialog"` with a label stays; `aria-modal`
    // does not.
    renderDrawers();
    await userEvent.click(mapButton());

    // Shift+Tab from the panel's FIRST control, not Tab from it. The panel is
    // last in the DOM and its body is a list of module links, so a forward Tab
    // from the close button simply walks further into the panel and would pass
    // with the trap still in place. Backwards from the first control is the
    // move the trap used to intercept.
    screen.getByRole('button', { name: 'Close your map' }).focus();
    await userEvent.tab({ shift: true });

    expect(panel('map')?.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Resources/ }));
  });

  it('claims no modality it cannot keep', async () => {
    renderDrawers();
    await userEvent.click(mapButton());

    for (const p of document.querySelectorAll('[role="dialog"]')) {
      expect(p.getAttribute('aria-modal')).toBeNull();
      // Still a named dialog, which is what gets it announced as a panel.
      expect(p.getAttribute('aria-label')).toBeTruthy();
    }
  });
});
