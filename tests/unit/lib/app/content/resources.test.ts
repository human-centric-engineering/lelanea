/**
 * Unit Tests: the resources — her films and reading, and her words on
 * whatever is open (f-resources t-74).
 *
 * Three jobs, and the middle one is the load-bearing one:
 *
 * 1. The real file parses, ships as a draft, and says so.
 * 2. **Every passage is verbatim.** The drawer's eyebrow says these are her
 *    words, so each `words` entry cites a source this repository holds and the
 *    text must occur in it character for character. A one-character edit —
 *    a tidied comma, a straightened quote — fails here. Established on a
 *    non-empty set first, so the assertion cannot pass on nothing (fp6).
 * 3. The schema's referential checks, and the selection rule, on fixtures.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The keys and passages in section 1 are Lelañea's content. A fork replacing
 * `content/` should rewrite them against its own file, not delete them; the
 * verbatim check in section 2 is content-independent and should be kept.
 *
 * @see lib/app/content/resources.ts
 */

import { describe, it, expect } from 'vitest';

import {
  getResourcesLibrary,
  selectResourcesFor,
  selectResources,
  buildResourcesFileSchema,
  FILMS_SHOWN,
  READINGS_SHOWN,
  type ResourcesFile,
  type ResourceModuleRef,
} from '@/lib/app/content/resources';
import { getFoundationalDocument, getJourneyStructure } from '@/lib/app/content';
import { getValuesModule } from '@/lib/app/content/values';

// ============================================================================
// 1. The real file
// ============================================================================

describe('the bundled resources', () => {
  it('parses, and is frozen and memoised like the rest of the content', () => {
    const library = getResourcesLibrary();

    expect(library.collection.id).toBe('lelanea_resources');
    expect(library.collection.locale).toBe('en-US');
    expect(Object.isFrozen(library)).toBe(true);
    expect(Object.isFrozen(library.words)).toBe(true);
    expect(getResourcesLibrary()).toBe(library);
  });

  it('ships as a draft awaiting her, and serves that rather than hiding it', () => {
    const { provenance } = getResourcesLibrary().collection;

    expect(provenance.status).toBe('draft');
    expect(provenance.awaitingSignOffFrom).toBe('Lelañea Fulton');
    expect(provenance.note).toMatch(/t-76/);
  });

  it('withholds the working notes about the words', () => {
    expect(getResourcesLibrary()).not.toHaveProperty('notes');
    expect(getResourcesLibrary().collection).not.toHaveProperty('notes');
  });

  it('carries her words on values, and a default for everything else', () => {
    const { words } = getResourcesLibrary();

    expect(Object.keys(words).sort()).toEqual(['default', 'module_01_values']);
    expect(words.module_01_values?.source).toEqual({
      collection: 'values_module',
      id: 'lesson_centered_living',
    });
    expect(words.default?.source).toEqual({
      collection: 'foundational_documents',
      id: 'the_initiation',
    });
  });

  it('invents no film and no reading — her list is t-76', () => {
    // Pinned so that the first entry is a deliberate change to this test, not
    // something that slipped in beside a code change.
    expect(getResourcesLibrary().films).toEqual([]);
    expect(getResourcesLibrary().readings).toEqual([]);
  });
});

// ============================================================================
// 2. Every passage is verbatim
// ============================================================================

/** Every string reachable from a value, in document order. */
function stringLeaves(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const item of value) stringLeaves(item, out);
  else if (value !== null && typeof value === 'object')
    for (const item of Object.values(value)) stringLeaves(item, out);
  return out;
}

/** The text a `words.source` points at, or throws naming what is missing. */
function sourceText(source: { collection: string; id: string }): string[] {
  if (source.collection === 'foundational_documents') {
    const document = getFoundationalDocument(source.id);
    if (!document) throw new Error(`no foundational document "${source.id}"`);
    return stringLeaves(document.blocks);
  }
  if (source.collection === 'values_module') {
    const step = getValuesModule().steps.find((s) => s.id === source.id);
    if (!step) throw new Error(`no Values module step "${source.id}"`);
    return stringLeaves(step);
  }
  throw new Error(`unknown source collection "${source.collection}"`);
}

describe('in her own words means verbatim', () => {
  const entries = Object.entries(getResourcesLibrary().words);

  it('has passages to check', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s: the quote and every paragraph occur in the cited source', (_key, words) => {
    const leaves = sourceText(words.source);
    expect(leaves.length).toBeGreaterThan(0);

    for (const passage of [words.quote, ...words.paragraphs]) {
      const found = leaves.some((leaf) => leaf.includes(passage));
      expect(
        found,
        `not verbatim in ${words.source.collection}/${words.source.id}: "${passage}"`
      ).toBe(true);
    }
  });

  it('would fail on a one-character change', () => {
    const [, words] = entries[0];
    const leaves = sourceText(words.source);
    const altered = words.quote.replace(/\.$/, '') + '!';

    expect(leaves.some((leaf) => leaf.includes(altered))).toBe(false);
  });

  it('cites no passage that carries a merge field', () => {
    // A `{{first_name}}` in the drawer would render literally: the drawer is
    // not the welcome page and substitutes nothing.
    for (const [, words] of entries) {
      for (const passage of [words.quote, ...words.paragraphs]) {
        expect(passage).not.toMatch(/\{\{|\[[^\]]+\]/);
      }
    }
  });
});

