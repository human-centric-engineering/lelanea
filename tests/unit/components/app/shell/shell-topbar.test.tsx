// @vitest-environment happy-dom

/**
 * The top bar — recents, the spend meter, the two ≤900px controls, and what
 * must NOT be on it.
 *
 * The budget meter was an absence guarded here until f-budget t-95: nothing
 * metered spend, so `$12.40 left` would have been invented, and a digit on this
 * bar was the tell. It is now real, and the tell narrows to **a digit the bar
 * did not read** — asserted against a read that has not answered, which is the
 * one state where any figure would be a fake. The meter's own states are in
 * `spend-meter.test.tsx`. The theme toggle moved into the account menu on 15
 * September 2026, so a button appearing above 900px is still the regression.
 *
 * @see components/app/shell/shell-topbar.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTopbar } from '@/components/app/shell/shell-topbar';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

/** The meter's read, held unanswered: nothing it shows can have come from it. */
const pendingFetch = vi.fn(() => new Promise<Response>(() => {}));

beforeEach(() => {
  mockPathname.current = '/app';
  vi.stubGlobal('fetch', pendingFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  pendingFetch.mockClear();
});

/** `large` unless stated: the burger and pane switch are ≤900px controls. */
function renderBar(width: WidthName = 'large') {
  return renderInShell(<ShellTopbar />, width);
}

describe('ShellTopbar — what it must not invent', () => {
  it('shows no number it has not read', () => {
    // `$12.40 left` in the prototype's bar is the specific fake this guards
    // against. The meter's read is held unanswered here, so any figure on the
    // bar would be one nothing supplied.
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

  it('carries the spend meter above 900px, and it opens the usage page', () => {
    // It was on the list of absences until t-95, for want of metered spend.
    renderBar('large');
    const meter = screen.getByRole('link', { name: /^Usage and billing/ });
    expect(meter.getAttribute('href')).toBe('/app/usage');
    expect(pendingFetch).toHaveBeenCalledTimes(1);
  });

  it('leaves the meter off a phone, where it is one tap away in the account menu', () => {
    // The prototype's own call: "a desk-side reassurance, not a phone one".
    renderBar('small');
    expect(screen.queryByRole('link', { name: /^Usage and billing/ })).toBeNull();
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

  it('offers no button above 900px — not even the theme toggle', () => {
    // t-9 wrote "exactly one control" for the toggle; t-10 kept the burger and
    // pane switch off this width because the nav is a column with nothing to
    // open and both panes are on screen. Now the toggle has gone to the
    // account menu too. The spend meter is here, and is a LINK — it goes
    // somewhere. A button here is either a dead control or the toggle coming
    // back to fill the space.
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
