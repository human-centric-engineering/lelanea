// @vitest-environment happy-dom

/**
 * The resources drawer follows what is open: her words on it, two to watch,
 * three to read — from `/api/v1/app/content/resources/:key` (f-resources t-75).
 *
 * `drawer.test.tsx` covers the panel's chrome as chrome. This file is about
 * what the panel SAYS: that the key comes from the route, that the head names
 * the module and takes its arc, that her words reach the card verbatim, that a
 * full selection renders as two cards and three rows and an empty one as the
 * honest empty states, and that a failed fetch is said rather than left blank.
 *
 * The API client is mocked; the fixtures are shaped as the route serves them.
 * The `documentId` → page table is pinned against the REAL collection, so a
 * document renamed in the content fails here rather than as a dead link.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — the last section reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * `DOCUMENT_PAGES` is pinned against Lelañea's foundational documents, and the
 * welcome (`the_initiation`) is named as the one with no page. A fork with a
 * different collection should rewrite that section against its own document
 * ids and its own pages; everything above it runs on fixtures and can be kept.
 *
 * @see components/app/shell/resources-drawer.tsx
 */

import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Drawers } from '@/components/app/shell/drawer';
import { TIER_INKS } from '@/components/app/shell/map-drawer';
import {
  DOCUMENT_PAGES,
  RESOURCES_ENDPOINT,
  RESOURCES_FALLBACK_LEDE,
  resourceKeyFor,
} from '@/components/app/shell/resources-drawer';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { useShellLayout } from '@/components/app/shell/use-shell-layout';
import { APIClientError } from '@/lib/api/client';
import { listFoundationalDocuments } from '@/lib/app/content';
import type { ResourcesSelection } from '@/lib/app/content/resources';
import { renderInShell } from '@/tests/unit/components/app/shell/render-shell';

const mockPathname = vi.hoisted(() => ({ current: '/app/modules/values' }));
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname.current }));

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, get } };
});

// ---------------------------------------------------------------------------
// Fixtures, shaped as the route serves them
// ---------------------------------------------------------------------------

const COLLECTION = {
  id: 'lelanea_resources',
  title: 'Fixture',
  version: '0.1',
  locale: 'en-US',
  provenance: { status: 'draft' as const, awaitingSignOffFrom: 'Her', note: 'fixture' },
};

const WORDS_ON_VALUES = {
  quote: 'If you don’t shape your values, the world will shape them for you.',
  paragraphs: [
    'When you know your values deeply — not as nice words on a wall, but as lived principles — you become centered.',
    'You are no longer a sponge soaking up the expectations of the world. You become an anchor.',
  ],
  source: { collection: 'values_module' as const, id: 'lesson_centered_living' },
};

function film(id: string, title: string, duration: string) {
  return {
    id,
    title,
    subtitle: `what ${id} is for`,
    relatesTo: 'module_01_values',
    duration,
    href: `https://films.example/${id}`,
  };
}

/** Her words on values, two films, three readings — the full panel. */
function fullSelection(): ResourcesSelection {
  return {
    collection: COLLECTION,
    key: 'values',
    title: 'Values',
    tier: 'foundations',
    words: WORDS_ON_VALUES,
    wordsAreOwn: true,
    films: [
      film('why-values', 'Why values come first', '6:12'),
      film('four-marks', 'The four marks', '4:48'),
    ],
    readings: [
      {
        id: 'inheritance-test',
        title: 'The inheritance test',
        subtitle: 'telling yours from your father’s',
        relatesTo: 'module_01_values',
        readingTime: '8 min',
        href: 'https://reads.example/inheritance-test',
      },
      {
        id: 'the-mission',
        title: 'The mission',
        subtitle: 'why this exists',
        relatesTo: null,
        readingTime: '4 min',
        documentId: 'the_mission',
      },
      {
        id: 'the-welcome',
        title: 'The welcome',
        subtitle: 'the first thing she says',
        relatesTo: null,
        readingTime: '3 min',
        documentId: 'the_initiation',
      },
    ],
  };
}

/** The shipped file today: her words, and nothing to watch or read. */
function emptySelection(overrides: Partial<ResourcesSelection> = {}): ResourcesSelection {
  return {
    ...fullSelection(),
    films: [],
    readings: [],
    ...overrides,
  };
}

/** A module with no words of its own: the API fell back to the default. */
function fallbackSelection(): ResourcesSelection {
  return emptySelection({
    key: 'boundaries',
    title: 'Boundaries',
    words: {
      quote: 'Whatever it is that brought you here, you listened.',
      paragraphs: ['This is not simply an app.', 'It is an invitation.'],
      source: { collection: 'foundational_documents', id: 'the_initiation' },
    },
    wordsAreOwn: false,
  });
}

