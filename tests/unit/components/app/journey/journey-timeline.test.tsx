// @vitest-environment happy-dom

/**
 * The journey record as a timeline: newest first, one stop open at a time,
 * the signpost pinned last and never counted, search and filters in the URL,
 * and the empty states (f-journey-record t-148; product description §3.16).
 *
 * `JourneyStop` and `NextStop` render for real — what each one's body does is
 * `journey-stop.test.tsx`'s job. This file is about the thread around them:
 * what order they come in, which one is open, and what the URL controls do.
 *
 * @see components/app/journey/journey-timeline.tsx
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockRouter } from '@/tests/types/mocks';

const router = createMockRouter();
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/journey',
  useRouter: () => router,
}));

import {
  JourneyTimeline,
  SEARCH_PAUSE_MS,
  journeySearch,
} from '@/components/app/journey/journey-timeline';
import type { JourneyEntry } from '@/lib/app/journey-record/entry';
import type { JourneyRecordPage, JourneyRecordQuery } from '@/lib/app/journey-record/query';
import type { JourneySignpost } from '@/lib/app/journey/next';

function entry(overrides: Partial<JourneyEntry> & Pick<JourneyEntry, 'id'>): JourneyEntry {
  return {
    kind: 'synopsis',
    state: 'kept',
    summary: 'Untitled stop',
    body: 'Nothing written yet.',
    outcomes: [],
    modules: [],
    notes: [],
    withheldFromAgent: false,
    regenerationsLeft: null,
    sourceRemoved: false,
    occurredAt: '2026-10-01T09:00:00.000Z',
    keptAt: '2026-10-01T09:05:00.000Z',
    updatedAt: '2026-10-01T09:05:00.000Z',
    session: null,
    ...overrides,
  };
}

function record(overrides: Partial<JourneyRecordPage> = {}): JourneyRecordPage {
  return {
    entries: [],
    matched: 0,
    total: 0,
    drafts: 0,
    totals: { synopses: 0, own: 0, outcomes: { action: 0, insight: 0, tension: 0 } },
    modules: [],
    notes: [],
    ...overrides,
  };
}

const NO_QUERY: JourneyRecordQuery = {};

function stat(label: string): HTMLElement {
  return screen.getByText(label).closest('div') as HTMLElement;
}

/**
 * Only the thread's own stop heads — each carries `aria-expanded`, which no
 * button inside an OPEN stop's body does, so an open synopsis's "Change this
 * account" / "Remove" controls never get counted as a stop.
 */
function stopHeads(): HTMLElement[] {
  const list = screen.getByRole('list', { name: /your journey, newest first/i });
  return within(list)
    .getAllByRole('button')
    .filter((button) => button.hasAttribute('aria-expanded'));
}

interface Call {
  path: string;
  method: string;
  body: unknown;
}

const world = { calls: [] as Call[] };
// The client under test always calls `fetch` with a string path, never a
// `URL` or a `Request` — narrowing the stub's signature to match is what
// makes `path` safe to record directly.
const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
  world.calls.push({
    path,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  });
  return new Response(null, { status: 200 });
});

