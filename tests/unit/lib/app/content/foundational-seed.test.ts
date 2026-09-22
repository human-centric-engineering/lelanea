/**
 * Building the seed from her file, and putting the owner's section keys on the
 * blocks (f-content-seeds t-86).
 *
 * `keyBlocks` is the one place block indexes are still written down, and it
 * guards each range with the opening words of its first and last block. These
 * cases make sure the guard fires: a range whose pins no longer match, that
 * overlaps another, or that runs past the document must throw before anything is
 * written, never key the wrong passage.
 *
 * @see lib/app/content/foundational-seed.ts
 */

import { describe, expect, it } from 'vitest';

import {
  SECTION_KEYS,
  buildFoundationalSeed,
  keyBlocks,
  readFoundationalDocumentsFile,
} from '@/lib/app/content/foundational-seed';
import type { DocumentBlock } from '@/lib/app/content/schemas';

const blocks: DocumentBlock[] = [
  { type: 'heading', text: 'A heading', level: 2 },
  { type: 'paragraph', text: 'First words.' },
  { type: 'list', style: 'unordered', items: ['one;', 'two.'] },
  { type: 'paragraph', text: 'Last words.' },
];

describe('keyBlocks', () => {
  it('puts the key on every block of its range and null on the rest', () => {
    const keyed = keyBlocks('doc', blocks, [
      { key: 'body', from: 1, to: 2, first: 'First', last: 'one;' },
    ]);

    expect(keyed.map((block) => block.section)).toEqual([null, 'body', 'body', null]);
  });

  it('throws when a pin no longer matches, naming the key and the file to fix', () => {
    expect(() =>
      keyBlocks('doc', blocks, [{ key: 'body', from: 1, to: 1, first: 'Other', last: 'First' }])
    ).toThrow(/Section "body" of "doc".*first block.*SECTION_KEYS/);
  });

  it('throws when a range runs past the document', () => {
    expect(() =>
      keyBlocks('doc', blocks, [{ key: 'body', from: 3, to: 9, first: 'Last', last: 'Last' }])
    ).toThrow(/has 4 blocks/);
  });

  it('throws when two ranges claim the same block', () => {
    expect(() =>
      keyBlocks('doc', blocks, [
        { key: 'a', from: 0, to: 1, first: 'A heading', last: 'First' },
        { key: 'b', from: 1, to: 3, first: 'First', last: 'Last' },
      ])
    ).toThrow(/"a" and "b".*block 1/);
  });

  it('rejects a key that is not lower snake case', () => {
    expect(() =>
      keyBlocks('doc', blocks, [
        { key: 'Body Text', from: 1, to: 1, first: 'First', last: 'First' },
      ])
    ).toThrow();
  });
});

describe('buildFoundationalSeed', () => {
  it('builds every document of the real file, every key resolving against its pins', () => {
    // The pins are checked inside the build, so this passing IS the proof that
    // every range in SECTION_KEYS still marks the passage it was written for.
    const seed = buildFoundationalSeed();

    expect(seed.documents).toHaveLength(7);
    for (const [documentId, ranges] of Object.entries(SECTION_KEYS)) {
      const document = seed.documents.find((candidate) => candidate.id === documentId);
      const keys = new Set(document?.blocks.map((block) => block.section));
      for (const range of ranges) expect(keys).toContain(range.key);
    }
  });

  it('names only documents the file has, so a mistyped id cannot silently key nothing', () => {
    const ids = new Set(readFoundationalDocumentsFile().documents.map((document) => document.id));

    for (const documentId of Object.keys(SECTION_KEYS)) expect(ids).toContain(documentId);
  });

  it('gives every document the collection version the gate enforced before t-86', () => {
    const seed = buildFoundationalSeed();

    expect(seed.documents.every((document) => document.version === seed.collection.version)).toBe(
      true
    );
  });
});