/** Answer the resources route from a table; the map route is not this file's. */
function serve(answers: Record<string, ResourcesSelection | Error>) {
  get.mockImplementation((path: string) => {
    if (!path.startsWith(`${RESOURCES_ENDPOINT}/`)) return new Promise<never>(() => {});
    const request = path.slice(RESOURCES_ENDPOINT.length + 1);
    const answer = answers[request];
    if (answer === undefined) {
      return Promise.reject(new APIClientError('No resources for that key', 'NOT_FOUND', 404));
    }
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

function renderDrawers(pathname = '/app/modules/values') {
  mockPathname.current = pathname;
  return renderInShell(
    <>
      <ShellRail />
      <Drawers />
    </>
  );
}

const panel = () => screen.getByRole('dialog', { name: 'Resources' });
const openResources = () => userEvent.click(screen.getByRole('button', { name: /Resources/ }));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  serve({ values: fullSelection() });
});

// ---------------------------------------------------------------------------
// The key comes from the route
// ---------------------------------------------------------------------------

describe('resourceKeyFor', () => {
  it.each([
    ['/app/modules/values', 'values'],
    ['/app/modules/curiosity-of-self', 'curiosity-of-self'],
    ['/app/modules/values/anything-deeper', 'values'],
    ['/app/journey', 'journey'],
    ['/app/journey/sessions', 'journey'],
    ['/app/situations', 'situations'],
    ['/app/situations/abc', 'situations'],
    ['/app', 'default'],
    ['/app/settings', 'default'],
    ['/app/usage', 'default'],
    ['/app/modules', 'default'],
    ['/app/modules/', 'default'],
  ])('%s → %s', (pathname, key) => {
    expect(resourceKeyFor(pathname)).toBe(key);
  });
});

// ---------------------------------------------------------------------------
// The fetch, and what it asks for
// ---------------------------------------------------------------------------

describe('what the drawer asks the API', () => {
  it('fetches nothing until it is opened', () => {
    renderDrawers();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining(RESOURCES_ENDPOINT));
  });

  it('asks for the key of what is open', async () => {
    renderDrawers('/app/modules/values');
    await openResources();
    expect(get).toHaveBeenCalledWith(`${RESOURCES_ENDPOINT}/values`);
  });

  it('asks for the default on the clean conversation', async () => {
    serve({ default: emptySelection({ key: 'default', title: 'Lelañea', tier: null }) });
    renderDrawers('/app');
    await openResources();
    expect(get).toHaveBeenCalledWith(`${RESOURCES_ENDPOINT}/default`);
  });

  it('sends a pinned film as ?film=', async () => {
    serve({ 'values?film=four-marks': fullSelection() });
    function Opener() {
      const { openDrawer } = useShellLayout();
      return (
        <button type="button" onClick={() => openDrawer('resources', { film: 'four-marks' })}>
          pin
        </button>
      );
    }
    mockPathname.current = '/app/modules/values';
    renderInShell(
      <>
        <Opener />
        <Drawers />
      </>
    );
    await userEvent.click(screen.getByRole('button', { name: 'pin' }));
    expect(get).toHaveBeenCalledWith(`${RESOURCES_ENDPOINT}/values?film=four-marks`);
  });

  it('follows the reader: re-asks when the route changes under an open drawer', async () => {
    serve({
      values: fullSelection(),
      boundaries: fallbackSelection(),
    });
    const view = renderDrawers('/app/modules/values');
    await openResources();
    await waitFor(() => expect(within(panel()).getByText(/anchor/)).toBeInTheDocument());

    mockPathname.current = '/app/modules/boundaries';
    view.rerender(
      <>
        <ShellRail />
        <Drawers />
      </>
    );

    await waitFor(() => expect(get).toHaveBeenCalledWith(`${RESOURCES_ENDPOINT}/boundaries`));
    await waitFor(() => expect(within(panel()).getByText(/invitation/)).toBeInTheDocument());
  });

  it('does not re-ask for the same key on a second open', async () => {
    renderDrawers();
    await openResources();
    await waitFor(() => expect(within(panel()).getByText(/anchor/)).toBeInTheDocument());
    await userEvent.click(within(panel()).getByRole('button', { name: /Close/ }));
    await openResources();
    const calls = get.mock.calls.filter(([path]) => String(path).startsWith(RESOURCES_ENDPOINT));
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The head: the lede names the module and the rule takes its arc
// ---------------------------------------------------------------------------

describe('the head follows the selection', () => {
  it('names Values and takes the foundations ink', async () => {
    renderDrawers('/app/modules/values');
    await openResources();

    await waitFor(() =>
      expect(
        within(panel()).getByText(
          'On Values. This follows whatever you have open in the workspace.'
        )
      ).toBeInTheDocument()
    );
    const head = panel().querySelector('header');
    expect(head?.getAttribute('style')).toContain(TIER_INKS.foundations);
    expect(head?.querySelector('.brand-eyebrow')?.getAttribute('style')).toContain(
      TIER_INKS.foundations
    );
  });

  it('says the general line, in the secondary ink, until it knows', async () => {
    renderDrawers();
    // Before opening: nothing fetched, the general lede stands.
    expect(within(panel()).getByText(RESOURCES_FALLBACK_LEDE)).toBeInTheDocument();
    expect(panel().querySelector('header')?.getAttribute('style')).toContain(
      'var(--color-secondary-ink)'
    );
  });

  it('keeps the secondary ink for a key with no arc', async () => {
    serve({ journey: emptySelection({ key: 'journey', title: 'The journey', tier: null }) });
    renderDrawers('/app/journey');
    await openResources();
    await waitFor(() => expect(within(panel()).getByText(/On The journey\./)).toBeInTheDocument());
    expect(panel().querySelector('header')?.getAttribute('style')).toContain(
      'var(--color-secondary-ink)'
    );
  });

  it('never tints the eyebrow with a raw arc hue', async () => {
    renderDrawers('/app/modules/values');
    await openResources();
    await waitFor(() => expect(within(panel()).getByText(/On Values/)).toBeInTheDocument());
    const eyebrow = panel().querySelector('header .brand-eyebrow');
    expect(eyebrow?.getAttribute('style')).toMatch(/var\(--color-[a-z-]*-ink\)/);
  });
});

// ---------------------------------------------------------------------------
// The body
// ---------------------------------------------------------------------------

describe('her words', () => {
  it('reach the card verbatim, each paragraph its own element', async () => {
    renderDrawers();
    await openResources();

    const quote = await within(panel()).findByText(WORDS_ON_VALUES.quote);
    expect(quote.className).toContain('brand-quote');
    for (const paragraph of WORDS_ON_VALUES.paragraphs) {
      const p = within(panel()).getByText(paragraph);
      expect(p.tagName).toBe('P');
    }
    // Two paragraphs, two <p>s — never one re-flowed block.
    const card = quote.closest('figure');
    expect(card?.querySelectorAll('blockquote p')).toHaveLength(
      1 + WORDS_ON_VALUES.paragraphs.length
    );
  });

  it('says when they are her words on the whole rather than on this', async () => {
    serve({ boundaries: fallbackSelection() });
    renderDrawers('/app/modules/boundaries');
    await openResources();

    await within(panel()).findByText(/It is an invitation\./);
    expect(within(panel()).getByText(/her words on the whole/)).toBeInTheDocument();
  });

  it('says nothing of the kind when they are', async () => {
    renderDrawers();
    await openResources();
    await within(panel()).findByText(/anchor/);
    expect(within(panel()).queryByText(/her words on the whole/)).toBeNull();
  });
});

describe('to watch and to read', () => {
  it('renders two cards and three rows from a full selection', async () => {
    renderDrawers();
    await openResources();
    await within(panel()).findByText(/anchor/);

    const watch = within(panel()).getByRole('heading', { name: 'to watch' }).closest('section')!;
    const films = within(watch).getAllByRole('link');
    expect(films).toHaveLength(2);
    expect(films[0]).toHaveTextContent('Why values come first');
    expect(films[0]).toHaveTextContent('6:12');

    const read = within(panel()).getByRole('heading', { name: 'to read' }).closest('section')!;
    expect(read.querySelectorAll('li')).toHaveLength(3);
  });

  it('opens a film in a new tab, safely', async () => {
    renderDrawers();
    await openResources();
    const card = await within(panel()).findByRole('link', { name: /Why values come first/ });
    expect(card).toHaveAttribute('href', 'https://films.example/why-values');
    expect(card).toHaveAttribute('target', '_blank');
    expect(card).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens an external reading in a new tab, and a document on its own page', async () => {
    renderDrawers();
    await openResources();
    const external = await within(panel()).findByRole('link', { name: /The inheritance test/ });
    expect(external).toHaveAttribute('href', 'https://reads.example/inheritance-test');
    expect(external).toHaveAttribute('target', '_blank');

    const mission = within(panel()).getByRole('link', { name: /The mission/ });
    expect(mission).toHaveAttribute('href', '/mission');
    expect(mission).not.toHaveAttribute('target');
  });

  it('shows a document the site has no page for as a row that goes nowhere', async () => {
    renderDrawers();
    await openResources();
    await within(panel()).findByText('The welcome');
    expect(within(panel()).queryByRole('link', { name: /The welcome/ })).toBeNull();
  });

  it('says each section is empty rather than leaving a heading over nothing', async () => {
    serve({ values: emptySelection() });
    renderDrawers();
    await openResources();

    await within(panel()).findByText(/Nothing to watch yet/);
    expect(within(panel()).getByText(/Nothing to read yet/)).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: 'to watch' })).toBeInTheDocument();
    expect(within(panel()).getByRole('heading', { name: 'to read' })).toBeInTheDocument();
    // And invents nothing: no duration, no link, no image.
    expect(panel().textContent).not.toMatch(/\d+\s*(min|:\d\d)/i);
    expect(within(panel()).queryByRole('link')).toBeNull();
    expect(panel().querySelector('img, video')).toBeNull();
  });

  it('hard-codes no string the API serves', async () => {
    // The only copy of the panel that is the component's own is the chrome,
    // the empty states and the fallback note. Everything with a source in the
    // selection must come from it — so a selection with different words shows
    // different words, not the shipped ones.
    serve({
      values: emptySelection({
        words: {
          quote: 'A different quote.',
          paragraphs: ['A different line.'],
          source: WORDS_ON_VALUES.source,
        },
      }),
    });
    renderDrawers();
    await openResources();
    await within(panel()).findByText('A different quote.');
    expect(within(panel()).queryByText(WORDS_ON_VALUES.quote)).toBeNull();
  });
});

describe('when it cannot load', () => {
  it('says so, rather than leaving the panel blank', async () => {
    serve({ values: new APIClientError('boom', 'INTERNAL_ERROR', 500) });
    renderDrawers();
    await openResources();

    const status = await within(panel()).findByRole('status');
    expect(status).toHaveTextContent(/could not be loaded/);
    expect(within(panel()).getByText(RESOURCES_FALLBACK_LEDE)).toBeInTheDocument();
  });

  it('tries again on the next open', async () => {
    serve({ values: new APIClientError('boom', 'INTERNAL_ERROR', 500) });
    renderDrawers();
    await openResources();
    await within(panel()).findByRole('status');

    serve({ values: fullSelection() });
    await userEvent.click(within(panel()).getByRole('button', { name: /Close/ }));
    await openResources();
    await within(panel()).findByText(/anchor/);
  });

  it('shows the loading line while the first answer is on its way', async () => {
    get.mockImplementation(() => new Promise<never>(() => {}));
    renderDrawers();
    await openResources();
    expect(within(panel()).getByText(/Finding her words/)).toBeInTheDocument();
  });

  it('drops an answer that arrives after the reader has moved on', async () => {
    let resolveValues: (s: ResourcesSelection) => void = () => {};
    const slowValues = new Promise<ResourcesSelection>((resolve) => {
      resolveValues = resolve;
    });
    get.mockImplementation((path: string) => {
      if (path === `${RESOURCES_ENDPOINT}/values`) return slowValues;
      if (path === `${RESOURCES_ENDPOINT}/boundaries`) return Promise.resolve(fallbackSelection());
      return new Promise<never>(() => {});
    });
    const view = renderDrawers('/app/modules/values');
    await openResources();

    mockPathname.current = '/app/modules/boundaries';
    view.rerender(
      <>
        <ShellRail />
        <Drawers />
      </>
    );
    await within(panel()).findByText(/It is an invitation\./);

    await act(async () => {
      resolveValues(fullSelection());
      await Promise.resolve();
    });
    // Boundaries stays; the late Values answer does not overwrite it.
    expect(within(panel()).getByText(/On Boundaries\./)).toBeInTheDocument();
    expect(within(panel()).queryByText(/anchor/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The document table is pinned to the real collection
// ---------------------------------------------------------------------------

describe('DOCUMENT_PAGES', () => {
  it('names only documents the collection has', () => {
    const ids = new Set(listFoundationalDocuments().documents.map((d) => d.id));
    for (const id of Object.keys(DOCUMENT_PAGES)) expect(ids.has(id), id).toBe(true);
  });

  it('leaves out the welcome, which has no page of its own', () => {
    expect(DOCUMENT_PAGES).not.toHaveProperty('the_initiation');
  });
});
