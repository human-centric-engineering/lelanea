/**
 * `GET /api/v1/app/notes?q=&group=&sort=` — the query surface, end to end
 * through the REAL store (f-slots t-79).
 *
 * `route.test.ts` next door fakes the store to test the envelope and whose id
 * reaches it. That cannot prove the guarantee this task turns on: that a search
 * or a filter never reaches a hidden slot, and never matches words the page
 * says were not kept. Those are properties of `getNotes()` and `queryNotes()`
 * together, so here the route runs over the Prisma fake the store's own tests
 * use, with Daybreak's value engine running for real on top of it.
 *
 * Each "returns nothing" is asserted over a population where the matching
 * value exists, beside an open note matching the same term that IS returned.
 *
 * @see app/api/v1/app/notes/route.ts
 * @see lib/app/slots/notes-query.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser } from '@/tests/helpers/auth';
import { definition, ME, resetWorld, value, world } from '@/tests/unit/lib/app/slots/notes-fake';

const { routeLog } = vi.hoisted(() => ({
  routeLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    // Returns itself, so an entry's fields are read off one spy whatever
    // context the route layers on; the context itself is asserted below.
    withContext: vi.fn(function (this: unknown) {
      return this;
    }),
  },
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/api/context', () => ({ getRouteLogger: () => Promise.resolve(routeLog) }));
vi.mock('@/lib/db/client', async () => ({
  prisma: (await import('@/tests/unit/lib/app/slots/notes-fake')).prismaFake,
}));

const { auth } = await import('@/lib/auth/config');
const { GET } = await import('@/app/api/v1/app/notes/route');

interface Body {
  success: boolean;
  data: {
    notes: { slotSlug: string; value: string; reasoningNote: string }[];
    groups: { key: string; count: number }[];
    own: number;
    total: number;
    matched: number;
  };
}

async function read(query: string): Promise<{ status: number; body: Body; raw: string }> {
  const response = await GET(new NextRequest(`https://lelanea.com/api/v1/app/notes${query}`));
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw) as Body, raw };
}

const slugs = (body: Body) => body.data.notes.map((note) => note.slotSlug);

beforeEach(() => {
  vi.clearAllMocks();
  resetWorld();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));

  world.projections = [
    definition('life_work'),
    definition('development_stage', { group: 'development', visibility: 'hidden' }),
    definition('life_physical_health', { sensitivity: 'special_category' }),
  ];
  world.ours = [
    { slug: 'life_work', visibility: 'open' },
    { slug: 'development_stage', visibility: 'hidden' },
    { slug: 'life_physical_health', visibility: 'open', sensitivity: 'special_category' },
  ];
  world.values = [
    // An open note and a hidden one sharing a word: "ladder".
    value(ME, 'life_work', {
      value: 'Climbing the ladder at work, and tired of it.',
      reasoningNote: 'Said the migraines come from work.',
    }),
    value(ME, 'development_stage', { value: 'Stage two on the ladder of development.' }),
    // An Art. 9 note: a sentinel for a value, and an UNMASKED reasoning note
    // holding the same word the open note's reasoning does (t-80).
    value(ME, 'life_physical_health', {
      value: '<redacted: special_category>',
      reasoningNote: 'Mentioned the migraines twice.',
    }),
  ];
});

describe('a search never reaches a hidden slot', () => {
  it('returns the open note matching the term, and not the hidden one holding it too', async () => {
    const { status, body, raw } = await read('?q=ladder');

    expect(status).toBe(200);
    expect(slugs(body)).toEqual(['life_work']);
    expect(raw).not.toContain('Stage two');
    expect(raw).not.toContain('development');
  });

  it('answers a search only the hidden slot matches with nothing', async () => {
    // Establish the population first: the hidden value is in the store.
    expect(world.values.some((row) => row.value.includes('Stage two'))).toBe(true);

    const { body } = await read('?q=stage%20two');

    expect(body.data.matched).toBe(0);
    expect(body.data.notes).toEqual([]);
    // And the total says nothing about it either: two notes, not three.
    expect(body.data.total).toBe(2);
  });
});

describe('a group filter never reaches a hidden group', () => {
  it('names the hidden group and gets the same response as a group that does not exist', async () => {
    const hidden = await read('?group=development');
    const absent = await read('?group=no_such_group');

    expect(hidden.status).toBe(200);
    expect(hidden.body.data.matched).toBe(0);
    expect(hidden.raw).not.toContain('Stage two');
    // Byte for byte: answering differently would disclose that it exists.
    expect(hidden.raw).toBe(absent.raw);
  });

  it('keeps an open group, as the population behind the absence above', async () => {
    const { body } = await read('?group=life_areas');
    expect(slugs(body)).toEqual(expect.arrayContaining(['life_work', 'life_physical_health']));
    expect(body.data.groups.map((group) => group.key)).not.toContain('development');
  });
});

describe('a search never matches words an Art. 9 note says were not kept', () => {
  it('does not match its reasoning, while a standard note with the same word is found', async () => {
    const { body } = await read('?q=migraines');

    expect(slugs(body)).toEqual(['life_work']);
  });

  it('does not match its stored sentinel', async () => {
    const { body } = await read('?q=redacted');
    expect(body.data.matched).toBe(0);
    // Its wording still finds it.
    const byWording = await read('?q=physical%20health');
    expect(slugs(byWording.body)).toEqual(['life_physical_health']);
  });
});

describe('the query string', () => {
  it('refuses a malformed group or sort with a 400, before any read', async () => {
    expect((await read('?group=Not%20A%20Key')).status).toBe(400);
    expect((await read('?sort=oldest')).status).toBe(400);
    expect((await read(`?q=${'x'.repeat(201)}`)).status).toBe(400);
  });

  it('logs that a search and a filter were on, and never what was searched for', async () => {
    await read('?q=ladder&group=life_areas&sort=recent');

    const [, fields] = routeLog.info.mock.calls[0] as [string, Record<string, unknown>];
    expect(fields).toMatchObject({
      userId: ME,
      matched: 1,
      searched: true,
      filtered: true,
      sort: 'recent',
    });
    expect(JSON.stringify(fields)).not.toContain('ladder');
  });

  it('overrides the request url the route logger carries, so the query never reaches a log', async () => {
    // `getRouteLogger` puts `url: request.url` — query string included — on
    // every entry's context. The payload above being clean is not enough on
    // its own; `/security-review` found the search travelling this way.
    await read('?q=ladder&group=life_areas');

    expect(routeLog.withContext).toHaveBeenCalledWith({
      url: 'https://lelanea.com/api/v1/app/notes',
    });
    const contexts = JSON.stringify(routeLog.withContext.mock.calls);
    expect(contexts).not.toContain('ladder');
    expect(contexts).not.toContain('?');
  });
});
