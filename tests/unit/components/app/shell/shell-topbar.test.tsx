// @vitest-environment happy-dom

/**
 * The top bar — the two ≤900px controls, and the four things that must NOT be
 * on it.
 *
 * The absences carry the weight here. Recents, the budget meter and the
 * prototype's own tag are all omitted because nothing feeds them (D6, `B31`),
 * and the cheapest way for a fake to arrive later is somebody porting the
 * prototype's bar wholesale and leaving `$12.40 left` in it. A digit on this bar
 * is the tell, so that is what is asserted. The fourth absence is the theme
 * toggle, which moved into the account menu on 15 September 2026 — so above
 * 900px the bar is empty, and a control appearing there to fill it is the
 * regression.
 *
 * @see components/app/shell/shell-topbar.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTopbar } from '@/components/app/shell/shell-topbar';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

beforeEach(() => {
  mockPathname.current = '/app';
});

/** `large` unless stated: the burger and pane switch are ≤900px controls. */
function renderBar(width: WidthName = 'large') {
  return renderInShell(<ShellTopbar />, width);
}

describe('ShellTopbar — what it must not invent', () => {
  it('shows no number anywhere', () => {
    // Nothing meters spend until phase 2. `$12.40 left` in the prototype's bar
    // is the specific fake this guards against.
    //
    // Deliberately the DEFAULT render, with no recents stored: a real pill says
    // `01 · Values`, and that digit is the module's authored number rather than
    // an invention. The distinction this case is about is an invented figure,
    // so it asserts against the bar a reader sees before they have been
    // anywhere — which is also the only state in which every digit would be a
    // fake.
    const { container } = renderBar();
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('carries no budget control', () => {
    // Recents is no longer on this list, and that is the change. It was here
    // because nothing opened a module until §05 and the strip would have been
    // permanently empty; §05 landed and `RememberModule` records real visits.
    // The budget stays: nothing meters spend until phase 2.
    renderBar();
    expect(screen.queryByRole('button', { name: /usage|billing|budget/i })).toBeNull();
  });

  it('shows the recents strip, and says plainly when it is empty', () => {
    // An EMPTY strip and an ABSENT one say different things. The first tells a
    // new reader the app is keeping their place; the second is
    // indistinguishable from a feature that does not exist.
    renderBar('large');
    const strip = screen.getByLabelText('Recently opened');

    expect(strip.textContent).toContain('recently');
    expect(strip.textContent).toContain('nothing opened yet');
    // And it invents no module to fill itself with.
    expect(strip.querySelectorAll('a')).toHaveLength(0);
  });

  it('shows a pill per module this browser actually opened, most recent first', () => {
    window.localStorage.setItem(
      'lelanea.workspace.recents',
      JSON.stringify([
        { slug: 'boundaries', label: '02 · Boundaries', tier: 'foundations' },
        { slug: 'values', label: '01 · Values', tier: 'foundations' },
      ])
    );
    renderBar('large');

    const pills = screen.getByLabelText('Recently opened').querySelectorAll('a');
    expect(Array.from(pills).map((a) => a.textContent)).toEqual(['02 · Boundaries', '01 · Values']);
    expect(pills[0].getAttribute('href')).toBe('/app/modules/boundaries');
  });

  it('offers nothing above 900px — not even the theme toggle', () => {
    // t-9 wrote "exactly one control" for the toggle; t-10 kept the burger and
    // pane switch off this width because the nav is a column with nothing to
    // open and both panes are on screen. Now the toggle has gone to the
    // account menu too, and the bar is deliberately empty until recents and
    // the budget meter have something real to show. A button here is either a
    // dead control or the toggle coming back to fill the space.
    renderBar('large');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
  });

  it('carries no theme toggle at any width', () => {
    renderBar('small');
    expect(screen.queryByRole('button', { name: /theme/i })).toBeNull();
    expect(screen.queryByText(/Switch to the/)).toBeNull();
  });

  it('offers the burger on a phone, and reports what it did', async () => {
    renderBar('small');
    const burger = screen.getByRole('button', { name: 'Open the menu' });
    expect(burger.getAttribute('aria-expanded')).toBe('false');

    await userEvent.click(burger);
    expect(
      screen.getByRole('button', { name: 'Close the menu' }).getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('shows the pane switch only when there are two panes to switch between', () => {
    // On `/app` the workspace is closed, so a switch would offer a destination
    // that is not there.
    renderBar('small');
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();

    mockPathname.current = '/app/journey';
    renderBar('small');
    expect(screen.getAllByRole('group', { name: 'Show' }).length).toBeGreaterThan(0);
  });

  it('moves the switch, and reports which pane is showing', async () => {
    mockPathname.current = '/app/journey';
    renderBar('small');

    const conversation = screen.getByRole('button', { name: 'Conversation' });
    const workspace = screen.getByRole('button', { name: 'Workspace' });
    // A module route opens ON the module — asking for one and being shown the
    // conversation instead was the defect this state now encodes.
    expect(workspace.getAttribute('aria-pressed')).toBe('true');

    await userEvent.click(conversation);
    expect(conversation.getAttribute('aria-pressed')).toBe('true');
    expect(workspace.getAttribute('aria-pressed')).toBe('false');
  });
});
