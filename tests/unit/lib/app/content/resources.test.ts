/**
 * Unit Tests: the resources — her videos, audio and articles, and her words on
 * whatever is open (f-resources t-74).
 *
 * Three jobs, and the middle one is the load-bearing one:
 *
 * 1. The real file parses, ships as a draft, and says so — as the rows the seed
 *    writes, read back through the real projection (t-87).
 * 2. **Every passage is verbatim.** The drawer's eyebrow says these are her
 *    words, so each `words` entry cites a source this repository holds and the
 *    text must occur in it character for character. A one-character edit —
 *    a tidied comma, a straightened quote — fails here. Established on a
 *    non-empty set first, so the assertion cannot pass on nothing (fp6).
 * 3. The schema's referential checks, and the selection rule, on fixtures.
 * 4. The data migration embeds exactly what the seed writes (t-87).
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real resources seed
 * ---------------------------------------------------------------------------
 * The keys and passages in section 1 are Lelañea's content. A fork replacing
 * `content/` should rewrite them against its own file, not delete them; the
 * verbatim check in section 2 is content-independent and should be kept.
 *
 * @see lib/app/content/resources.ts
 * @see lib/app/content/seed-input/resources-seed.ts
 * @see lib/app/content/resource-view.ts
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  selectResources,
  buildResourcesFileSchema,
  VIDEOS_SHOWN,
  ARTICLES_SHOWN,
  type ResourcesFile,
  type ResourcesLibrary,
  type ResourceModuleRef,
} from '@/lib/app/content/resources';
import { toJourneyStructure } from '@/lib/app/content/journey-view';
import { toResourcesLibrary } from '@/lib/app/content/resource-view';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { getValuesModule } from '@/lib/app/content/seed-input/values';
import { seededJourneyRows, seededResourceRows } from '@/tests/helpers/app/content-stores';

/** A file's library, as the seed would write it and the store would serve it. */
function libraryOf(file: ResourcesFile): ResourcesLibrary {
  const seed = buildResourcesSeed(file);
  return toResourcesLibrary(
    seed.collection,
    seed.resources.map((row) => ({ ...row, revision: 1 })),
    seed.words.map((row) => ({ ...row, revision: 1 }))
  );
}

/** The real library: the rows the seed writes from the shipped file. */
function getResourcesLibrary(): ResourcesLibrary {
  const rows = seededResourceRows();
  return toResourcesLibrary(rows.collection, rows.resources, rows.words);
}

/** Her documents as the seed builds them from the file (t-86). */
const seeded = buildFoundationalSeed();
const getFoundationalDocument = (id: string) =>
  seeded.documents.find((document) => document.id === id) ?? null;

// ============================================================================
// 1. The real file
// ============================================================================

