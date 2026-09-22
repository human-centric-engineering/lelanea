// @vitest-environment happy-dom

/**
 * `/app/modules/[slug]`: a page for every module on the published map, a 404
 * for anything else, and the Values page shows its authored parts.
 *
 * `getJourneyMap` is mocked with the real projection shape; the journey store
 * serves the rows the seed writes from the real structure file (t-87), so the
 * Values parts are hers. Deliberately NOT a
 * row in `shell-view-pages.test.tsx` — that list is the nav's destinations, and
 * `shell.md` says modules belong in a test of their own.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real journey seed, not a hand-written fixture
 * ---------------------------------------------------------------------------
 * The slugs, titles and parts asserted below are Lelañea's journey, read from
 * the real structure file so the page and the content cannot drift apart. A
 * fork with a different journey pins its own; a fork with no `content/` has no
 * module pages and should delete this file with the route.
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ShellLayoutProvider } from '@/components/app/shell/use-shell-layout';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';
import { fakeJourneyStore } from '@/tests/helpers/app/content-stores';

const { getJourneyMap, notFound } = vi.hoisted(() => ({
  getJourneyMap: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/app/journey/map', () => ({ getJourneyMap }));
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);
vi.mock('next/navigation', () => ({ notFound, usePathname: () => '/app/modules/values' }));
vi.mock('@/lib/hooks/use-local-storage', () => ({
  useLocalStorage: () => [null, vi.fn(), vi.fn()],
}));

import ModulePage, { generateMetadata } from '@/app/(lelanea)/app/modules/[slug]/page';

const store = fakeJourneyStore();
beforeEach(() => store.reset());

async function realMap() {
  const structure = await getJourneyStructure();
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

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe('/app/modules/[slug]', () => {
  it('renders the Values page with its three authored parts', async () => {
    getJourneyMap.mockResolvedValue(await realMap());
    const ui = await ModulePage(params('values'));
    render(<ShellLayoutProvider>{ui}</ShellLayoutProvider>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Values');
    expect(screen.getByText('foundations · module 01')).toBeInTheDocument();
    expect(screen.getByText('Orientation')).toBeInTheDocument();
    expect(screen.getByText('Discernment')).toBeInTheDocument();
    expect(screen.getByText('Integration')).toBeInTheDocument();
  });

  it('renders any other module with the unnamed pair and its tier’s intent', async () => {
    getJourneyMap.mockResolvedValue(await realMap());
    const ui = await ModulePage(params('oneness'));
    render(<ShellLayoutProvider>{ui}</ShellLayoutProvider>);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Oneness');
    expect(screen.getByText('integration & expansion · module 16')).toBeInTheDocument();
    expect(screen.getByText('Part 1')).toBeInTheDocument();
    expect(screen.getByText(/Spiritual Oneness arc/)).toBeInTheDocument();
  });

  it('404s a slug that is not on the published map', async () => {
    getJourneyMap.mockResolvedValue(await realMap());
    await expect(ModulePage(params('typo'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalled();
  });

  it('404s everything while no map is published', async () => {
    getJourneyMap.mockResolvedValue(null);
    await expect(ModulePage(params('values'))).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('titles the tab with the module’s own name, as a plain string', async () => {
    getJourneyMap.mockResolvedValue(await realMap());
    await expect(generateMetadata(params('boundaries'))).resolves.toEqual({ title: 'Boundaries' });
    await expect(generateMetadata(params('typo'))).resolves.toEqual({ title: 'Module' });
  });

  it('names the Values parts from the module row, not the file (t-87)', async () => {
    const values = (await getJourneyStructure()).modules[1];
    store.editModule('module_01_values', {
      phaseTiers: values.phaseTiers!.map((tier) =>
        tier.id === 'discernment' ? { ...tier, label: 'Discernment, edited' } : tier
      ),
    });
    getJourneyMap.mockResolvedValue(await realMap());

    render(<ShellLayoutProvider>{await ModulePage(params('values'))}</ShellLayoutProvider>);

    expect(screen.getByText('Discernment, edited')).toBeInTheDocument();
  });
});