beforeEach(() => {
  world.calls = [];
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('journeySearch', () => {
  it('writes every filter the query carries', () => {
    expect(journeySearch({ q: 'brother', module: 'values', outcome: 'action', kind: 'own' })).toBe(
      '?q=brother&module=values&outcome=action&kind=own'
    );
  });

  it('omits everything left out, rather than writing it empty', () => {
    expect(journeySearch({})).toBe('');
    expect(journeySearch({ q: 'brother' })).toBe('?q=brother');
  });

  it('leaves drafts out of the URL — the route always asks for it itself', () => {
    expect(journeySearch({ drafts: true })).toBe('');
  });
});

describe('newest-first ordering, and the signpost pinned last and never counted', () => {
  const newest = entry({
    id: 'cmnewest000000000000000001',
    summary: 'Newest: talked about money',
    occurredAt: '2026-10-05T09:00:00.000Z',
  });
  const middle = entry({
    id: 'cmmiddle000000000000000002',
    kind: 'own',
    summary: 'Middle: wrote my own note',
    occurredAt: '2026-10-03T09:00:00.000Z',
  });
  const oldest = entry({
    id: 'cmoldest000000000000000003',
    summary: 'Oldest: talked about values',
    occurredAt: '2026-10-01T09:00:00.000Z',
  });
  const next: JourneySignpost = {
    slug: 'boundaries',
    label: '02 · Boundaries',
    href: '/app/modules/boundaries',
    standing: 'next',
  };
  // Deliberately NOT equal to entries.length (3) + 1: this is the number that
  // would be on screen if the signpost were wrongly folded into the totals.
  const totals = { synopses: 2, own: 1, outcomes: { action: 0, insight: 0, tension: 0 } };

  function thread(given: JourneySignpost | null) {
    return render(
      <JourneyTimeline
        record={record({
          entries: [newest, middle, oldest],
          total: 3,
          matched: 3,
          totals,
        })}
        query={NO_QUERY}
        next={given}
        moduleLabels={{}}
      />
    );
  }

  it('renders every stop in the order the server sent them, with the signpost strictly after the last one', () => {
    thread(next);

    const heads = stopHeads();

    expect(heads).toHaveLength(4);
    expect(heads.map((h) => h.textContent)).toEqual([
      expect.stringContaining('Newest: talked about money'),
      expect.stringContaining('Middle: wrote my own note'),
      expect.stringContaining('Oldest: talked about values'),
      expect.stringContaining('What’s next'),
    ]);
  });

  it('shows the record’s own totals on the stat row, not a count of what is rendered', () => {
    thread(next);

    // 2 kept synopses among a thread of 3 rendered stops plus a signpost —
    // if the stat were counting rendered stops this would read 3 or 4.
    expect(stat('sessions kept').textContent).toContain('2');
    expect(stat('of your own').textContent).toContain('1');
  });

  it('shows the identical totals whether or not a signpost is on the thread', () => {
    const { rerender } = thread(next);
    const withNext = stat('sessions kept').textContent;

    rerender(
      <JourneyTimeline
        record={record({ entries: [newest, middle, oldest], total: 3, matched: 3, totals })}
        query={NO_QUERY}
        next={null}
        moduleLabels={{}}
      />
    );

    expect(stat('sessions kept').textContent).toBe(withNext);
    // And the signpost itself is gone — "What's next" was never one of the three stops.
    expect(screen.queryByText(/What’s next/)).toBeNull();
    expect(stopHeads()).toHaveLength(3);
  });
});

describe('one stop open at a time', () => {
  function threeStops() {
    const a = entry({
      id: 'cma00000000000000000000001',
      summary: 'A',
      occurredAt: '2026-10-03T09:00:00.000Z',
    });
    const b = entry({
      id: 'cmb00000000000000000000002',
      summary: 'B',
      occurredAt: '2026-10-02T09:00:00.000Z',
    });
    const c = entry({
      id: 'cmc00000000000000000000003',
      summary: 'C',
      occurredAt: '2026-10-01T09:00:00.000Z',
    });
    render(
      <JourneyTimeline
        record={record({
          entries: [a, b, c],
          total: 3,
          matched: 3,
          totals: { synopses: 3, own: 0, outcomes: { action: 0, insight: 0, tension: 0 } },
        })}
        query={NO_QUERY}
        next={null}
        moduleLabels={{}}
      />
    );
    return stopHeads();
  }

  it('opens the newest stop by default, with its body visible', () => {
    const [a, b, c] = threeStops();
    expect(a.getAttribute('aria-expanded')).toBe('true');
    expect(b.getAttribute('aria-expanded')).toBe('false');
    expect(c.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('Nothing written yet.')).toBeTruthy();
  });

  it('opening another stop closes the one that was open', async () => {
    const [a, b] = threeStops();
    expect(a.getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(b);

    expect(b.getAttribute('aria-expanded')).toBe('true');
    expect(a.getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking the open stop closes it, leaving nothing open', async () => {
    const [a] = threeStops();

    await userEvent.click(a);

    expect(a.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { expanded: true })).toBeNull();
  });
});

describe('finding your way around', () => {
  function populated(query: JourneyRecordQuery = {}) {
    return render(
      <JourneyTimeline
        record={record({
          entries: [entry({ id: 'cma00000000000000000000001', summary: 'Found it' })],
          total: 1,
          matched: 1,
          totals: { synopses: 1, own: 0, outcomes: { action: 0, insight: 0, tension: 0 } },
          modules: ['values', 'boundaries'],
        })}
        query={query}
        next={null}
        moduleLabels={{ values: '01 · Values' }}
      />
    );
  }

  it('types into the URL after a pause, via router.replace, not push', async () => {
    populated();

    await userEvent.type(
      screen.getByRole('searchbox', { name: /search your journey/i }),
      'brother'
    );
    expect(router.replace).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, SEARCH_PAUSE_MS + 100));

    expect(router.replace).toHaveBeenCalledWith('/app/journey?q=brother', { scroll: false });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('picks a module through the URL via router.push, not replace', async () => {
    populated();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /show entries about a module/i }),
      'values'
    );

    expect(router.push).toHaveBeenCalledWith('/app/journey?module=values', { scroll: false });
  });

  it('picks an outcome kind through the URL', async () => {
    populated();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /show entries with an outcome/i }),
      'action'
    );

    expect(router.push).toHaveBeenCalledWith('/app/journey?outcome=action', { scroll: false });
  });

  it('picks an entry kind through the URL', async () => {
    populated();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: /show entries of this kind/i }),
      'own'
    );

    expect(router.push).toHaveBeenCalledWith('/app/journey?kind=own', { scroll: false });
  });

  it('clears back to the bare path, dropping every filter at once', async () => {
    populated({ q: 'brother', module: 'values' });

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(router.push).toHaveBeenCalledWith('/app/journey', { scroll: false });
  });

  it('says how many matched while filtering, and nothing extra otherwise', () => {
    const { rerender } = populated({ q: 'brother' });
    expect(screen.getByRole('status').textContent).toBe('1 entry found');

    rerender(
      <JourneyTimeline
        record={record({
          entries: [entry({ id: 'cma00000000000000000000001' })],
          total: 1,
          matched: 1,
          totals: { synopses: 1, own: 0, outcomes: { action: 0, insight: 0, tension: 0 } },
        })}
        query={NO_QUERY}
        next={null}
        moduleLabels={{}}
      />
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('empty states', () => {
  it('says nothing is recorded yet for a brand-new person, with no stats row', () => {
    render(<JourneyTimeline record={record()} query={NO_QUERY} next={null} moduleLabels={{}} />);

    expect(screen.getByText('Nothing is recorded here yet')).toBeTruthy();
    expect(screen.queryByText('sessions kept')).toBeNull();
    expect(screen.queryByRole('search')).toBeNull();
  });

  it('says nothing matches when a filter leaves the record with no entries, but still shows the stats', () => {
    render(
      <JourneyTimeline
        record={record({
          total: 4,
          matched: 0,
          totals: { synopses: 3, own: 1, outcomes: { action: 0, insight: 0, tension: 0 } },
        })}
        query={{ q: 'zebra' }}
        next={null}
        moduleLabels={{}}
      />
    );

    expect(screen.getByText('Nothing in your journey matches that.')).toBeTruthy();
    expect(screen.queryByText('Nothing is recorded here yet')).toBeNull();
    expect(stat('sessions kept')).toBeTruthy();
  });
});

describe('writing an entry yourself', () => {
  it('opens the composer and POSTs the words to the record endpoint', async () => {
    render(<JourneyTimeline record={record()} query={NO_QUERY} next={null} moduleLabels={{}} />);

    await userEvent.click(screen.getByRole('button', { name: 'Write an entry' }));
    await userEvent.type(screen.getByLabelText('Your words'), 'Woke at three.');
    await userEvent.click(screen.getByRole('button', { name: 'Keep this entry' }));

    expect(world.calls).toEqual([
      {
        method: 'POST',
        path: '/api/v1/app/journey-record',
        body: { summary: '', body: 'Woke at three.', withheldFromAgent: false },
      },
    ]);
    // The composer closes itself again once the write goes through.
    expect(screen.queryByLabelText('Your words')).toBeNull();
    expect(screen.getByRole('button', { name: 'Write an entry' })).toBeTruthy();
  });
});

describe('copy', () => {
  it('never says a module "closed" anywhere on a populated thread', () => {
    const synopsis = entry({
      id: 'cma00000000000000000000001',
      modules: ['values'],
      outcomes: [{ kind: 'action', text: 'Say no on Thursday' }],
    });
    const draft = entry({
      id: 'cmb00000000000000000000002',
      state: 'draft',
      keptAt: null,
      summary: null,
      body: 'Draft of a session about money.',
      occurredAt: '2026-10-02T09:00:00.000Z',
    });
    const next: JourneySignpost = {
      slug: 'boundaries',
      label: '02 · Boundaries',
      href: '/app/modules/boundaries',
      standing: 'current',
    };

    const { container } = render(
      <JourneyTimeline
        record={record({
          entries: [draft, synopsis],
          total: 1,
          drafts: 1,
          matched: 2,
          totals: { synopses: 1, own: 0, outcomes: { action: 1, insight: 0, tension: 0 } },
          modules: ['values'],
        })}
        query={NO_QUERY}
        next={next}
        moduleLabels={{ values: '01 · Values' }}
      />
    );

    expect(container.textContent).not.toMatch(/module closed/i);
  });
});