// ============================================================================
// 3. The schema and the selection, on fixtures
// ============================================================================

const KNOWN = {
  moduleIds: new Set(['module_01_values', 'module_02_boundaries']),
  documentIds: new Set(['the_mission']),
};

const MODULES: readonly ResourceModuleRef[] = [
  { id: 'module_01_values', title: 'Values', tier: 'foundations' },
  { id: 'module_02_boundaries', title: 'Boundaries', tier: 'foundations' },
];

function fixture(overrides: Partial<ResourcesFile> = {}): ResourcesFile {
  return {
    resources: {
      id: 'lelanea_resources',
      title: 'Fixture',
      version: '0.1',
      locale: 'en-US',
      provenance: { status: 'draft', awaitingSignOffFrom: 'Her', note: 'fixture' },
      notes: [],
    },
    films: [
      film('values-a', 'module_01_values'),
      film('values-b', 'module_01_values'),
      film('values-c', 'module_01_values'),
      film('general-a', null),
      film('boundaries-a', 'module_02_boundaries'),
    ],
    readings: [
      reading('read-values', 'module_01_values'),
      reading('read-general-a', null),
      reading('read-general-b', null),
      reading('read-general-c', null),
      documentReading('read-doc', null, 'the_mission'),
    ],
    words: {
      default: {
        quote: 'Q',
        paragraphs: ['P'],
        source: { collection: 'foundational_documents', id: 'the_mission' },
      },
      module_01_values: {
        quote: 'V',
        paragraphs: ['VP'],
        source: { collection: 'values_module', id: 'lesson_centered_living' },
      },
    },
    ...overrides,
  };
}

function film(id: string, relatesTo: string | null): ResourcesFile['films'][number] {
  return {
    id,
    title: id,
    subtitle: 'for',
    relatesTo,
    duration: '4:20',
    href: 'https://example.com/' + id,
  };
}

function reading(id: string, relatesTo: string | null): ResourcesFile['readings'][number] {
  return {
    id,
    title: id,
    subtitle: 'for',
    relatesTo,
    readingTime: '5 min',
    href: 'https://example.com/' + id,
  };
}

function documentReading(
  id: string,
  relatesTo: string | null,
  documentId: string
): ResourcesFile['readings'][number] {
  return { id, title: id, subtitle: 'for', relatesTo, readingTime: '5 min', documentId };
}

function parse(file: unknown): { ok: boolean; messages: string[] } {
  const result = buildResourcesFileSchema(KNOWN).safeParse(file);
  return {
    ok: result.success,
    messages: result.success ? [] : result.error.issues.map((issue) => issue.message),
  };
}

