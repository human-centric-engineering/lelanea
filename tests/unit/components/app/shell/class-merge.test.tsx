// @vitest-environment happy-dom

/**
 * The class a state depends on actually survives `twMerge`.
 *
 * `cn` is `twMerge(clsx(...))`, so a later class in the same Tailwind group
 * REPLACES an earlier one. Round 2 found three conditional blocks being deleted
 * that way, and the worst of them meant the tablet slide-over — a component
 * built entirely around riding a transform — had no transform transition at all.
 * It popped, through a build, a visual check and a code-review round, because
 * the defect is invisible in the source AND in a screenshot. Only the resolved
 * class list shows it.
 *
 * A static scan of `cn()` calls is too blunt to settle this: most pairs it flags
 * are ternary branches that can never both fire. So the check is per STATE, at
 * runtime, naming the class that state's behaviour depends on — and, where the
 * pairing is the whole point, the class that must NOT be there with it.
 *
 * Add a row here whenever a component gains a conditional class in a group it
 * already writes to.
 */

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { Drawers } from '@/components/app/shell/drawer';
import { ShellNav } from '@/components/app/shell/shell-nav';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { Workspace } from '@/components/app/shell/workspace';
import { renderInShell, type WidthName } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));

const USER = { name: 'Simon H', email: 'simon@example.com' };

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/journey';
});

interface Row {
  what: string;
  width: WidthName;
  route?: string;
  render: () => React.ReactElement;
  select: string;
  /** Must survive the merge — the state's behaviour depends on it. */
  keeps: string[];
  /** Must have been replaced — its presence would mean the wrong branch won. */
  drops?: string[];
}

const ROWS: Row[] = [
  {
    what: 'tablet panel keeps its transform transition',
    width: 'medium',
    render: () => <ConversationPane />,
    select: '[data-pane="chat"]',
    keeps: ['absolute', 'w-[420px]', 'transition-transform', 'duration-[340ms]'],
    drops: ['transition-[flex-basis]', 'duration-[280ms]'],
  },
  {
    what: 'desktop pane keeps its flex-basis transition',
    width: 'large',
    render: () => <ConversationPane />,
    select: '[data-pane="chat"]',
    keeps: ['flex-none', 'transition-[flex-basis]', 'duration-[280ms]'],
    drops: ['absolute', 'transition-transform'],
  },
  {
    what: 'carousel pane keeps its transform transition',
    width: 'small',
    render: () => <ConversationPane />,
    select: '[data-pane="chat"]',
    keeps: ['absolute', 'transition-transform', 'duration-[340ms]'],
    drops: ['transition-[flex-basis]'],
  },
  {
    what: 'phone nav drawer keeps its own width and slide',
    width: 'small',
    render: () => <ShellNav user={USER} />,
    select: 'nav[aria-label="Main"]',
    keeps: ['fixed', 'w-[min(320px,88vw)]', 'transition-[transform,visibility]'],
    drops: ['w-[234px]', 'w-16', 'transition-[width]'],
  },
  {
    what: 'desktop nav keeps the column width',
    width: 'large',
    render: () => <ShellNav user={USER} />,
    select: 'nav[aria-label="Main"]',
    keeps: ['w-[234px]'],
    drops: ['fixed', 'w-[min(320px,88vw)]'],
  },
  {
    what: 'phone rail keeps its footer geometry',
    width: 'small',
    render: () => <ShellRail />,
    select: 'nav[aria-label="Panels"]',
    keeps: ['w-full', 'flex-row', 'border-t'],
    drops: ['w-[70px]', 'flex-col', 'border-l'],
  },
  {
    what: 'desktop rail keeps the column geometry',
    width: 'large',
    render: () => <ShellRail />,
    select: 'nav[aria-label="Panels"]',
    keeps: ['w-[70px]', 'flex-col', 'border-l'],
    drops: ['w-full', 'border-t'],
  },
  {
    what: 'closed drawer keeps its off-canvas transform and its transition',
    width: 'large',
    render: () => <Drawers />,
    select: '[data-drawer="map"]',
    keeps: ['invisible', 'translate-x-full', 'transition-[transform,visibility]'],
    drops: ['translate-x-0'],
  },
  {
    what: 'tablet surface keeps the margin that clears the strip',
    width: 'medium',
    render: () => <Workspace>view</Workspace>,
    select: '[data-pane="ws"]',
    keeps: ['ml-14', 'border-t-[var(--tone,transparent)]'],
    drops: ['border-t-[var(--color-secondary-ink)]'],
  },
];

describe('conditional classes survive the merge', () => {
  it.each(ROWS)('$what', ({ width, route, render, select, keeps, drops }) => {
    if (route) mockPathname.current = route;
    renderInShell(render(), width);

    const el = document.querySelector(select);
    expect(el, `nothing matched ${select}`).not.toBeNull();
    const classes = new Set(el!.className.split(/\s+/).filter(Boolean));

    for (const cls of keeps) {
      expect(classes.has(cls), `${cls} was deleted by twMerge`).toBe(true);
    }
    for (const cls of drops ?? []) {
      expect(classes.has(cls), `${cls} survived and should not have`).toBe(false);
    }
  });

  it('the strip is not laid over the panel it belongs to', () => {
    // Not a merge case, but the same family: a class-level pairing where one
    // element's geometry only makes sense given another's state.
    renderInShell(<ConversationPane />, 'medium');
    expect(screen.getByRole('button', { name: 'Open the conversation' })).toBeTruthy();
  });
});
