// @vitest-environment happy-dom

/**
 * The shell layout's two wiring facts — both invisible until the day they matter.
 *
 * 1. **Maintenance mode reaches `/app`.** `(protected)` and `(public)` both wrap
 *    their children in a maintenance wrapper. A new route group that skipped it
 *    would take the ENTIRE product out of maintenance mode, and nothing would
 *    say so: the app serves normally, which is exactly what it does when
 *    maintenance is off. The report arrives the first time someone switches
 *    maintenance on to take the product down and finds it still up.
 *    Owner ruling, 10 September 2026.
 *
 * 2. **The account footer is server-rendered with the real person.** The nav is
 *    handed the session rather than fetching one, so a layout that passed the
 *    wrong field would render an empty avatar for every user at once.
 *
 * Both are properties of the composition, not of any component, so neither is
 * covered by `maintenance-wrapper.test.tsx` or `shell-nav.test.tsx`.
 *
 * @see app/(lelanea)/app/layout.tsx
 */

import { render, screen } from '@testing-library/react';
import { cloneElement, isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.hoisted(() => ({ enabled: false }));
/** `name` is nullable and `current` is too — both are cases these tests drive. */
const session = vi.hoisted(() => ({
  current: null as {
    user: { id: string; name: string | null; email: string; role: string };
  } | null,
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    featureFlag: {
      findUnique: vi.fn(async () => (flag.enabled ? { enabled: true, metadata: null } : null)),
    },
  },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('@/lib/auth/config', () => ({
  auth: { api: { getSession: vi.fn(async () => session.current) } },
}));
vi.mock('@/lib/auth/utils', () => ({ getServerSession: vi.fn(async () => session.current) }));
vi.mock('@/lib/auth/clear-session', () => ({
  clearInvalidSession: vi.fn(() => {
    throw new Error('redirected');
  }),
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));

import { ThemeProvider } from '@/hooks/use-theme';

import ShellLayout from '@/app/(lelanea)/app/layout';

/**
 * Resolve async server components down the tree before handing it to React.
 *
 * `render()` cannot render an async component, and — this is the trap — it
 * fails by producing an EMPTY container rather than by throwing. So a test that
 * asserts something is *absent* passes for free against that empty tree. The
 * first draft of the maintenance case below did exactly that: it went green
 * while proving nothing, because "the panes are gone" is true of a page that
 * never rendered.
 *
 * The layout returns `<MaintenanceWrapperWithAdminNotice>`, itself async, so
 * one `await` at the top is not enough — the wrapper is precisely the level
 * these tests are about. Hence the walk.
 */
async function resolveAsync(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync));
  if (!isValidElement(node)) return node;

  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  const props = element.props;

  // ONLY async components are unwrapped here. A synchronous one is left for
  // React to render: calling it directly would run its hooks outside a render
  // pass, and `ShellNav` — a client island with `useLocalStorage` — throws
  // "Invalid hook call" the moment it is invoked as a plain function.
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    const rendered = await (element.type as (p: unknown) => Promise<React.ReactNode>)(props);
    return resolveAsync(rendered);
  }

  if (props?.children === undefined) return element;
  return cloneElement(element, undefined, await resolveAsync(props.children));
}

async function renderLayout() {
  const tree = await resolveAsync(await ShellLayout({ children: <p>the panes</p> }));
  // `ShellTopbar` reads `useTheme`, which throws outside its provider — the
  // same provider the real root layout supplies above this route group.
  const result = render(<ThemeProvider>{tree as React.ReactElement}</ThemeProvider>);
  // The guard that makes every `queryBy…(...).toBeNull()` below mean something.
  expect(document.body.textContent?.trim()).not.toBe('');
  return result;
}

beforeEach(() => {
  flag.enabled = false;
  session.current = {
    user: { id: 'u1', name: 'Maya Reyes', email: 'maya@example.com', role: 'USER' },
  };
  window.localStorage.clear();
  window.sessionStorage.setItem('lelanea.bloom.seen', '1');
});

describe('the shell layout serves the product', () => {
  it('renders the frame and its children when maintenance is off', async () => {
    await renderLayout();
    expect(screen.getByText('the panes')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Panels' })).toBeTruthy();
  });

  it('hands the nav the session’s real person', async () => {
    await renderLayout();
    expect(screen.getByText('Maya Reyes')).toBeTruthy();
    expect(screen.getByText('MR')).toBeTruthy();
  });

  it('falls back to the email when the account has no name', async () => {
    session.current = { user: { id: 'u1', name: null, email: 'zoe@example.com', role: 'USER' } };
    await renderLayout();
    expect(screen.getAllByText('zoe@example.com').length).toBeGreaterThan(0);
  });
});

describe('maintenance mode reaches the shell', () => {
  it('replaces the product with the maintenance page for a signed-in user', async () => {
    flag.enabled = true;
    await renderLayout();

    // The assertion that fails if the wrapper is ever dropped from the layout.
    expect(screen.queryByText('the panes')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('still lets an admin through, as on every other layout', async () => {
    flag.enabled = true;
    session.current = {
      user: { id: 'a1', name: 'Ada Admin', email: 'ada@example.com', role: 'ADMIN' },
    };
    await renderLayout();
    expect(screen.getByText('the panes')).toBeTruthy();
  });
});
