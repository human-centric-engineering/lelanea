/**
 * Unit Tests: GET /api/v1/app/content/resources and /resources/:key
 *
 * The library and the selection. Covers the 200 payloads, the 304, the 401 an
 * anonymous caller must get, the 404 for a key that is nothing, the 400 for a
 * key or a pin that is not even a slug, the `?pin=` pin, and the private
 * cache directive that keeps a shared cache out of a session-gated payload.
 *
 * The library is rows since t-87. The stores are faked with exactly the rows
 * the seeds write from the real files, so the selection assertions are on what
 * ships: her words on values, and no films yet. The selection rule itself is
 * covered on fixtures in `tests/unit/lib/app/content/resources.test.ts`.
 *
 * @see app/api/v1/app/content/resources/route.ts
 * @see app/api/v1/app/content/resources/[key]/route.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { mockAuthenticatedUser } from '@/tests/helpers/auth';

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/content/journey-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeJourneyStore()
);
vi.mock('@/lib/app/content/resource-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeResourceStore()
);

import { auth } from '@/lib/auth/config';
import { GET as getLibrary } from '@/app/api/v1/app/content/resources/route';
import { GET as getSelection } from '@/app/api/v1/app/content/resources/[key]/route';
import { fakeJourneyStore, fakeResourceStore, filmRow } from '@/tests/helpers/app/content-stores';

const journey = fakeJourneyStore();
const resources = fakeResourceStore();

interface Collection {
  id: string;
  version: string;
  provenance: { status: string; awaitingSignOffFrom: string };
}

interface LibraryBody {
  success: true;
  data: {
    collection: Collection;
    films: { id: string }[];
    readings: { id: string }[];
    words: Record<string, { quote: string; paragraphs: string[]; source: { id: string } }>;
  };
}

interface SelectionBody {
  success: true;
  data: {
    collection: Collection;
    key: string;
    title: string;
    tier: string | null;
    words: { quote: string; paragraphs: string[] };
    wordsAreOwn: boolean;
    films: { id: string }[];
    readings: { id: string }[];
  };
}

interface ErrorBody {
  success: false;
  error: { code: string; message: string; details?: Record<string, unknown> };
}

function libraryRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://lelanea.com/api/v1/app/content/resources', { headers });
}

function selectionRequest(key: string, query = '', headers: Record<string, string> = {}) {
  return {
    request: new NextRequest(`https://lelanea.com/api/v1/app/content/resources/${key}${query}`, {
      headers,
    }),
    context: { params: Promise.resolve({ key }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  journey.reset();
  resources.reset();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
});

describe('GET /api/v1/app/content/resources', () => {
  it("answers a non-admin member 200, not 'made no ownership decision'", async () => {
    // Sunrise 0.12.0: `withAuth` refuses (500) any route that made no
    // ownership decision for a caller the default policy narrows. A plain USER
    // and a route that declares `'nothing'`: published content, no per-user rows.
    const response = await getLibrary(libraryRequest());
    const body = (await response.json()) as LibraryBody & { error?: unknown };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.error).toBeUndefined();
  });

  it('serves the library with its provenance, and no film yet', async () => {
    const body = (await (await getLibrary(libraryRequest())).json()) as LibraryBody;

    expect(body.data.collection.id).toBe('lelanea_resources');
    expect(body.data.collection.provenance.status).toBe('draft');
    expect(body.data.films).toEqual([]);
    expect(body.data.readings).toEqual([]);
    expect(body.data.words.module_01_values.source.id).toBe('lesson_centered_living');
  });

  it('withholds the working notes', async () => {
    const body = (await (await getLibrary(libraryRequest())).json()) as LibraryBody & {
      data: Record<string, unknown>;
    };

    expect(body.data).not.toHaveProperty('notes');
    expect(body.data.collection).not.toHaveProperty('notes');
  });

  it('answers 401 for an anonymous caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    const response = await getLibrary(libraryRequest());
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('answers 304 when the client already has this version', async () => {
    const etag = (await getLibrary(libraryRequest())).headers.get('ETag')!;

    const response = await getLibrary(libraryRequest({ 'If-None-Match': etag }));

    expect(response.status).toBe(304);
    expect(await response.text()).toBe('');
  });

  it('stays private — a shared cache has no business holding it', async () => {
    const response = await getLibrary(libraryRequest());

    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
  });
});

describe('GET /api/v1/app/content/resources/:key', () => {
  it('answers Values with her words on values, the module title and its arc', async () => {
    const { request, context } = selectionRequest('values');

    const response = await getSelection(request, context);
    const body = (await response.json()) as SelectionBody;

    expect(response.status).toBe(200);
    expect(body.data.key).toBe('values');
    expect(body.data.title).toBe('Values');
    expect(body.data.tier).toBe('foundations');
    expect(body.data.wordsAreOwn).toBe(true);
    expect(body.data.words.quote).toBe(
      "If you don't shape your values, the world will shape them for you."
    );
    expect(body.data.films).toEqual([]);
    expect(body.data.readings).toEqual([]);
    expect(body.data.collection.provenance.status).toBe('draft');
  });

  it('answers a module with no words of its own with the default, and says so', async () => {
    const { request, context } = selectionRequest('boundaries');

    const body = (await (await getSelection(request, context)).json()) as SelectionBody;

    expect(body.data.title).toBe('Boundaries');
    expect(body.data.wordsAreOwn).toBe(false);
    expect(body.data.words.quote).toBe('Whatever it is that brought you here, you listened.');
  });

  it('answers the three fixed keys', async () => {
    for (const [key, title] of [
      ['journey', 'The journey'],
      ['situations', 'Life situations'],
      ['default', 'Lelañea'],
    ] as const) {
      const { request, context } = selectionRequest(key);
      const response = await getSelection(request, context);
      const body = (await response.json()) as SelectionBody;

      expect(response.status).toBe(200);
      expect(body.data.title).toBe(title);
      expect(body.data.tier).toBeNull();
    }
  });

  it('answers 404 for a key that is nothing — not the default', async () => {
    const { request, context } = selectionRequest('no-such-module');

    const response = await getSelection(request, context);
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it("answers 404 for the file's own id form — the shell sends slugs", async () => {
    // `module_01_values` is not a slug (underscores), so it is refused before
    // lookup; that is a 400 rather than a 404 and either is "not that".
    const { request, context } = selectionRequest('module_01_values');

    const response = await getSelection(request, context);

    expect([400, 404]).toContain(response.status);
  });

  it('answers 400 for a key that is not a slug, naming the field', async () => {
    const { request, context } = selectionRequest('Values%20Module');

    const response = await getSelection(request, context);
    const body = (await response.json()) as ErrorBody;

    expect(response.status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toHaveProperty('key');
  });

  it('accepts a ?pin= and refuses one that is not an id', async () => {
    // Nothing to pin yet, so the pin is a no-op on the shipped file — but it
    // must be accepted, because t-77 sends it.
    const ok = selectionRequest('values', '?pin=on-stalling');
    expect((await getSelection(ok.request, ok.context)).status).toBe(200);

    const bad = selectionRequest('values', '?pin=not%20an%20id');
    const response = await getSelection(bad.request, bad.context);
    expect(response.status).toBe(400);
  });

  it('answers 401 for an anonymous caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const { request, context } = selectionRequest('values');

    const response = await getSelection(request, context);

    expect(response.status).toBe(401);
  });

  it('answers 304 for the same key, and a fresh body for a different one', async () => {
    const first = selectionRequest('values');
    const etag = (await getSelection(first.request, first.context)).headers.get('ETag')!;

    const same = selectionRequest('values', '', { 'If-None-Match': etag });
    expect((await getSelection(same.request, same.context)).status).toBe(304);

    const other = selectionRequest('boundaries', '', { 'If-None-Match': etag });
    expect((await getSelection(other.request, other.context)).status).toBe(200);
  });

  it('stays private', async () => {
    const { request, context } = selectionRequest('values');

    const response = await getSelection(request, context);

    expect(response.headers.get('Cache-Control')).toBe('private, no-cache');
  });
});

describe('the rows are what is served (t-87)', () => {
  it('serves a film an admin added, from the row', async () => {
    resources.addResource(filmRow('the-quiet', { relatesTo: 'module_01_values' }));

    const library = (await (await getLibrary(libraryRequest())).json()) as LibraryBody;
    const { request, context } = selectionRequest('values');
    const selection = (await (await getSelection(request, context)).json()) as SelectionBody;

    expect(library.data.films.map((film) => film.id)).toEqual(['the-quiet']);
    expect(selection.data.films.map((film) => film.id)).toEqual(['the-quiet']);
  });

  it('names the drawer from the module row, so an edited title reaches it', async () => {
    journey.editModule('module_01_values', { title: 'Values, edited' });
    const { request, context } = selectionRequest('values');

    const body = (await (await getSelection(request, context)).json()) as SelectionBody;

    expect(body.data.title).toBe('Values, edited');
  });

  it('answers 500 when the library was never seeded', async () => {
    resources.empty();

    expect((await getLibrary(libraryRequest())).status).toBe(500);
  });
});
