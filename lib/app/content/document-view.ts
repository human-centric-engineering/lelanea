/**
 * How a stored foundational document is served (f-content-seeds t-86).
 *
 * The shapes every surface and the API receive, and the one projection from a
 * row to them. It is pure, with no database import, so the store, the seed's
 * tests and the fake store in `tests/helpers/app/foundational-documents.ts` all
 * build a document the same way. A test that renders a page therefore sees
 * exactly what production would serve for the same row.
 *
 * **Validated on the way out, not just on the way in.** `blocks` is JSON. A row
 * that fails `storedDocumentBlocksSchema` throws rather than rendering. That is
 * the file loader's old contract ("a content-integrity failure is loud"), now
 * applied to the column.
 *
 * @see lib/app/content/document-store.ts — the reads and writes
 */

import { z } from 'zod';
import { storedDocumentBlocksSchema, type StoredDocumentBlock } from '@/lib/app/content/schemas';

// ============================================================================
// Served shapes
// ============================================================================

/** Identity and version of the document collection, for clients and ETags. */
export interface ContentCollectionMeta {
  id: string;
  title: string;
  /** The collection's own version label, e.g. `1.1`. */
  version: string;
  /** BCP 47 tag as authored, e.g. `en-US`. */
  locale: string;
}

/**
 * A foundational document without its blocks. It carries enough to list the
 * document, route to it, and decide whether it must be acknowledged, without
 * sending the prose.
 */
export interface FoundationalDocumentSummary {
  id: string;
  title: string;
  subtitle: string | null;
  category: 'onboarding' | 'about' | 'legal';
  /** Which app surface shows this document, e.g. `first_run_welcome`. */
  surface: string;
  requiresAcknowledgement: boolean;
  /** Merge fields present in the copy, e.g. `{{first_name}}`. */
  placeholders: readonly string[];
  /** `'cadence'` on the welcome statement — render each beat on its own line. */
  renderStyle: string | null;
  renderNote: string | null;
  /** The label an acknowledgement of this document is recorded against. */
  version: string;
  /** BCP 47, as authored. */
  locale: string;
  /** Counts every write; changes whenever the words do. */
  revision: number;
  /** Every section key in the document, in order of first appearance. */
  sections: readonly string[];
  blockCount: number;
}

/** A foundational document with its blocks, in authored order. */
export interface FoundationalDocumentDetail extends FoundationalDocumentSummary {
  blocks: readonly StoredDocumentBlock[];
}

/** The document index, in reading order. */
export interface FoundationalDocumentIndex {
  collection: ContentCollectionMeta;
  documents: readonly FoundationalDocumentSummary[];
}

/**
 * The database holds no documents: the seed has not run.
 *
 * Thrown rather than answered with an empty list. An empty index would read as
 * "there are no documents", when what has happened is that the environment
 * was never seeded, and the gate, the legal pages and the emails would all fail
 * more quietly than this.
 */
export class ContentNotSeededError extends Error {
  constructor() {
    super(
      'No foundational documents in the database. Run `npm run db:seed` ' +
        '(prisma/seeds/app-lelanea/015-foundational-documents.ts).'
    );
    this.name = 'ContentNotSeededError';
  }
}

// ============================================================================
// Projection
// ============================================================================

const categorySchema = z.enum(['onboarding', 'about', 'legal']);

/**
 * The columns of `app_foundational_document` a view is built from. Structural
 * rather than the Prisma payload type, so a test can build one from the seed
 * without a client.
 */
export interface DocumentRow {
  id: string;
  title: string;
  subtitle: string | null;
  category: string;
  surface: string;
  requiresAcknowledgement: boolean;
  placeholders: string[];
  renderStyle: string | null;
  renderNote: string | null;
  blocks: unknown;
  version: string;
  locale: string;
  revision: number;
}

/**
 * A stored row as served, with its blocks and category validated.
 *
 * @throws when the row fails validation. See the module docblock.
 */
export function toDocumentDetail(row: DocumentRow): FoundationalDocumentDetail {
  const parsedBlocks = storedDocumentBlocksSchema.safeParse(row.blocks);
  const category = categorySchema.safeParse(row.category);
  if (!parsedBlocks.success || !category.success) {
    throw new Error(
      `Foundational document "${row.id}" failed validation on read: ` +
        (parsedBlocks.success ? '' : `blocks ${parsedBlocks.error.message} `) +
        (category.success ? '' : `category "${row.category}"`)
    );
  }
  const blocks = parsedBlocks.data;

  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    category: category.data,
    surface: row.surface,
    requiresAcknowledgement: row.requiresAcknowledgement,
    placeholders: row.placeholders,
    renderStyle: row.renderStyle,
    renderNote: row.renderNote,
    version: row.version,
    locale: row.locale,
    revision: row.revision,
    sections: [
      ...new Set(blocks.flatMap((block) => (block.section === null ? [] : [block.section]))),
    ],
    blockCount: blocks.length,
    blocks,
  };
}

/** A served document without its blocks. */
export function toDocumentSummary(detail: FoundationalDocumentDetail): FoundationalDocumentSummary {
  const { blocks: _blocks, ...summary } = detail;
  return summary;
}
