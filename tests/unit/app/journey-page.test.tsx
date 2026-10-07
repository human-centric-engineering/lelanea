// @vitest-environment happy-dom

/**
 * The journey page: what it asks the record and the map for, and that it
 * still guards its own session the way `notes/page.tsx` does
 * (f-journey-record t-148).
 *
 * `JourneyTimeline` is stubbed — what it draws from a record is
 * `tests/unit/components/app/journey/journey-timeline.test.tsx`'s job. This
 * file is about the page around it: the query it reads from the URL, the
 * exact call it makes to `getJourneyRecord`, and that a map read failing does
 * not cost the record.
 *
 * @see app/(lelanea)/app/journey/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getServerSession = vi.hoisted(() => vi.fn());
const clearInvalidSession = vi.hoisted(() =>
  vi.fn(() => {
    // The real one redirects, which throws. A mock that simply returned would
    // let the page fall through and render as though the reader were signed
    // in — passing for the wrong reason on the one assertion that matters.
    throw new Error('NEXT_REDIRECT');
  })
);
const getJourneyRecord = vi.hoisted(() => vi.fn());
const getJourneyMap = vi.hoisted(() => vi.fn());
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));
vi.mock('@/lib/app/journey-record/record', () => ({ getJourneyRecord }));
vi.mock('@/lib/app/journey/map', () => ({ getJourneyMap }));
vi.mock('@/lib/logging', () => ({
  logger: { warn, info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/components/app/journey/journey-timeline', async (importOriginal) => {
  // Keep JOURNEY_LEDE real — the page quotes it, and a stub that invented a
  // string would let the two drift apart while this test went on passing.
  const actual = await importOriginal<typeof import('@/components/app/journey/journey-timeline')>();
  return {
    JOURNEY_LEDE: actual.JOURNEY_LEDE,
    JourneyTimeline: (props: { record: { total: number } }) => (
      <div data-testid="timeline" data-total={props.record.total} />
    ),
  };
});

import JourneyPage, { metadata } from '@/app/(lelanea)/app/journey/page';
import { JOURNEY_LEDE } from '@/components/app/journey/journey-timeline';

const SESSION = { user: { id: 'cmuser00000000000000000000', name: 'Maya Reyes' } };

function emptyRecord() {
  return {
    entries: [],
    matched: 0,
    total: 0,
    drafts: 0,
    totals: { synopses: 0, own: 0, outcomes: { action: 0, insight: 0, tension: 0 } },
    modules: [],
    notes: [],
  };
}

function searchParams(params: Record<string, string | string[] | undefined> = {}) {
  return Promise.resolve(params);
}

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue(SESSION);
  getJourneyRecord.mockResolvedValue(emptyRecord());
  getJourneyMap.mockResolvedValue(null);
});

describe('without a session', () => {
  it('clears the cookie and sends the reader back, rather than rendering', async () => {
    getServerSession.mockResolvedValue(null);

    await expect(JourneyPage({ searchParams: searchParams() })).rejects.toThrow('NEXT_REDIRECT');
    expect(clearInvalidSession).toHaveBeenCalledWith('/app/journey');
    expect(getJourneyRecord).not.toHaveBeenCalled();
  });
});

describe('the query it asks the record for', () => {
  it('always asks with drafts: true, whatever the URL says', async () => {
    render(await JourneyPage({ searchParams: searchParams({ q: 'brother', module: 'values' }) }));

    expect(getJourneyRecord).toHaveBeenCalledTimes(1);
    expect(getJourneyRecord).toHaveBeenCalledWith(SESSION.user.id, {
      q: 'brother',
      module: 'values',
      drafts: true,
    });
  });

  it('falls back to the bare drafts-only query when a param fails the schema', async () => {
    // A module slug schema refuses anything starting with an underscore; a
    // stale bookmark or a hand-typed URL should still open the whole record
    // rather than a thrown validation error.
    render(await JourneyPage({ searchParams: searchParams({ module: '_not-a-slug' }) }));

    expect(getJourneyRecord).toHaveBeenCalledWith(SESSION.user.id, { drafts: true });
  });

  it('takes the first value when a param repeats, as an array from a duplicated query key', async () => {
    render(await JourneyPage({ searchParams: searchParams({ kind: ['own', 'synopsis'] }) }));

    expect(getJourneyRecord).toHaveBeenCalledWith(SESSION.user.id, {
      kind: 'own',
      drafts: true,
    });
  });

  it('asks with the bare drafts-only query when nothing at all is given', async () => {
    render(await JourneyPage({ searchParams: searchParams() }));

    expect(getJourneyRecord).toHaveBeenCalledWith(SESSION.user.id, { drafts: true });
  });
});

describe('when the map read fails', () => {
  it('still renders the record, with no signpost and module slugs for labels', async () => {
    getJourneyMap.mockRejectedValue(new Error('facilitation graph unreadable'));
    getJourneyRecord.mockResolvedValue({ ...emptyRecord(), total: 3 });

    render(await JourneyPage({ searchParams: searchParams() }));

    const timeline = screen.getByTestId('timeline');
    expect(timeline.dataset.total).toBe('3');
    expect(warn).toHaveBeenCalledWith(
      'Journey map unreadable on the journey view',
      expect.objectContaining({ error: 'facilitation graph unreadable' })
    );
  });
});

describe('the page around the timeline', () => {
  it('renders under a head naming the view, with the shared lede', async () => {
    render(await JourneyPage({ searchParams: searchParams() }));

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Where you have been');
    expect(screen.getByText(JOURNEY_LEDE)).toBeTruthy();
    expect(screen.getByTestId('timeline')).toBeTruthy();
  });

  it('names itself in the tab', () => {
    expect(metadata.title).toBe('Your journey');
  });
});
