// @vitest-environment happy-dom

/**
 * The map drawer: seventeen rows in five tiers from the published graph,
 * opening a row routes and closes the drawer, and `aria-current` follows the
 * open module.
 *
 * The API client is mocked with a projection of the REAL structure — built
 * from `getJourneyStructure()` rather than typed — so a module added to the
 * content shows up in these counts rather than in a stale fixture. The drawer
 * mechanism (slide, scrim, focus) is `drawer.test.tsx`'s; this file is about
 * what is in it.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam, not a mock
 * ---------------------------------------------------------------------------
 * The five tier labels and seventeen rows are Lelañea's. A fork with a
 * different journey pins its own counts and names; a fork with no `content/`
 * has no map to draw and should delete this file with `map-drawer.tsx`.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawers } from '@/components/app/shell/drawer';
import { JOURNEY_MAP_ENDPOINT, TIER_INKS, TIER_TONES } from '@/components/app/shell/map-drawer';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { ShellLayoutProvider } from '@/components/app/shell/use-shell-layout';
import { APIClientError } from '@/lib/api/client';
import { getJourneyStructure } from '@/lib/app/content';
import type { JourneyMapView } from '@/lib/app/journey/map';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/journey' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, get } };
});

/** The real journey, projected the way the route projects it. */
function realMap(): JourneyMapView {
  const structure = getJourneyStructure();
  return {
    slug: 'lelanea-journey',
    version: 1,
    tiers: structure.tiers.map((t) => ({
      id: t.id,
      label: t.label,
      intent: t.intent,
      order: t.order,
    })),
    modules: structure.modules.map((m) => ({
      slug: moduleSlugFromId(m.id),
      number: m.number,
      displayNumber: m.displayNumber,
      title: m.title,
      tier: m.tier,
      state: 'open' as const,
    })),
  };
}

function renderDrawers(pathname = '/app/journey') {
  mockPathname.current = pathname;
  return renderInShell(
    <>
      <ShellRail />
      <Drawers />
    </>
  );
}

const mapPanel = () => screen.getByRole('dialog', { name: 'Your map' });
const rows = () => within(mapPanel()).getAllByRole('link');

async function openMap() {
  await userEvent.click(screen.getByRole('button', { name: /Your map/ }));
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(realMap());
});

