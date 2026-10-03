/**
 * The browser's side of the agent's notes — the paths the panel test cannot reach
 * (f-slots t-73).
 *
 * `notes-panel.test.tsx` drives this module through a real component against a
 * well-behaved fake server, which is the right test for the happy path and for
 * a refusal the panel prints. What it cannot produce is a server that answers
 * **200 with the wrong shape**, or a refusal that is not JSON at all — and
 * those are the two branches that decide whether a contract change surfaces as
 * a sentence or as a `TypeError` halfway through a render.
 *
 * `noteSourceWords`' fallback is here for the same reason: `sourceType` is a
 * free-form column (the framework's X1 convention), so a value added upstream
 * arrives before this build's table knows it. Nothing in the panel test can
 * produce one, because its fixtures only use values this build already has.
 *
 * @see lib/app/slots/notes-client.ts
 * @see lib/app/slots/notes-view.ts
 */

import { describe, it, expect, vi } from 'vitest';

import { correctNote, fetchNotes, NotesRefused, removeNote } from '@/lib/app/slots/notes-client';
import { noteGroupTitle, noteSourceWords, NOTE_SOURCES } from '@/lib/app/slots/notes-view';
import { REMOVED_SOURCE_TYPE } from '@/lib/app/slots/removed';
import { SLOT_SOURCE_TYPE } from '@/lib/framework/data-slots/vocabulary';

/** A `fetch` that answers exactly this, whatever it is asked. */
function answering(body: string, init: ResponseInit = { status: 200 }): typeof fetch {
  return vi.fn(async () => new Response(body, init));
}

describe('a server that answers the wrong shape', () => {
  it('reads the whole page as unreadable rather than handing back half of it', async () => {
    // A note missing `confidence`. The panel renders every field of every
    // note, so a partial parse would put `undefined` through the certainty
    // bar — and on the one surface whose promise is that it shows the whole
    // picture, a partial picture is worse than a sentence saying it could not
    // be read.
    const body = JSON.stringify({
      success: true,
      data: {
        notes: [{ slotSlug: 'life_work', group: 'life_areas' }],
        groups: [{ key: 'life_areas', title: 'Life areas', count: 1 }],
        own: 0,
        total: 1,
        matched: 1,
      },
    });

    await expect(fetchNotes({ fetchImpl: answering(body) })).rejects.toThrow(/could not be read/i);
    await expect(fetchNotes({ fetchImpl: answering(body) })).rejects.toMatchObject({
      name: 'NotesRefused',
      code: 'malformed',
    });
  });

  it('does not confirm a correction it cannot read the answer to', async () => {
    // `version` missing. Answering anyway would tell the panel to re-read on
    // the strength of a write it has no evidence happened.
    const body = JSON.stringify({ success: true, data: { slotSlug: 'life_work' } });

    await expect(
      correctNote({ slotSlug: 'life_work', value: 'x' }, { fetchImpl: answering(body) })
    ).rejects.toMatchObject({ code: 'malformed' });
  });

  it('rejects a note missing `removed` or `removable` (t-78 widened the contract)', async () => {
    // A server still on the pre-removal contract — every other field present,
    // but the two t-78 added are not. The schema has to know about them, or a
    // card would render with `note.removed` and `note.removable` as
    // `undefined`, which is falsy for `removable` (hiding the control
    // silently) and falsy-but-wrong for `removed` (never the placeholder).
    const fullNote: Record<string, unknown> = {
      slotSlug: 'life_work',
      asking: null,
      value: 'Work is going badly.',
      withheld: false,
      removed: false,
      confidence: 8,
      sourceType: 'direct',
      reasoningNote: 'Said plainly.',
      version: 1,
      capturedAt: '2026-09-21T09:15:00.000Z',
      conversationId: null,
      sensitivity: 'standard',
      retired: false,
      correctable: true,
      removable: true,
      previous: null,
      group: 'life_areas',
    };
    const envelopeWith = (note: Record<string, unknown>) =>
      JSON.stringify({
        success: true,
        data: { notes: [note], groups: [], own: 0, total: 1, matched: 1 },
      });

    const { removed: _removed, ...withoutRemoved } = fullNote;
    await expect(
      fetchNotes({ fetchImpl: answering(envelopeWith(withoutRemoved)) })
    ).rejects.toMatchObject({ code: 'malformed' });

    const { removable: _removable, ...withoutRemovable } = fullNote;
    await expect(
      fetchNotes({ fetchImpl: answering(envelopeWith(withoutRemovable)) })
    ).rejects.toMatchObject({ code: 'malformed' });
  });
});

describe('what it asks for', () => {
  const empty = JSON.stringify({
    success: true,
    data: { notes: [], groups: [], own: 0, total: 0, matched: 0 },
  });

  it('sends the search, the group and the sort, and leaves the defaults out', async () => {
    const fetchImpl = answering(empty);
    await fetchNotes({ fetchImpl, query: { q: ' brother ', group: '_own', sort: 'recent' } });
    await fetchNotes({ fetchImpl, query: { sort: 'grouped' } });

    // The client always passes a string; anything else fails the comparison.
    const urls = vi
      .mocked(fetchImpl)
      .mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
    expect(urls).toEqual([
      '/api/v1/app/notes?q=brother&group=_own&sort=recent',
      // `grouped` is the default, so the plain page is the plain URL.
      '/api/v1/app/notes',
    ]);
  });
});

