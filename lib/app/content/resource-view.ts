/**
 * How the stored resource library is served, and how an item becomes a row
 * (f-content-seeds t-87).
 *
 * Pure, with no database import, so the store, the seed's tests and the fake
 * store all build the library the same way.
 *
 * **One table, three kinds.** Videos, audio and articles share `app_resource`, because
 * they share one id namespace. The rules the old file's schema held by shape
 * are checked here, on every write and every read: a video or an audio piece has a
 * duration and a link and nothing else; an article has a reading time and exactly one of a link
 * and a document. Each row is run through the same `videoSchema` or
 * `articleSchema` the file was, so a row an admin writes (t-91) is held to the
 * same rules the seed was.
 *
 * @see lib/app/content/resource-store.ts — the reads and writes
 * @see lib/app/content/resources.ts — the schemas and the selection
 */

import {
  videoSchema,
  provenanceSchema,
  articleSchema,
  wordsSchema,
  type ResourceAudioView,
  type ResourceVideo,
  type ResourceVideoView,
  type ResourceArticle,
  type ResourceArticleView,
  type ResourcesLibrary,
  type ResourceWords,
  type ResourceWordsView,
} from '@/lib/app/content/resources';

// ============================================================================
// Rows
// ============================================================================

export const RESOURCE_KINDS = ['video', 'audio', 'article'] as const;
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

/** A video, audio or article as the columns hold it, without its revision. */
export function resourceToRow(
  // An audio piece has the video's shape, so `ResourceVideo` covers it.
  item: ResourceVideo | ResourceArticle,
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
 * A stored video or audio piece, validated. The columns neither has must be
 * empty, or the row is an article mislabelled, and serving it as either would
 * drop its document on the floor.
 *
 * @throws naming the row and the rule it broke.
 */
function toTimed(row: ResourceRow, kind: 'video' | 'audio'): ResourceVideoView {
  const label = kind === 'video' ? 'a video' : 'an audio piece';
  if (row.kind !== kind || row.readingTime !== null || row.documentId !== null) {
    throw new Error(
      `Resource "${row.id}" is not a well-formed ${kind === 'video' ? 'video' : 'audio piece'}`
    );
  }
  const parsed = videoSchema.safeParse({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    relatesTo: row.relatesTo,
    duration: row.duration,
    href: row.href,
  });
  if (!parsed.success) {
    throw new Error(`Resource "${row.id}" failed validation as ${label}: ${parsed.error.message}`);
  }
  return { ...parsed.data, revision: row.revision };
}

/** A stored video, validated. @throws naming the row and the rule it broke. */
export function toVideo(row: ResourceRow): ResourceVideoView {
  return toTimed(row, 'video');
}

/** A stored audio piece, validated — held to what a video is. @throws as `toVideo`. */
export function toAudio(row: ResourceRow): ResourceAudioView {
  return toTimed(row, 'audio');
}

/**
 * A stored article, validated: a reading time, and exactly one of a link and a
 * document.
 *
 * @throws naming the row and the rule it broke.
 */
export function toArticle(row: ResourceRow): ResourceArticleView {
  if (
    row.kind !== 'article' ||
    row.duration !== null ||
    (row.href === null) === (row.documentId === null)
  ) {
    throw new Error(
      `Resource "${row.id}" is not a well-formed article: it needs exactly one of a link and a document`
    );
  }
  const base = {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    relatesTo: row.relatesTo,
    readingTime: row.readingTime,
  };
  const parsed = articleSchema.safeParse(
    row.documentId !== null ? { ...base, documentId: row.documentId } : { ...base, href: row.href }
  );
  if (!parsed.success) {
    throw new Error(
      `Resource "${row.id}" failed validation as an article: ${parsed.error.message}`
    );
  }
  return { ...parsed.data, revision: row.revision };
}

/** A row's kind, checked. @throws for a kind that is none of the three. */
export function resourceKindOf(row: Pick<ResourceRow, 'id' | 'kind'>): ResourceKind {
  const kind = RESOURCE_KINDS.find((k) => k === row.kind);
  if (!kind) throw new Error(`Resource "${row.id}" has unknown kind "${row.kind}"`);
  return kind;
}

/** A stored resource of any kind, validated as its kind. @throws as the per-kind readers. */
export function toResource(
  row: ResourceRow
): ResourceVideoView | ResourceAudioView | ResourceArticleView {
  const kind = resourceKindOf(row);
  if (kind === 'video') return toVideo(row);
  if (kind === 'audio') return toAudio(row);
  return toArticle(row);
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
 * The library as served: videos, audio and articles each in their stored order, and
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
    videos: ordered.filter((row) => row.kind === 'video').map(toVideo),
    audio: ordered.filter((row) => row.kind === 'audio').map(toAudio),
    articles: ordered.filter((row) => row.kind === 'article').map(toArticle),
    words,
  };
}

// ---------------------------------------------------------------------------
// Seed shapes (t-89)
// ---------------------------------------------------------------------------
// What the seed unit writes, declared here rather than beside the builder in
// `./seed-input/`: the store reads these rows back and needs the shape, and no
// runtime module may import anything from that folder — not even a type, which
// is what `tests/unit/lib/app/content/runtime-import-graph.test.ts` enforces.

/** What the seed writes: the collection, every video, audio and article, every key's words. */
export interface ResourcesSeed {
  collection: ResourceCollectionRow;
  resources: Omit<ResourceRow, 'revision'>[];
  words: Omit<ResourceWordsRow, 'revision'>[];
}
