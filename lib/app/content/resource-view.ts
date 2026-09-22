/**
 * How the stored resource library is served, and how an item becomes a row
 * (f-content-seeds t-87).
 *
 * Pure, with no database import, so the store, the seed's tests and the fake
 * store all build the library the same way.
 *
 * **One table, two kinds.** Films and readings share `app_resource`, because
 * they share one id namespace. The rules the old file's schema held by shape
 * are checked here, on every write and every read: a film has a duration and a
 * link and nothing else; a reading has a reading time and exactly one of a link
 * and a document. Each row is run through the same `filmSchema` or
 * `readingSchema` the file was, so a row an admin writes (t-91) is held to the
 * same rules the seed was.
 *
 * @see lib/app/content/resource-store.ts — the reads and writes
 * @see lib/app/content/resources.ts — the schemas and the selection
 */

import {
  filmSchema,
  provenanceSchema,
  readingSchema,
  wordsSchema,
  type ResourceFilm,
  type ResourceFilmView,
  type ResourceReading,
  type ResourceReadingView,
  type ResourcesLibrary,
  type ResourceWords,
  type ResourceWordsView,
} from '@/lib/app/content/resources';

// ============================================================================
// Rows
// ============================================================================

export const RESOURCE_KINDS = ['film', 'reading'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceCollectionRow {
  id: string;
  title: string;
  version: string;
  locale: string;
  provenance: unknown;
}

/** The columns of `app_resource`. */
export interface ResourceRow {
  id: string;
  kind: string;
  position: number;
  title: string;
  subtitle: string;
  relatesTo: string | null;
  duration: string | null;
  readingTime: string | null;
  href: string | null;
  documentId: string | null;
  revision: number;
}

/** The columns of `app_resource_words`. */
export interface ResourceWordsRow {
  key: string;
  quote: string;
  paragraphs: string[];
  sourceCollection: string;
  sourceId: string;
  revision: number;
}

// ============================================================================
// Item ↔ row
// ============================================================================

/** A film or a reading as the columns hold it, without its revision. */
export function resourceToRow(
  item: ResourceFilm | ResourceReading,
  kind: ResourceKind,
  position: number
): Omit<ResourceRow, 'revision'> {
  return {
    id: item.id,
    kind,
    position,
    title: item.title,
    subtitle: item.subtitle,
    relatesTo: item.relatesTo,
    duration: 'duration' in item ? item.duration : null,
    readingTime: 'readingTime' in item ? item.readingTime : null,
    href: 'href' in item ? item.href : null,
    documentId: 'documentId' in item ? item.documentId : null,
  };
}

/** One key's words as the columns hold them, without its revision. */
export function wordsToRow(key: string, words: ResourceWords): Omit<ResourceWordsRow, 'revision'> {
  return {
    key,
    quote: words.quote,
    paragraphs: [...words.paragraphs],
    sourceCollection: words.source.collection,
    sourceId: words.source.id,
  };
}

/**
 * A stored film, validated. The columns a film does not have must be empty, or
 * the row is a reading mislabelled, and serving it as a film would drop its
 * document on the floor.
 *
 * @throws naming the row and the rule it broke.
 */
export function toFilm(row: ResourceRow): ResourceFilmView {
  if (row.kind !== 'film' || row.readingTime !== null || row.documentId !== null) {
    throw new Error(`Resource "${row.id}" is not a well-formed film`);
  }
  const parsed = filmSchema.safeParse({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    relatesTo: row.relatesTo,
    duration: row.duration,
    href: row.href,
  });
  if (!parsed.success) {
    throw new Error(`Resource "${row.id}" failed validation as a film: ${parsed.error.message}`);
  }
  return { ...parsed.data, revision: row.revision };
}

/**
 * A stored reading, validated: a reading time, and exactly one of a link and a
 * document.
 *
 * @throws naming the row and the rule it broke.
 */
export function toReading(row: ResourceRow): ResourceReadingView {
  if (
    row.kind !== 'reading' ||
    row.duration !== null ||
    (row.href === null) === (row.documentId === null)
  ) {
    throw new Error(
      `Resource "${row.id}" is not a well-formed reading: it needs exactly one of a link and a document`
    );
  }
  const base = {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    relatesTo: row.relatesTo,
    readingTime: row.readingTime,
  };
  const parsed = readingSchema.safeParse(
    row.documentId !== null ? { ...base, documentId: row.documentId } : { ...base, href: row.href }
  );
  if (!parsed.success) {
    throw new Error(`Resource "${row.id}" failed validation as a reading: ${parsed.error.message}`);
  }
  return { ...parsed.data, revision: row.revision };
}

/** A stored key's words, validated. @throws naming the key. */
export function toWords(row: ResourceWordsRow): ResourceWordsView {
  const parsed = wordsSchema.safeParse({
    quote: row.quote,
    paragraphs: row.paragraphs,
    source: { collection: row.sourceCollection, id: row.sourceId },
  });
  if (!parsed.success) {
    throw new Error(`Resource words for "${row.key}" failed validation: ${parsed.error.message}`);
  }
  return { ...parsed.data, revision: row.revision };
}

// ============================================================================
// Projection
// ============================================================================

/**
 * The library as served: films and readings each in their stored order, and
 * the words by key.
 *
 * @throws when a row fails validation, a row's kind is neither, or there are no
 * words for `default`, which every other key falls back to.
 */
export function toResourcesLibrary(
  collection: ResourceCollectionRow,
  resourceRows: readonly ResourceRow[],
  wordsRows: readonly ResourceWordsRow[]
): ResourcesLibrary {
  const provenance = provenanceSchema.safeParse(collection.provenance);
  if (!provenance.success) {
    throw new Error(`Resource collection "${collection.id}" has a malformed provenance`);
  }
  const ordered = [...resourceRows].sort((a, b) => a.position - b.position);
  for (const row of ordered) {
    if (!RESOURCE_KINDS.some((kind) => kind === row.kind)) {
      throw new Error(`Resource "${row.id}" has unknown kind "${row.kind}"`);
    }
  }
  const words: Record<string, ResourceWordsView> = {};
  for (const row of wordsRows) words[row.key] = toWords(row);
  if (!('default' in words)) throw new Error('The resource library has no words for "default"');

  return {
    collection: {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
      provenance: provenance.data,
    },
    films: ordered.filter((row) => row.kind === 'film').map(toFilm),
    readings: ordered.filter((row) => row.kind === 'reading').map(toReading),
    words,
  };
}