describe('removing a note (t-78)', () => {
  it('sends a DELETE with the slug as the body, with credentials, and returns the version count', async () => {
    const fetchImpl = answering(JSON.stringify({ success: true, data: { versions: 3 } }));

    const result = await removeNote('life_work', { fetchImpl });

    expect(result).toEqual({ versions: 3 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(url).toBe('/api/v1/app/notes');
    expect(init?.method).toBe('DELETE');
    expect(init?.credentials).toBe('include');
    expect(JSON.parse(init?.body as string)).toEqual({ slotSlug: 'life_work' });
  });

  it('throws a `NotesRefused` carrying the route’s message and code on a refusal', async () => {
    const body = JSON.stringify({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'There is no note under that heading to remove.',
        details: { reason: 'already_removed' },
      },
    });

    const failed = removeNote('life_work', { fetchImpl: answering(body, { status: 409 }) });

    await expect(failed).rejects.toBeInstanceOf(Error);
    await expect(failed).rejects.toMatchObject({
      name: 'NotesRefused',
      status: 409,
      code: 'already_removed',
      message: 'There is no note under that heading to remove.',
    });
  });

  it('throws a `NotesRefused` with code "malformed" on a 200 it cannot read the answer from', async () => {
    // `versions` missing from an otherwise-`success` body. Treating this as a
    // success would tell the panel the removal landed on the strength of a
    // response it could not actually confirm.
    const body = JSON.stringify({ success: true, data: {} });

    await expect(removeNote('life_work', { fetchImpl: answering(body) })).rejects.toMatchObject({
      name: 'NotesRefused',
      code: 'malformed',
    });
  });
});

describe('a refusal that is not the envelope', () => {
  it('keeps the status when the body is not JSON at all', async () => {
    // A proxy's HTML error page, or an empty body from the edge. There is no
    // `error.code` to read, so the status is all there is — and losing it
    // would leave the panel unable to tell a 500 from a 403.
    const failed = fetchNotes({
      fetchImpl: answering('<html>gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    });

    await expect(failed).rejects.toMatchObject({ status: 502, code: 'http_502' });
  });

  it('prefers `details.reason` over the envelope code, because the reason is specific', async () => {
    const body = JSON.stringify({
      success: false,
      error: {
        code: 'CONFLICT',
        message: 'Ask Lelañea about it instead.',
        details: { reason: 'kept_out_of_the_record' },
      },
    });

    const failed = correctNote(
      { slotSlug: 'life_physical_health', value: 'x' },
      { fetchImpl: answering(body, { status: 409 }) }
    );

    // Both 409s this route answers share a code and differ only in `reason`,
    // so the reason is the thing a caller can branch on.
    await expect(failed).rejects.toMatchObject({
      code: 'kept_out_of_the_record',
      message: 'Ask Lelañea about it instead.',
    });
  });

  it('falls back to the envelope code when there is no reason', async () => {
    const body = JSON.stringify({
      success: false,
      error: { code: 'NOT_FOUND', message: 'There is no note under that heading to correct.' },
    });

    await expect(
      correctNote({ slotSlug: 'nope', value: 'x' }, { fetchImpl: answering(body, { status: 404 }) })
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });

  it('is a `NotesRefused`, so a caller can tell a refusal from a network failure', async () => {
    const thrown = await fetchNotes({
      fetchImpl: answering('', { status: 403 }),
    }).catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(NotesRefused);
    expect(thrown).toBeInstanceOf(Error);
  });
});

describe('putting a stored classifier into words', () => {
  it('knows every source type the framework ships', () => {
    // The table is the one thing standing between a stored classifier and a
    // sentence somebody reads about themselves; a value dropping out of it
    // would degrade silently to the fallback below.
    expect(noteSourceWords('inferred')).toBe('Lelañea inferred it');
    expect(noteSourceWords('user_confirmed')).toBe('You corrected this yourself');
    // Every classifier the framework ships, plus the one this app writes when a
    // person removes a note (t-78) — and nothing else.
    expect(Object.keys(NOTE_SOURCES).sort()).toEqual(
      [...Object.values(SLOT_SOURCE_TYPE), REMOVED_SOURCE_TYPE].sort()
    );
  });

  it('names a removed version as the person’s own act', () => {
    expect(noteSourceWords(REMOVED_SOURCE_TYPE)).toBe('You removed this');
  });

  it('reads an unknown one as itself, capitalised, rather than as a shrug', () => {
    // `sourceType` is a free-form column, so a value Daybreak adds arrives here
    // before this table does. "Recalled across sessions" is more honest to a
    // member than "unknown", and capitalising it keeps the meta line's three
    // fragments looking like three facts rather than one broken sentence.
    expect(noteSourceWords('recalled_across_sessions')).toBe('Recalled across sessions');
    expect(noteSourceWords('x')).toBe('X');
  });

  it('leaves an empty classifier empty rather than throwing on it', () => {
    // A stored empty string is a corrupt row, not a crash: the card still
    // renders and the rest of the note is still readable.
    expect(noteSourceWords('')).toBe('');
  });
});

describe('putting a group key into a heading', () => {
  it('reproduces the taxonomy’s own titles from the key alone', () => {
    // Which is why there is no second list of titles to keep in step — see
    // `.context/app/slots.md`, "Group headings are derived".
    expect(noteGroupTitle('life_areas')).toBe('Life areas');
    expect(noteGroupTitle('the_person')).toBe('The person');
    expect(noteGroupTitle('module_output')).toBe('Module output');
  });

  it('handles a single-word key and an empty one without special-casing', () => {
    expect(noteGroupTitle('preferences')).toBe('Preferences');
    expect(noteGroupTitle('')).toBe('');
  });
});