describe('a malformed file fails, naming the fault', () => {
  it('accepts the fixture', () => {
    expect(parse(fixture())).toEqual({ ok: true, messages: [] });
  });

  it('rejects a film that relates to a module the structure does not have', () => {
    const { ok, messages } = parse(fixture({ films: [film('x', 'module_99_nowhere')] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/film "x" relates to unknown key "module_99_nowhere"/);
  });

  it('rejects a piece that relates to `default` — that is spelled null', () => {
    // `default` is the words fallback, not a place a piece can belong; the
    // picker would never show it for any module (review round 1).
    const { ok, messages } = parse(fixture({ films: [film('x', 'default')] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/never default/);
    expect(parse(fixture({ readings: [reading('r', 'default')] })).ok).toBe(false);
  });

  it('rejects a key that is neither a module id nor a fixed key', () => {
    const { ok, messages } = parse(fixture({ films: [film('x', 'values')] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/module id/);
  });

  it('rejects a reading naming a document that does not exist', () => {
    const { ok, messages } = parse(
      fixture({ readings: [documentReading('r', null, 'no_such_document')] })
    );
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/unknown document "no_such_document"/);
  });

  it('rejects a reading that is both a document and a link, and one that is neither', () => {
    // Neither shape is representable in `ResourcesFile` — that is the point of
    // the union — so both are built as the untyped JSON the schema actually reads.
    const base: Record<string, unknown> = { ...reading('r', null) };
    const both = { ...base, documentId: 'the_mission' };
    expect(parse({ ...fixture(), readings: [both] }).ok).toBe(false);

    const { href: _href, ...neither } = base;
    expect(parse({ ...fixture(), readings: [neither] }).ok).toBe(false);
  });

  it('rejects words citing a document that does not exist', () => {
    const words = fixture().words;
    const { ok, messages } = parse(
      fixture({
        words: {
          ...words,
          default: {
            ...words.default,
            source: { collection: 'foundational_documents', id: 'nope' },
          },
        },
      })
    );
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/cite unknown document "nope"/);
  });

  it('rejects a file with no default words', () => {
    const { default: _default, ...rest } = fixture().words;
    const { ok, messages } = parse(fixture({ words: rest }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/words.default is required/);
  });

  it('rejects an id longer than the suggestion tool accepts', () => {
    const { ok, messages } = parse(fixture({ films: [film('x'.repeat(81), null)] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/at most 80/);
    expect(parse(fixture({ films: [film('x'.repeat(80), null)] })).ok).toBe(true);
  });

  it('rejects a duplicate id within a list, and across the two lists', () => {
    const { ok, messages } = parse(fixture({ films: [film('dup', null), film('dup', null)] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/duplicate resource id "dup"/);

    // An id is what the suggestion tool resolves by: a film and a reading
    // sharing one would always resolve to the film.
    const across = parse(
      fixture({ films: [film('same', null)], readings: [reading('same', null)] })
    );
    expect(across.ok).toBe(false);
    expect(across.messages.join('\n')).toMatch(/one namespace/);
  });

  it('rejects a film or reading whose link is not http(s)', () => {
    const scheme = { ...film('x', null), href: 'javascript:alert(1)' };
    const { ok, messages } = parse(fixture({ films: [scheme] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/protocol|URL/i);
    expect(
      parse(fixture({ films: [{ ...film('y', null), href: 'https://example.com/y' }] })).ok
    ).toBe(true);
  });

  it('rejects an unknown key rather than dropping it', () => {
    const { ok } = parse({ ...fixture(), thumbnails: [] });
    expect(ok).toBe(false);
  });
});

describe('the selection', () => {
  const file = fixture();

  it('names the module, its tier, and its own words', () => {
    const selection = selectResources(file, MODULES, 'values');

    expect(selection?.key).toBe('values');
    expect(selection?.title).toBe('Values');
    expect(selection?.tier).toBe('foundations');
    expect(selection?.words.quote).toBe('V');
    expect(selection?.wordsAreOwn).toBe(true);
  });

  it('shows what belongs to the module first, then what belongs to everything, capped', () => {
    const selection = selectResources(file, MODULES, 'values');

    expect(selection?.films.map((f) => f.id)).toEqual(['values-a', 'values-b']);
    expect(selection?.films).toHaveLength(FILMS_SHOWN);
    expect(selection?.readings.map((r) => r.id)).toEqual([
      'read-values',
      'read-general-a',
      'read-general-b',
    ]);
    expect(selection?.readings).toHaveLength(READINGS_SHOWN);
  });

  it('never shows another module’s pieces', () => {
    const ids = selectResources(file, MODULES, 'boundaries')?.films.map((f) => f.id);
    expect(ids).toEqual(['boundaries-a', 'general-a']);
  });

  it('falls back to the default words for a module with none of its own, and says so', () => {
    const selection = selectResources(file, MODULES, 'boundaries');

    expect(selection?.words.quote).toBe('Q');
    expect(selection?.wordsAreOwn).toBe(false);
  });

  it('answers the three fixed keys with their titles and no tier', () => {
    expect(selectResources(file, MODULES, 'journey')).toMatchObject({
      title: 'The journey',
      tier: null,
      films: [expect.objectContaining({ id: 'general-a' })],
    });
    expect(selectResources(file, MODULES, 'situations')?.title).toBe('Life situations');
    expect(selectResources(file, MODULES, 'default')?.title).toBe('Lelañea');
  });

  it('returns null for a key that is nothing, so the route can 404', () => {
    expect(selectResources(file, MODULES, 'no-such-module')).toBeNull();
    // The file's id form is not a key the shell would send.
    expect(selectResources(file, MODULES, 'module_01_values')).toBeNull();
  });

  it('puts a pinned film first and still holds the cap', () => {
    const pinned = selectResources(file, MODULES, 'values', { pin: 'values-c' });
    expect(pinned?.films.map((f) => f.id)).toEqual(['values-c', 'values-a']);

    const foreign = selectResources(file, MODULES, 'values', { pin: 'boundaries-a' });
    expect(foreign?.films.map((f) => f.id)).toEqual(['boundaries-a', 'values-a']);
  });

  it('pins a reading too, in its own list, and leaves the films alone', () => {
    const pinned = selectResources(file, MODULES, 'values', { pin: 'read-general-c' });
    expect(pinned?.readings.map((r) => r.id)).toEqual([
      'read-general-c',
      'read-values',
      'read-general-a',
    ]);
    expect(pinned?.films.map((f) => f.id)).toEqual(['values-a', 'values-b']);
  });

  it('ignores a pin that names nothing', () => {
    const selection = selectResources(file, MODULES, 'values', { pin: 'ghost' });
    expect(selection?.films.map((f) => f.id)).toEqual(['values-a', 'values-b']);
  });

  it('is what the real loader serves for values', () => {
    const real = selectResourcesFor('values');
    const structure = getJourneyStructure().modules.find((m) => m.id === 'module_01_values');

    expect(real?.title).toBe(structure?.title);
    expect(real?.tier).toBe('foundations');
    expect(real?.wordsAreOwn).toBe(true);
    expect(real?.words.source.id).toBe('lesson_centered_living');
    expect(real?.films).toEqual([]);
    expect(selectResourcesFor('nope')).toBeNull();
  });
});
