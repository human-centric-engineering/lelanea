// @vitest-environment happy-dom

/**
 * The top bar — the theme toggle, which is the one thing on it that does
 * something, and the three things that must NOT be on it yet.
 *
 * The absences carry the weight here. Recents, the budget meter and the
 * prototype's own tag are all omitted because nothing feeds them (D6, `B31`),
 * and the cheapest way for a fake to arrive later is somebody porting the
 * prototype's bar wholesale and leaving `$12.40 left` in it. A digit on this bar
 * is the tell, so that is what is asserted.
 *
 * @see components/app/shell/shell-topbar.tsx
 */

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTopbar } from '@/components/app/shell/shell-topbar';

import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const theme = vi.hoisted(() => ({ current: 'light', setTheme: vi.fn() }));

const mockPathname = vi.hoisted(() => ({ current: '/app' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: theme.current, setTheme: theme.setTheme }),
}));

beforeEach(() => {
  theme.current = 'light';
  theme.setTheme.mockClear();
  mockPathname.current = '/app';
});

/** `large` unless stated: the burger and pane switch are ≤900px controls. */
function renderBar(width: WidthName = 'large') {
  return renderInShell(<ShellTopbar />, width);
}

describe('ShellTopbar — the theme toggle', () => {
  it('renders identical markup whichever theme is current', () => {
    // THE HYDRATION TEST, and the reason both faces sit in the DOM at once.
    //
    // `ThemeProvider` resolves to `'light'` on the server and to the real value
    // on the client's first render. Any branch on `theme` in the returned
    // markup therefore makes server and client disagree for every reader in
    // dark mode, and React tears the tree down and re-renders it. Asserting the
    // two renders are byte-identical is that same claim, stated so it fails the
    // moment somebody reintroduces a ternary.
    theme.current = 'light';
    const light = renderBar();
    const lightHtml = light.container.innerHTML;
    light.unmount();

    theme.current = 'dark';
    const dark = renderBar();
    expect(dark.container.innerHTML).toBe(lightHtml);
  });

  it('carries both faces and both names, for CSS to choose between', () => {
    // The corollary of the case above: if the markup cannot branch, the theme
    // has to be readable from it some other way. `dark:` keys on `.dark` on
    // `<html>`, which the root layout's no-flash script sets before first paint.
    const { container } = renderBar();

    expect(container.querySelector('.dark\\:hidden')).not.toBeNull();
    expect(container.querySelector('.hidden.dark\\:block')).not.toBeNull();
    expect(container.textContent).toContain('Switch to the dark theme');
    expect(container.textContent).toContain('Switch to the light theme');
  });

  it('switches away from light', async () => {
    theme.current = 'light';
    renderBar();
    await userEvent.click(screen.getByRole('button'));
    expect(theme.setTheme).toHaveBeenCalledWith('dark');
  });

  it('switches away from dark', async () => {
    // `theme` is read in the HANDLER, which runs after hydration — the one
    // place it is safe. This proves the handler still reads it.
    theme.current = 'dark';
    renderBar();
    await userEvent.click(screen.getByRole('button'));
    expect(theme.setTheme).toHaveBeenCalledWith('light');
  });
});

describe('ShellTopbar — what it must not invent', () => {
  it('shows no number anywhere', () => {
    // Nothing meters spend until phase 2. `$12.40 left` in the prototype's bar
    // is the specific fake this guards against.
    const { container } = renderBar();
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('carries no recents strip and no budget control', () => {
    renderBar();
    expect(screen.queryByLabelText(/recently/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /usage|billing|budget/i })).toBeNull();
  });

  it('offers only the theme toggle above 900px', () => {
    // Updated deliberately from t-9's "exactly one control", which was written
    // to fail the moment these arrived. Above 900px the nav is a column with
    // nothing to open and both panes are on screen with nothing to switch
    // between, so a burger or a pane switch here would be the dead control t-9
    // refused to ship.
    renderBar('large');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /menu/i })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
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
