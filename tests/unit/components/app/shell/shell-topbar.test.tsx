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
  it('offers dark when the reader is in light', async () => {
    render(<ShellTopbar />);
    const toggle = screen.getByRole('button', { name: 'Switch to the dark theme' });

    await userEvent.click(toggle);
    expect(theme.setTheme).toHaveBeenCalledWith('dark');
  });

  it('offers light when the reader is in dark', async () => {
    theme.current = 'dark';
    render(<ShellTopbar />);
    const toggle = screen.getByRole('button', { name: 'Switch to the light theme' });

    await userEvent.click(toggle);
    expect(theme.setTheme).toHaveBeenCalledWith('light');
  });

  it('names the destination theme, not the current one', () => {
    // The classic off-by-one on a toggle label: a moon icon captioned "dark
    // theme" while you are already in dark. The label has to say where the
    // click takes you.
    theme.current = 'dark';
    render(<ShellTopbar />);
    expect(screen.queryByRole('button', { name: /dark/ })).toBeNull();
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
