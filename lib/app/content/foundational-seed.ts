/**
 * Her foundational documents as seed material (f-content-seeds t-86).
 *
 * `content/lelanea_foundational_documents.json` is no longer read at request
 * time. Every surface reads `app_foundational_document` through
 * `@/lib/app/content/document-store`. This module is the one place the file is
 * still imported, and its callers are the seed
 * (`prisma/seeds/app-lelanea/015-foundational-documents.ts`) and the tests that
 * check the file itself. Nothing a request reaches may import it; t-89 makes
 * that a lint rule.
 *
 * ## Section keys live here, not in the file
 *
 * `content/` stays byte-identical to what she wrote (the feature's done-when),
 * so the keys cannot be added to the JSON. {@link SECTION_KEYS} maps each key to
 * a run of blocks. The owner named them on 22 September 2026, and the journal
 * decision "Section keys for her documents (t-86)" records the ruling.
 *
 * Each range is pinned by the opening words of its first and last block.
 * {@link buildFoundationalSeed} throws if either does not match, so a file that
 * gained or lost a block fails the seed rather than keying the wrong passage.
 * Block indexes are safe to write down here and nowhere else: this runs once,
 * against the file, before any row exists. After that the key is on the block
 * in the database, and an edit carries it with the block.
 */

import rawFoundationalDocuments from '@/content/lelanea_foundational_documents.json';
import {
  foundationalDocumentsFileSchema,
  storedDocumentBlocksSchema,
  type DocumentBlock,
  type FoundationalDocumentsFile,
  type StoredDocumentBlock,
} from '@/lib/app/content/schemas';
import { findPlaceholders } from '@/lib/app/content/placeholders';

/** One key's run of blocks, and the opening words that prove the run is right. */
interface SectionRange {
  key: string;
  /** Inclusive block indexes. */
  from: number;
  to: number;
  /** The first block's text starts with this. */
  first: string;
  /** The last block's text starts with this. */
  last: string;
}

/**
 * The owner's section keys, by document. See the module docblock.
 *
 * Each range covers exactly what a surface showed before t-86, so moving to keys
 * changed nothing on screen. Where a page used to count paragraphs, the index
 * here is a BLOCK index, and the two differ in the disclaimer because its list
 * items used to count as paragraphs. `commitment` was paragraphs 72 and 73; it
 * is blocks 65 and 66.
 */
export const SECTION_KEYS: Readonly<Record<string, readonly SectionRange[]>> = {
  the_initiation: [
    {
      key: 'welcome',
      from: 0,
      to: 6,
      first: 'Welcome, {{first_name}}.',
      last: 'Welcome to Lelañea.',
    },
    {
      key: 'invitation',
      from: 7,
      to: 9,
      first: 'This is not simply an app.',
      last: 'An invitation to explore',
    },
    {
      key: 'guide',
      from: 51,
      to: 59,
      first: 'My role is not to tell you who you are.',
      last: 'There is nothing you are required to believe.',
    },
  ],
  the_heart_behind_lelanea: [
    {
      key: 'invitation',
      from: 0,
      to: 0,
      first: 'Lelañea was created as an invitation',
      last: 'Lelañea was created as an invitation',
    },
    {
      key: 'purpose',
      from: 1,
      to: 1,
      first: 'Its purpose is not simply',
      last: 'Its purpose is not simply',
    },
    {
      key: 'remembrance',
      from: 7,
      to: 8,
      first: 'Transformation is not viewed',
      last: 'It is the continual remembrance',
    },
  ],
  disclaimer: [
    {
      key: 'purpose',
      from: 2,
      to: 5,
      first: 'The Purpose of Lelañea',
      last: 'Its purpose is to encourage',
    },
    {
      key: 'purpose_limits',
      from: 6,
      to: 6,
      first: 'Lelañea is not intended to provide healthcare',
      last: 'Lelañea is not intended to provide healthcare',
    },
    {
      key: 'is_not',
      from: 7,
      to: 14,
      first: 'What Lelañea Is Not',
      last: 'Lelañea is **not** a substitute',
    },
    {
      key: 'is_not_context',
      from: 15,
      to: 15,
      first: 'Although some concepts',
      last: 'Although some concepts',
    },
    {
      key: 'coaching',
      from: 31,
      to: 37,
      first: 'Coaching Is Different from Therapy',
      last: 'Lelañea is intended to complement',
    },
    {
      key: 'crisis',
      from: 46,
      to: 52,
      first: 'Crisis Situations',
      last: 'Do not rely on Lelañea during',
    },
    {
      key: 'commitment',
      from: 65,
      to: 66,
      first: 'Lelañea was created with deep respect',
      last: 'The intention of this app is not to replace',
    },
  ],
};

/** The collection row the seed writes. */
export interface CollectionSeed {
  id: string;
  title: string;
  version: string;
  locale: string;
}

