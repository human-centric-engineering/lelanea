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

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellTopbar } from '@/components/app/shell/shell-topbar';

const theme = vi.hoisted(() => ({ current: 'light', setTheme: vi.fn() }));

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: theme.current, setTheme: theme.setTheme }),
}));

beforeEach(() => {
  theme.current = 'light';
  theme.setTheme.mockClear();
});

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
    const light = render(<ShellTopbar />);
    const lightHtml = light.container.innerHTML;
    light.unmount();

    theme.current = 'dark';
    const dark = render(<ShellTopbar />);
    expect(dark.container.innerHTML).toBe(lightHtml);
  });

  it('carries both faces and both names, for CSS to choose between', () => {
    // The corollary of the case above: if the markup cannot branch, the theme
    // has to be readable from it some other way. `dark:` keys on `.dark` on
    // `<html>`, which the root layout's no-flash script sets before first paint.
    const { container } = render(<ShellTopbar />);

    expect(container.querySelector('.dark\\:hidden')).not.toBeNull();
    expect(container.querySelector('.hidden.dark\\:block')).not.toBeNull();
    expect(container.textContent).toContain('Switch to the dark theme');
    expect(container.textContent).toContain('Switch to the light theme');
  });

  it('switches away from light', async () => {
    theme.current = 'light';
    render(<ShellTopbar />);
    await userEvent.click(screen.getByRole('button'));
    expect(theme.setTheme).toHaveBeenCalledWith('dark');
  });

  it('switches away from dark', async () => {
    // `theme` is read in the HANDLER, which runs after hydration — the one
    // place it is safe. This proves the handler still reads it.
    theme.current = 'dark';
    render(<ShellTopbar />);
    await userEvent.click(screen.getByRole('button'));
    expect(theme.setTheme).toHaveBeenCalledWith('light');
  });
});

describe('ShellTopbar — what it must not invent', () => {
  it('shows no number anywhere', () => {
    // Nothing meters spend until phase 2. `$12.40 left` in the prototype's bar
    // is the specific fake this guards against.
    const { container } = render(<ShellTopbar />);
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });

  it('carries no recents strip and no budget control', () => {
    render(<ShellTopbar />);
    expect(screen.queryByLabelText(/recently/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /usage|billing|budget/i })).toBeNull();
  });

  it('has exactly one control, so a dead burger cannot creep in unnoticed', () => {
    // The burger and pane switch belong to t-10, with the state they drive.
    // When t-10 adds them this fails, which is the moment to update the count
    // deliberately rather than by accident.
    render(<ShellTopbar />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
