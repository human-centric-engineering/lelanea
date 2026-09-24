// @vitest-environment happy-dom

/**
 * The content editor's requests (f-content-seeds t-91): `send()`, `errorMessage()`,
 * `downloadExport()` and `orNull()`.
 *
 * `downloadExport` touches `window.document` and `URL.createObjectURL`, so this
 * file needs a DOM even though it exercises no component — the same reason
 * `tests/unit/components/app/account/export-data-row.test.tsx` opts in.
 *
 * @see components/app/admin/content/client.ts
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { downloadExport, errorMessage, orNull, send } from '@/components/app/admin/content/client';

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(status: number, message: string, details?: unknown) {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'CONFLICT', message, details } }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('send', () => {
  it('sends a JSON body with a Content-Type header, and returns the parsed data on success', async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: '1' }));

    const result = await send<{ id: string }>('PUT', '/api/v1/x', { a: 1 });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/x', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    });
    expect(result).toEqual({ ok: true, data: { id: '1' } });
  });

  it('sends no body and no Content-Type header when called with no body', async () => {
    fetchMock.mockResolvedValueOnce(ok({ revisions: [] }));

    await send('GET', '/api/v1/y');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/y', {
      method: 'GET',
      credentials: 'same-origin',
      headers: undefined,
      body: undefined,
    });
  });

  it('turns a route refusal into ok:false, carrying the message and details through', async () => {
    fetchMock.mockResolvedValueOnce(
      refused(409, 'stale', { reason: 'revision_moved', currentRevision: 5 })
    );

    const result = await send('PUT', '/x', {});

    expect(result).toEqual({
      ok: false,
      message: 'stale',
      details: { reason: 'revision_moved', currentRevision: 5 },
    });
  });

  it('reports a network failure distinctly from a route refusal, without throwing', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await send('POST', '/x');

    expect(result).toEqual({
      ok: false,
      message: 'The request did not reach the server. Nothing was changed.',
    });
  });

  it('reports the same generic failure when the response body cannot be parsed as an envelope', async () => {
    // Not `refused()` — a body that isn't even shaped like an APIResponse, which
    // makes `parseApiResponse` throw. `send` must not let that escape uncaught.
    fetchMock.mockResolvedValueOnce(
      new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } })
    );

    const result = await send('GET', '/x');

    expect(result).toEqual({
      ok: false,
      message: 'The request did not reach the server. Nothing was changed.',
    });
  });
});

describe('errorMessage', () => {
  it('returns the bare message when there are no details', () => {
    expect(errorMessage({ message: 'Boom' })).toBe('Boom');
  });

  it('joins every refusal line when details carries an array of strings', () => {
    expect(errorMessage({ message: 'x', details: { refusals: ['A.', 'B.'] } })).toBe('A. B.');
  });

  it('filters non-string entries out of refusals rather than stringifying them', () => {
    expect(errorMessage({ message: 'x', details: { refusals: ['A.', 42, null, 'B.'] } })).toBe(
      'A. B.'
    );
  });

  it('prefixes a Zod field error with its path', () => {
    expect(
      errorMessage({
        message: 'Validation failed',
        details: { errors: [{ path: 'title', message: 'Required' }] },
      })
    ).toBe('title — Required');
  });

  it('leaves a pathless refinement error exactly as written, with no dash prefix', () => {
    expect(
      errorMessage({
        message: 'Validation failed',
        details: { errors: [{ path: '', message: 'Every slot must name a group.' }] },
      })
    ).toBe('Every slot must name a group.');
  });

  it('leaves an error with no path key at all unprefixed, same as an empty path', () => {
    expect(
      errorMessage({
        message: 'Validation failed',
        details: { errors: [{ message: 'Something is wrong.' }] },
      })
    ).toBe('Something is wrong.');
  });

  it('falls back to the top-line message when the first error has no message field', () => {
    expect(
      errorMessage({
        message: 'Validation failed',
        details: { errors: [{ path: 'x' }] },
      })
    ).toBe('Validation failed');
  });

  it('falls back to the top-line message when details is not an object', () => {
    expect(errorMessage({ message: 'Boom', details: 'oops' })).toBe('Boom');
  });

  it('falls back to the top-line message when details has neither refusals nor errors', () => {
    expect(errorMessage({ message: 'Boom', details: { reason: 'has_readers' } })).toBe('Boom');
  });

  it('falls back to the top-line message when the errors array is empty', () => {
    expect(errorMessage({ message: 'Boom', details: { errors: [] } })).toBe('Boom');
  });
});

describe('downloadExport', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;
  let clicked: HTMLAnchorElement[];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    clicked = [];
    createObjectURL = vi.fn(() => 'blob:lelanea/content');
    revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clicked.push(this);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('downloads under the server-given filename, and revokes the blob URL after a minute, not sooner', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"documents":[]}', {
        status: 200,
        headers: {
          'content-disposition': 'attachment; filename="lelanea_foundational_documents.json"',
        },
      })
    );

    const result = await downloadExport('/api/v1/x/export', 'fallback.json');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/x/export', { credentials: 'same-origin' });
    expect(result).toEqual({ ok: true, data: null });
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('lelanea_foundational_documents.json');
    expect(clicked[0].href).toBe('blob:lelanea/content');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:lelanea/content');
  });

  it('falls back to the given name when there is no Content-Disposition header', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 200 }));

    await downloadExport('/x', 'fallback.json');

    expect(clicked[0].download).toBe('fallback.json');
  });

  it('reports the route refusal instead of downloading the error envelope', async () => {
    fetchMock.mockResolvedValueOnce(refused(409, 'Cannot export: unexportable rows.'));

    const result = await downloadExport('/x', 'fallback.json');

    expect(result).toEqual({ ok: false, message: 'Cannot export: unexportable rows.' });
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(clicked).toHaveLength(0);
  });

  it('reports a generic failure for a non-ok response whose body still parses as success', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: null }), { status: 500 })
    );

    const result = await downloadExport('/x', 'fallback.json');

    expect(result).toEqual({ ok: false, message: 'The export failed.' });
  });

  it('reports a network failure distinctly, without downloading anything', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await downloadExport('/x', 'fallback.json');

    expect(result).toEqual({
      ok: false,
      message: 'The export did not reach the server. Nothing was downloaded.',
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('orNull', () => {
  it('turns whitespace-only text into null', () => {
    expect(orNull('   ')).toBeNull();
  });

  it('turns an empty string into null', () => {
    expect(orNull('')).toBeNull();
  });

  it('leaves real text alone, untrimmed', () => {
    expect(orNull('  hi  ')).toBe('  hi  ');
  });
});
