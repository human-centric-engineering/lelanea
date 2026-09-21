// @vitest-environment happy-dom

/**
 * A module's page: eyebrow, title, the tier's intent, the honest placeholder,
 * and the two actions — one live, one disabled with its reason.
 *
 * Rendered inside the shell provider because "In Lelañea's own words" opens
 * the resources drawer, and that is the one thing on the page that DOES
 * something.
 */

import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Drawers } from '@/components/app/shell/drawer';
import { ModuleView, UNWRITTEN_PARTS } from '@/components/app/views/module-view';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/app/modules/values' }));
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: vi.fn(() => new Promise(() => {})) },
  APIClientError: class extends Error {},
}));

const VALUES = {
  displayNumber: '01',
  title: 'Values',
  tierLabel: 'Foundations',
  tierIntent:
    'Establish the inner compass, the lines that protect it, the bar it is held to, and who is holding it.',
  parts: [
    {
      id: 'orientation',
      label: 'Orientation',
      summary: 'Orientation: phases 1–4. Not written yet.',
    },
    {
      id: 'discernment',
      label: 'Discernment',
      summary: 'Discernment: phases 5–8. Not written yet.',
    },
    {
      id: 'integration',
      label: 'Integration',
      summary: 'Integration: phases 9–12. Not written yet.',
    },
  ],
};

describe('ModuleView', () => {
  it('names the place: tier · module NN above a serif title, inside a main with one h1', () => {
    renderInShell(<ModuleView {...VALUES} />);

    const main = screen.getByRole('main');
    expect(within(main).getByText('foundations · module 01')).toBeInTheDocument();
    expect(within(main).getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('Values');
  });

  it('carries the tier’s intent as the one thing that is written', () => {
    renderInShell(<ModuleView {...VALUES} />);
    expect(screen.getByText('What this module is for')).toBeInTheDocument();
    expect(screen.getByText(/Establish the inner compass/)).toBeInTheDocument();
  });

  it('shows Values’ three authored parts, each honest about being unwritten', () => {
    renderInShell(<ModuleView {...VALUES} />);
    const parts = within(screen.getByRole('list', { name: 'Parts of this module' })).getAllByRole(
      'listitem'
    );
    expect(parts.map((p) => p.textContent?.trim())).toEqual([
      'Orientation',
      'Discernment',
      'Integration',
    ]);
    expect(parts[0]).toHaveAttribute('title', expect.stringMatching(/Not written yet/));
    // Not tabs: nothing is behind them, so they claim no interaction.
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('gives every other module the unnamed pair, and invents no step or progress', () => {
    renderInShell(<ModuleView {...VALUES} title="Boundaries" parts={UNWRITTEN_PARTS} />);
    const parts = within(screen.getByRole('list', { name: 'Parts of this module' })).getAllByRole(
      'listitem'
    );
    expect(parts.map((p) => p.textContent?.trim())).toEqual(['Part 1', 'Part 2']);
    expect(screen.getByRole('main').textContent).not.toMatch(/step \d|complete|\d+ of \d+/i);
  });

  it('is honest about being a placeholder, in the prototype’s shape', () => {
    renderInShell(<ModuleView {...VALUES} />);
    expect(screen.getByText('module placeholder')).toBeInTheDocument();
    expect(screen.getByText(/This module is not written yet/)).toBeInTheDocument();
  });

  it('disables "Talk about this part" with the composer’s reason', () => {
    renderInShell(<ModuleView {...VALUES} />);
    const talk = screen.getByRole('button', { name: /Talk about this part/ });
    expect(talk).toBeDisabled();
    expect(talk).toHaveAccessibleName(/arrives with the conversation/);
  });

  it('opens the resources drawer from "In Lelañea’s own words"', async () => {
    renderInShell(
      <>
        <ModuleView {...VALUES} />
        <Drawers />
      </>
    );
    const resources = screen.getByRole('dialog', { name: 'Resources' });
    expect(resources).toHaveAttribute('inert');

    await userEvent.click(screen.getByRole('button', { name: /own words/ }));

    expect(resources).not.toHaveAttribute('inert');
    // The client is mocked to never answer, so the drawer is finding her words
    // on this module — what it says once they arrive is
    // `resources-drawer.test.tsx`'s.
    expect(within(resources).getByText(/Finding her words/)).toBeInTheDocument();
  });
});