describe('the bundled resources', () => {
  it('parses, and serves the collection it names', () => {
    const library = getResourcesLibrary();

    expect(library.collection.id).toBe('lelanea_resources');
    expect(library.collection.locale).toBe('en-US');
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

  it('invents no video, no audio and no article — her list is t-76', () => {
    // Pinned so that the first entry is a deliberate change to this test, not
    // something that slipped in beside a code change.
    expect(getResourcesLibrary().videos).toEqual([]);
    expect(getResourcesLibrary().articles).toEqual([]);
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
    videos: [
      video('values-a', 'module_01_values'),
      video('values-b', 'module_01_values'),
      video('values-c', 'module_01_values'),
      video('general-a', null),
      video('boundaries-a', 'module_02_boundaries'),
    ],
    audio: [
      audio('listen-values', 'module_01_values'),
      audio('listen-general-a', null),
      audio('listen-general-b', null),
    ],
    articles: [
      article('read-values', 'module_01_values'),
      article('read-general-a', null),
      article('read-general-b', null),
      article('read-general-c', null),
      documentArticle('read-doc', null, 'the_mission'),
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

function video(id: string, relatesTo: string | null): ResourcesFile['videos'][number] {
  return {
    id,
    title: id,
    subtitle: 'for',
    relatesTo,
    duration: '4:20',
    href: 'https://example.com/' + id,
  };
}

function audio(id: string, relatesTo: string | null): ResourcesFile['audio'][number] {
  return {
    id,
    title: id,
    subtitle: 'for',
    relatesTo,
    duration: '12:05',
    href: 'https://example.com/' + id,
  };
}

function article(id: string, relatesTo: string | null): ResourcesFile['articles'][number] {
  return {
    id,
    title: id,
    subtitle: 'for',
    relatesTo,
    readingTime: '5 min',
    href: 'https://example.com/' + id,
  };
}

function documentArticle(
  id: string,
  relatesTo: string | null,
  documentId: string
): ResourcesFile['articles'][number] {
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

  it('rejects a video that relates to a module the structure does not have', () => {
    const { ok, messages } = parse(fixture({ videos: [video('x', 'module_99_nowhere')] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/video "x" relates to unknown key "module_99_nowhere"/);
  });

  it('rejects a piece that relates to `default` — that is spelled null', () => {
    // `default` is the words fallback, not a place a piece can belong; the
    // picker would never show it for any module (review round 1).
    const { ok, messages } = parse(fixture({ videos: [video('x', 'default')] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/never default/);
    expect(parse(fixture({ articles: [article('r', 'default')] })).ok).toBe(false);
  });

  it('rejects a key that is neither a module id nor a fixed key', () => {
    const { ok, messages } = parse(fixture({ videos: [video('x', 'values')] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/module id/);
  });

  it('rejects an article naming a document that does not exist', () => {
    const { ok, messages } = parse(
      fixture({ articles: [documentArticle('r', null, 'no_such_document')] })
    );
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/unknown document "no_such_document"/);
  });

  it('rejects an article that is both a document and a link, and one that is neither', () => {
    // Neither shape is representable in `ResourcesFile` — that is the point of
    // the union — so both are built as the untyped JSON the schema actually reads.
    const base: Record<string, unknown> = { ...article('r', null) };
    const both = { ...base, documentId: 'the_mission' };
    expect(parse({ ...fixture(), articles: [both] }).ok).toBe(false);

    const { href: _href, ...neither } = base;
    expect(parse({ ...fixture(), articles: [neither] }).ok).toBe(false);
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
    const { ok, messages } = parse(fixture({ videos: [video('x'.repeat(81), null)] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/at most 80/);
    expect(parse(fixture({ videos: [video('x'.repeat(80), null)] })).ok).toBe(true);
  });

  it('rejects a duplicate id within a list, and across the two lists', () => {
    const { ok, messages } = parse(fixture({ videos: [video('dup', null), video('dup', null)] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/duplicate resource id "dup"/);

    // An id is what the suggestion tool resolves by: a video and an article
    // sharing one would always resolve to the video.
    const across = parse(
      fixture({ videos: [video('same', null)], articles: [article('same', null)] })
    );
    expect(across.ok).toBe(false);
    expect(across.messages.join('\n')).toMatch(/one namespace/);
  });

  it('rejects a video, audio or article whose link is not http(s)', () => {
    const scheme = { ...video('x', null), href: 'javascript:alert(1)' };
    const { ok, messages } = parse(fixture({ videos: [scheme] }));
    expect(ok).toBe(false);
    expect(messages.join('\n')).toMatch(/protocol|URL/i);
    expect(
      parse(fixture({ videos: [{ ...video('y', null), href: 'https://example.com/y' }] })).ok
    ).toBe(true);
  });

  it('rejects an unknown key rather than dropping it', () => {
    const { ok } = parse({ ...fixture(), thumbnails: [] });
    expect(ok).toBe(false);
  });
});

describe('the selection', () => {
  const file = libraryOf(fixture());

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

    expect(selection?.videos.map((f) => f.id)).toEqual(['values-a', 'values-b']);
    expect(selection?.videos).toHaveLength(VIDEOS_SHOWN);
    expect(selection?.articles.map((r) => r.id)).toEqual([
      'read-values',
      'read-general-a',
      'read-general-b',
    ]);
    expect(selection?.articles).toHaveLength(ARTICLES_SHOWN);
  });

  it('never shows another module’s pieces', () => {
    const ids = selectResources(file, MODULES, 'boundaries')?.videos.map((f) => f.id);
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
      videos: [expect.objectContaining({ id: 'general-a' })],
    });
    expect(selectResources(file, MODULES, 'situations')?.title).toBe('Life situations');
    expect(selectResources(file, MODULES, 'default')?.title).toBe('Lelañea');
  });

  it('returns null for a key that is nothing, so the route can 404', () => {
    expect(selectResources(file, MODULES, 'no-such-module')).toBeNull();
    // The file's id form is not a key the shell would send.
    expect(selectResources(file, MODULES, 'module_01_values')).toBeNull();
  });

  it('puts a pinned video first and still holds the cap', () => {
    const pinned = selectResources(file, MODULES, 'values', { pin: 'values-c' });
    expect(pinned?.videos.map((f) => f.id)).toEqual(['values-c', 'values-a']);

    const foreign = selectResources(file, MODULES, 'values', { pin: 'boundaries-a' });
    expect(foreign?.videos.map((f) => f.id)).toEqual(['boundaries-a', 'values-a']);
  });

  it('pins an article too, in its own list, and leaves the videos alone', () => {
    const pinned = selectResources(file, MODULES, 'values', { pin: 'read-general-c' });
    expect(pinned?.articles.map((r) => r.id)).toEqual([
      'read-general-c',
      'read-values',
      'read-general-a',
    ]);
    expect(pinned?.videos.map((f) => f.id)).toEqual(['values-a', 'values-b']);
  });

  it('ignores a pin that names nothing', () => {
    const selection = selectResources(file, MODULES, 'values', { pin: 'ghost' });
    expect(selection?.videos.map((f) => f.id)).toEqual(['values-a', 'values-b']);
  });

  it('is what the real rows give for values', () => {
    const rows = seededJourneyRows();
    const journey = toJourneyStructure(rows.journey, rows.tiers, rows.modules);
    const real = selectResources(getResourcesLibrary(), journey.modules, 'values');
    const structure = journey.modules.find((m) => m.id === 'module_01_values');

    expect(real?.title).toBe(structure?.title);
    expect(real?.tier).toBe('foundations');
    expect(real?.wordsAreOwn).toBe(true);
    expect(real?.words.source.id).toBe('lesson_centered_living');
    expect(real?.videos).toEqual([]);
    expect(selectResources(getResourcesLibrary(), journey.modules, 'nope')).toBeNull();
  });
});

// ============================================================================
// 4. The rows, and the data migration (t-87)
// ============================================================================

describe('a stored row is held to the file’s rules on the way out', () => {
  const base = libraryOf(fixture());

  it('round-trips the fixture: what the seed writes is what the store serves', () => {
    const file = fixture();
    expect(base.videos.map(({ revision: _r, ...video }) => video)).toEqual(file.videos);
    expect(base.articles.map(({ revision: _r, ...article }) => article)).toEqual(file.articles);
  });

  it('refuses an article that is both a link and a document', () => {
    const seed = buildResourcesSeed(fixture());
    const both = seed.resources.map((row) =>
      row.id === 'read-doc'
        ? { ...row, href: 'https://example.com/x', revision: 1 }
        : { ...row, revision: 1 }
    );

    expect(() =>
      toResourcesLibrary(
        seed.collection,
        both,
        seed.words.map((w) => ({ ...w, revision: 1 }))
      )
    ).toThrow(/"read-doc" is not a well-formed article/);
  });

  it('refuses a video whose link is not http(s), as the file schema did', () => {
    const seed = buildResourcesSeed(fixture());
    const bad = seed.resources.map((row) =>
      row.id === 'values-a'
        ? { ...row, href: 'javascript:alert(1)', revision: 1 }
        : { ...row, revision: 1 }
    );

    expect(() =>
      toResourcesLibrary(
        seed.collection,
        bad,
        seed.words.map((w) => ({ ...w, revision: 1 }))
      )
    ).toThrow(/"values-a" failed validation as a video/);
  });

  it('refuses a library with no default words, which every key falls back to', () => {
    const seed = buildResourcesSeed(fixture());

    expect(() =>
      toResourcesLibrary(
        seed.collection,
        [],
        seed.words.filter((w) => w.key !== 'default').map((w) => ({ ...w, revision: 1 }))
      )
    ).toThrow(/no words for "default"/);
  });
});

describe('the data migration', () => {
  const MIGRATION = path.join(
    process.cwd(),
    'prisma/migrations/20260928100100_app_journey_questions_resources_data/migration.sql'
  );

  // The resource kinds' rename (24 Sept 2026) moved the seeded title and note
  // where they were still at the values this migration wrote. The frozen file
  // cannot change, so the seed is what the two write together.
  const KINDS_MIGRATION = path.join(
    process.cwd(),
    'prisma/migrations/20261001100000_app_resource_kinds/migration.sql'
  );

  /** The value between a pair of dollar-quote tags in the kinds migration. */
  function quoted(sql: string, tag: string): string {
    const match = new RegExp(`\\$${tag}\\$([\\s\\S]*?)\\$${tag}\\$`).exec(sql);
    if (!match) throw new Error(`The kinds migration no longer carries $${tag}$`);
    return match[1];
  }

  it('writes, with the kinds rename after it, exactly what the seed builds today', () => {
    const match = /\$t87resources\$([\s\S]*?)\$t87resources\$/.exec(
      readFileSync(MIGRATION, 'utf8')
    );
    expect(match, 'the migration no longer embeds the resources seed JSON').not.toBeNull();
    const written = JSON.parse(match![1]) as ReturnType<typeof buildResourcesSeed>;

    const kinds = readFileSync(KINDS_MIGRATION, 'utf8');
    // It moves only the values this migration wrote…
    expect(quoted(kinds, 'title_from')).toBe(written.collection.title);
    expect(quoted(kinds, 'note_from')).toBe(
      (written.collection.provenance as { note: string }).note
    );
    // …and the result is the seed.
    const moved = {
      ...written,
      collection: {
        ...written.collection,
        title: quoted(kinds, 'title_to'),
        provenance: {
          ...(written.collection.provenance as object),
          note: quoted(kinds, 'note_to'),
        },
      },
    };
    expect(moved).toEqual(buildResourcesSeed());
  });

  it('records the same changed fields the service records', async () => {
    const { RESOURCE_SNAPSHOT_FIELDS, WORDS_SNAPSHOT_FIELDS } =
      await import('@/lib/app/content/resource-store');
    const sql = readFileSync(MIGRATION, 'utf8');

    for (const fields of [RESOURCE_SNAPSHOT_FIELDS, WORDS_SNAPSHOT_FIELDS]) {
      expect(sql).toContain(`ARRAY[${fields.map((f) => `'${f}'`).join(', ')}]`);
    }
  });
});
