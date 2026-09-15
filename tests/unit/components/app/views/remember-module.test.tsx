// @vitest-environment happy-dom

/**
 * How a module page tells the shell what it is — both halves.
 *
 * **The slug, remembered**, which is the write half of "Workspace goes to the
 * last module visited"; the read half is `shell-nav.test.tsx`, and the two share
 * the key through `LAST_MODULE_STORAGE_KEY`.
 *
 * **The place, published**, which is what lets the conversation column's way
 * back say `on 01 · Values`. A module page renders inside the workspace, a
 * sibling of the conversation, so this is the only route that fact has upward —
 * and the one thing it must never do is report the module the reader has just
 * left.
 */

import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { RememberModule } from '@/components/app/views/remember-module';
import { LAST_MODULE_STORAGE_KEY } from '@/lib/app/journey/paths';

import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/modules/values' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => false }));

beforeEach(() => {
  window.localStorage.clear();
  mockPathname.current = '/app/modules/values';
});

/** The module page's two components, as the page renders them. */
function renderModule(slug: string, displayNumber: string, title: string) {
  mockPathname.current = `/app/modules/${slug}`;
  return renderInShell(
    <>
      <ConversationPane />
      <RememberModule slug={slug} displayNumber={displayNumber} title={title} tier="foundations" />
    </>,
    'large'
  );
}

describe('RememberModule — the remembered slug', () => {
  it('renders nothing of its own and writes the slug under the key the nav reads', () => {
    renderModule('boundaries', '04', 'Boundaries');
    expect(window.localStorage.getItem(LAST_MODULE_STORAGE_KEY)).toBe(JSON.stringify('boundaries'));
  });

  it('follows the reader from one module to the next', () => {
    const { rerender } = renderModule('values', '01', 'Values');
    mockPathname.current = '/app/modules/oneness';
    rerender(
      <>
        <ConversationPane />
        <RememberModule slug="oneness" displayNumber="02" title="Oneness" tier="foundations" />
      </>
    );

    expect(window.localStorage.getItem(LAST_MODULE_STORAGE_KEY)).toBe(JSON.stringify('oneness'));
  });
});

describe('RememberModule — the recents list', () => {
  const stored = () =>
    JSON.parse(window.localStorage.getItem('lelanea.workspace.recents') ?? '[]') as {
      slug: string;
      label: string;
    }[];

  it('records the visit for the topbar strip', () => {
    renderModule('values', '01', 'Values');
    expect(stored()).toEqual([{ slug: 'values', label: '01 · Values', tier: 'foundations' }]);
  });

  it('puts the newest first', () => {
    const { rerender } = renderModule('values', '01', 'Values');
    mockPathname.current = '/app/modules/boundaries';
    rerender(
      <>
        <ConversationPane />
        <RememberModule
          slug="boundaries"
          displayNumber="02"
          title="Boundaries"
          tier="foundations"
        />
      </>
    );

    expect(stored().map((e) => e.slug)).toEqual(['boundaries', 'values']);
  });

  it('MOVES a module already in the list rather than leaving a stale position', () => {
    // A "recently" strip whose order does not follow the reader is just a list.
    const { rerender } = renderModule('values', '01', 'Values');
    const revisit = (slug: string, n: string, title: string) => {
      mockPathname.current = `/app/modules/${slug}`;
      rerender(
        <>
          <ConversationPane />
          <RememberModule slug={slug} displayNumber={n} title={title} tier="foundations" />
        </>
      );
    };
    revisit('boundaries', '02', 'Boundaries');
    revisit('values', '01', 'Values');

    expect(stored().map((e) => e.slug)).toEqual(['values', 'boundaries']);
  });
});

describe('RememberModule — the published place', () => {
  it('gives the conversation column the authored number and title', () => {
    renderModule('values', '01', 'Values');
    expect(screen.getByText('on 01 · Values')).toBeTruthy();
  });

  it('follows a client-side navigation to another module', () => {
    // `rerender` re-wraps into the SAME provider, which is the only way to test
    // a client-side navigation: the route changes while the provider lives on.
    const { rerender } = renderModule('values', '01', 'Values');
    mockPathname.current = '/app/modules/boundaries';
    rerender(
      <>
        <ConversationPane />
        <RememberModule
          slug="boundaries"
          displayNumber="04"
          title="Boundaries"
          tier="foundations"
        />
      </>
    );

    expect(screen.getByText('on 04 · Boundaries')).toBeTruthy();
    expect(screen.queryByText('on 01 · Values')).toBeNull();
  });

  it('says nothing rather than something stale when the route has moved on', () => {
    // The failure this guards: the page publishes from an effect, so between
    // asking for a module and that effect running, the shell still holds the
    // previous one. Showing it tells the reader — confidently — that they are
    // somewhere they have just left. The provider compares the published slug
    // against the route, so the stale frame is empty rather than wrong.
    const { rerender } = renderModule('values', '01', 'Values');
    expect(screen.getByText('on 01 · Values')).toBeTruthy();

    // The route moves; the page has not published yet.
    mockPathname.current = '/app/modules/boundaries';
    rerender(
      <>
        <ConversationPane />
        <RememberModule slug="values" displayNumber="01" title="Values" tier="foundations" />
      </>
    );

    expect(screen.queryByText(/^on /)).toBeNull();
  });

  it('is cleared on the way out to somewhere that is not a module', () => {
    const { rerender } = renderModule('values', '01', 'Values');
    mockPathname.current = '/app/journey';
    rerender(<ConversationPane />);

    // The nav's own label takes over, because `SHELL_NAV` knows that one
    // without a round trip.
    expect(screen.getByText('on Your journey')).toBeTruthy();
  });
});