/** One document row the seed writes, blocks already keyed and validated. */
export interface DocumentSeed {
  id: string;
  position: number;
  title: string;
  subtitle: string | null;
  category: 'onboarding' | 'about' | 'legal';
  surface: string;
  requiresAcknowledgement: boolean;
  placeholders: string[];
  renderStyle: string | null;
  renderNote: string | null;
  blocks: StoredDocumentBlock[];
  version: string;
  locale: string;
}

export interface FoundationalSeed {
  collection: CollectionSeed;
  documents: DocumentSeed[];
}

let fileCache: FoundationalDocumentsFile | null = null;

/** The authored file, validated. Seeds and tests only. */
export function readFoundationalDocumentsFile(): FoundationalDocumentsFile {
  fileCache ??= foundationalDocumentsFileSchema.parse(rawFoundationalDocuments);
  return fileCache;
}

function blockText(block: DocumentBlock): string {
  return block.type === 'list' ? block.items.join(' ') : block.text;
}

/**
 * Put each block's section key on it, checking every range against its pins.
 *
 * @throws when a range runs past the document, when a pin does not match, or when
 * two ranges overlap. Each of those means the file changed underneath the map,
 * and seeding it anyway would put a key on the wrong passage.
 */
export function keyBlocks(
  documentId: string,
  blocks: readonly DocumentBlock[],
  ranges: readonly SectionRange[] = SECTION_KEYS[documentId] ?? []
): StoredDocumentBlock[] {
  const sections: (string | null)[] = blocks.map(() => null);

  for (const range of ranges) {
    const first = blocks[range.from];
    const last = blocks[range.to];
    if (!first || !last || range.from > range.to) {
      throw new Error(
        `Section "${range.key}" of "${documentId}" is blocks ${range.from}–${range.to}, ` +
          `but the document has ${blocks.length} blocks.`
      );
    }
    for (const [block, pin, end] of [
      [first, range.first, 'first'],
      [last, range.last, 'last'],
    ] as const) {
      if (!blockText(block).startsWith(pin)) {
        throw new Error(
          `Section "${range.key}" of "${documentId}": its ${end} block should start ` +
            `"${pin}" but reads "${blockText(block).slice(0, 60)}". The file changed; ` +
            `update SECTION_KEYS in lib/app/content/foundational-seed.ts.`
        );
      }
    }
    for (let index = range.from; index <= range.to; index++) {
      if (sections[index] !== null) {
        throw new Error(
          `Sections "${sections[index]}" and "${range.key}" of "${documentId}" both claim block ${index}.`
        );
      }
      sections[index] = range.key;
    }
  }

  return storedDocumentBlocksSchema.parse(
    blocks.map((block, index) => ({ ...block, section: sections[index] }))
  );
}

/**
 * The rows the seed writes, built from the file.
 *
 * Every document carries the collection's version as its own. That is what the
 * acknowledgement gate enforced before t-86, so a person who agreed to version
 * `1.1` of the Terms is not asked again because the words moved into a table.
 */
export function buildFoundationalSeed(
  file: FoundationalDocumentsFile = readFoundationalDocumentsFile()
): FoundationalSeed {
  const { collection } = file;
  const byId = new Map(file.documents.map((document) => [document.id, document]));

  return {
    collection: {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
    },
    // The schema's referential check guarantees every suggested id resolves and
    // every document is suggested exactly once.
    documents: collection.suggestedOrder.map((id, position) => {
      const document = byId.get(id)!;
      return {
        id: document.id,
        position,
        title: document.title,
        subtitle: document.subtitle,
        category: document.category,
        surface: document.surface,
        requiresAcknowledgement: document.requiresAcknowledgement ?? false,
        placeholders: [...(document.placeholders ?? [])],
        renderStyle: document.renderStyle ?? null,
        renderNote: document.renderNote ?? null,
        blocks: keyBlocks(document.id, document.blocks),
        version: collection.version,
        locale: collection.locale,
      };
    }),
  };
}

/**
 * Every placeholder the file's documents declare, across all of them.
 *
 * Reads the `placeholders` arrays the author maintains, not the prose. A
 * placeholder that appears in the copy but was never declared is drift, and
 * `tests/unit/lib/app/content/placeholders.test.ts` is what catches it.
 */
export function listDeclaredPlaceholders(): string[] {
  const declared = readFoundationalDocumentsFile().documents.flatMap(
    (document) => document.placeholders ?? []
  );
  return [...new Set(declared)].sort();
}

/** Every placeholder that actually occurs in the file's prose. */
export function listOccurringPlaceholders(): string[] {
  const found = readFoundationalDocumentsFile().documents.flatMap((document) =>
    document.blocks.flatMap((block) => {
      const strings = block.type === 'list' ? block.items : [block.text];
      return strings.flatMap(findPlaceholders);
    })
  );
  return [...new Set(found)].sort();
}