describe('MapDrawerBody — what the map holds', () => {
  it('fetches only when first opened, not when the shell mounts', async () => {
    renderDrawers();
    expect(get).not.toHaveBeenCalled();

    await openMap();
    expect(get).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith(JOURNEY_MAP_ENDPOINT);
  });

  it('lists seventeen modules in five tiers, from the graph', async () => {
    renderDrawers();
    await openMap();

    const panel = mapPanel();
    const tiers = within(panel).getAllByRole('heading', { level: 3 });
    expect(tiers.map((h) => h.textContent?.trim())).toEqual([
      'Onboarding',
      'Foundations',
      'Inner Authority',
      'Embodied Relationship',
      'Integration & Expansion',
    ]);
    expect(rows()).toHaveLength(17);
    // Onboarding sits in its own tier, first.
    const onboarding = within(panel).getByRole('region', { name: 'Onboarding' });
    expect(within(onboarding).getAllByRole('link')).toHaveLength(1);
  });

  it('shows number, title and an honest state on each row — no done, no current', async () => {
    // `open` is a fact about the SYSTEM — every module can be jumped into,
    // because no per-user journey exists yet — and putting that word in the row
    // made all seventeen lines say the same non-word about themselves. The
    // design's column says where the READER has got to, so while there is
    // nothing to say, "not started" is the honest thing to say.
    renderDrawers();
    await openMap();

    const values = rows()[1];
    expect(values).toHaveTextContent('01');
    expect(values).toHaveTextContent('Values');
    expect(values).toHaveTextContent('not started');
    expect(values).toHaveAttribute('href', '/app/modules/values');
    expect(rows().filter((r) => r.getAttribute('aria-current') === 'page')).toHaveLength(0);
    expect(mapPanel().textContent).not.toMatch(/complete|step \d/i);
    // And every row says it, rather than one row being special by accident.
    for (const row of rows()) expect(row).toHaveTextContent('not started');
  });

  it('names each arc in its own ink, from a token, and lowercase', async () => {
    // The design names its tiers in their own colour. Both tables are tokens —
    // `TIER_INKS` is the one that carries TEXT and is measured for it; see the
    // table at its declaration for the numbers and for why the orange arc does
    // not use `--color-accent-ink`.
    renderDrawers();
    await openMap();

    for (const tier of realMap().tiers) {
      expect(TIER_TONES[tier.id]).toMatch(/^var\(--color-/);
      expect(TIER_INKS[tier.id]).toMatch(/^var\(--color-.*-ink\)$/);
    }
    // The ceremonial orange fails AA in BOTH themes at this size, so the arc
    // that carries it in `TIER_TONES` must not carry it here.
    expect(TIER_INKS.embodied_relationship).not.toBe('var(--color-accent-ink)');

    const heading = within(mapPanel()).getByRole('heading', { name: /onboarding/i });
    expect(heading.className).toContain('lowercase');
    expect(heading.getAttribute('style')).toContain('--color-status-green-ink');

    expect(within(mapPanel()).getByText(/inner compass/)).toBeInTheDocument();
  });

  it('marks the open module current, and only it', async () => {
    renderDrawers('/app/modules/boundaries');
    await openMap();

    const current = rows().filter((r) => r.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Boundaries');
  });

  it('routes and closes the drawer when a row is opened', async () => {
    renderDrawers();
    await openMap();

    const row = rows().find((r) => r.textContent?.includes('Standards'))!;
    expect(row).toHaveAttribute('href', '/app/modules/standards');
    await userEvent.click(row);

    // Closed: the panel is inert and off screen; the rail button is no longer expanded.
    expect(mapPanel()).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: /Your map/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it('still arrives if the drawer is closed while the map is loading', async () => {
    let resolve!: (map: JourneyMapView) => void;
    get.mockReturnValue(new Promise<JourneyMapView>((r) => (resolve = r)));
    renderDrawers();
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));
    await userEvent.click(screen.getByRole('button', { name: /Close your map/ }));
    resolve(realMap());
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    await waitFor(() => expect(rows()).toHaveLength(17));
    expect(get).toHaveBeenCalledOnce();
  });

  it('keeps what it loaded across a close and re-open', async () => {
    renderDrawers();
    await openMap();
    await userEvent.click(screen.getByRole('button', { name: /Close your map/ }));
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    expect(rows()).toHaveLength(17);
    expect(get).toHaveBeenCalledOnce();
  });
});

describe('MapDrawerBody — under StrictMode, as the app runs', () => {
  it('still shows the map after the dev double-mount', async () => {
    // `next.config` sets `reactStrictMode: true`, so every effect mounts,
    // unmounts and mounts again in development. A mounted-flag effect that
    // only CLEARS the flag in its cleanup is left false by that sequence and
    // drops every response — the drawer sat at "Finding your map…" with a
    // 200 in the network tab. `renderInShell` does not use StrictMode, which
    // is why the cases above could not catch it.
    mockPathname.current = '/app/journey';
    render(
      <StrictMode>
        <ShellLayoutProvider>
          <ShellRail />
          <Drawers />
        </ShellLayoutProvider>
      </StrictMode>
    );
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    await waitFor(() => expect(rows()).toHaveLength(17));
    expect(get).toHaveBeenCalledOnce();
  });
});

describe('MapDrawerBody — when there is no map', () => {
  it('says the map is not published yet on a 404, rather than failing', async () => {
    get.mockRejectedValue(new APIClientError('Not found', 'NOT_FOUND', 404));
    renderDrawers();
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    await waitFor(() =>
      expect(within(mapPanel()).getByText(/not published yet/)).toBeInTheDocument()
    );
  });

  it('reports a failed load honestly, and tries again on the next open', async () => {
    get.mockRejectedValueOnce(new Error('network'));
    renderDrawers();
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));
    await waitFor(() =>
      expect(within(mapPanel()).getByRole('status')).toHaveTextContent(/could not be loaded/)
    );

    // "Open it again in a moment" has to be true: the shell stays mounted
    // across every in-app navigation, so a failure that stuck would be for
    // the whole session.
    await userEvent.click(screen.getByRole('button', { name: /Close your map/ }));
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    await waitFor(() => expect(rows()).toHaveLength(17));
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404 — unpublished is a state, not a failure', async () => {
    get.mockRejectedValue(new APIClientError('Not found', 'NOT_FOUND', 404));
    renderDrawers();
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));
    await waitFor(() =>
      expect(within(mapPanel()).getByText(/not published yet/)).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole('button', { name: /Close your map/ }));
    await userEvent.click(screen.getByRole('button', { name: /Your map/ }));

    expect(get).toHaveBeenCalledOnce();
  });
});
