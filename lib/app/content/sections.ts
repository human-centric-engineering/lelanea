/**
 * Selecting one named section out of an authored document.
 *
 * ## Why this exists
 *
 * `/data` is a designed page, not a rendering of a whole document. It shows the
 * disclaimer's "what it is / what it is not" columns, its crisis guidance and
 * its coaching-versus-therapy explanation as separate pieces of the page, with
 * the site's own chrome around each. The home page and both emails likewise show
 * passages rather than whole documents. The full documents are at their own URLs.
 *
 * The obvious way to build those surfaces is to retype her lines into a `const`
 * beside the layout. That is precisely the drift `.context/app/content.md` exists
 * to prevent: the moment a string is pasted into JSX it stops tracking the
 * source.
 *
 * So a surface names the section it wants and gets the stored blocks back.
 *
 * ## Sections are found by KEY (t-86)
 *
 * Each stored block carries a `section` key or `null`. The owner named the keys,
 * and the seed puts them on the blocks (`lib/app/content/foundational-seed.ts`).
 * Before t-86 these pages cut her text by paragraph index, by heading text and,
 * on `/data`, by a regex over the prose. That was composition logic living in a
 * page, which a native client would have had to re-implement and which broke
 * silently when a block moved. A key travels with its blocks when an admin edits
 * around them, and it is in the API response, so every client selects the same
 * passage the same way.
 *
 * ## A miss is fatal
 *
 * `selectSection` throws when the key is not in the document. The alternative —
 * return an empty array — fails silently, and consider what silently means here:
 * `/data` renders its "it is not" column as an empty box under a green tick, and
 * the page that exists so somebody looking for therapy works out before they
 * sign up that this is not it says nothing at all. A 500 on a content-integrity
 * failure is loud, correct, and impossible to miss.
 *
 * @see lib/app/content/document-store.ts — the reads these select from
 * @see .context/app/content.md — the pipeline this is part of
 */

import {
  getFoundationalDocument,
  type FoundationalDocumentDetail,
} from '@/lib/app/content/document-store';

/** The blocks of one document, as the store hands them out. */
type Blocks = FoundationalDocumentDetail['blocks'];

/**
 * A document a surface cannot render without.
 *
 * `getFoundationalDocument` returns `null` for an unknown id, which is right for
 * the API route: a caller can ask for anything, and the answer is a 404. A page
 * is not that. It names a constant id, so `null` here means the database lost a
 * document (or was never seeded), not that somebody typed a bad URL.
 *
 * `notFound()` would be the wrong response. It would tell a reader the page does
 * not exist when the site's own content is broken, and it would do it quietly on
 * the legal pages, where the quiet version is worst. This throws for the same
 * reason `selectSection` does.
 */
export async function requireDocument(id: string): Promise<FoundationalDocumentDetail> {
  const document = await getFoundationalDocument(id);

  if (!document) {
    throw new Error(
      `Foundational document "${id}" is not in the database. A surface renders it by id; ` +
        `either the seed has not run (npm run db:seed) or the document was removed.`
    );
  }

  return document;
}

/**
 * Thrown when a section a surface asked for is not in the document.
 *
 * A named class so a caller that genuinely wants to degrade (nothing does today)
 * can tell a missing section from a bug in the store.
 */
export class MissingSectionError extends Error {
  constructor(
    readonly documentId: string,
    readonly key: string,
    available: readonly string[]
  ) {
    super(
      `Foundational document "${documentId}" has no section "${key}". ` +
        `Its sections are: ${available.map((name) => `"${name}"`).join(', ') || '(none)'}. ` +
        `A surface depends on this section; either its key was removed from the ` +
        `document's blocks or the surface is asking for the wrong one.`
    );
    this.name = 'MissingSectionError';
  }
}

/**
 * The blocks of one section, in order.
 *
 * ## A heading in the section is excluded by default
 *
 * Where a key covers a headed section (`crisis`, `coaching`, `is_not`), the
 * heading block is part of it, because the key names the section and not just
 * its body. Most surfaces label the passage with their own chrome, so they get
 * the body by default. `includeHeading` returns the authored heading as a block,
 * so a surface that shows it (the crisis box) displays her words rather than a
 * literal from a page file. `selectSectionHeading` is the other way, for a
 * heading set beside the prose rather than above it.
 *
 * @throws MissingSectionError when no block carries the key.
 */
export function selectSection(
  document: FoundationalDocumentDetail,
  key: string,
  options: { includeHeading?: boolean } = {}
): Blocks {
  const blocks = document.blocks.filter((block) => block.section === key);

  if (blocks.length === 0) {
    throw new MissingSectionError(document.id, key, document.sections);
  }

  return options.includeHeading ? blocks : blocks.filter((block) => block.type !== 'heading');
}

/**
 * One section's heading, as the document stores it.
 *
 * For a surface that sets the heading BESIDE the prose rather than above it —
 * `/data` puts the coaching heading in its own column.
 *
 * @throws MissingSectionError when no block carries the key, and a plain `Error`
 * when the section has no heading, since a surface that asks for one depends on it.
 */
export function selectSectionHeading(document: FoundationalDocumentDetail, key: string): string {
  const heading = selectSection(document, key, { includeHeading: true }).find(
    (block) => block.type === 'heading'
  );

  if (heading === undefined || heading.type !== 'heading') {
    throw new Error(
      `Section "${key}" of foundational document "${document.id}" has no heading, ` +
        `and a surface sets one beside it.`
    );
  }

  return heading.text;
}

/**
 * The text of a section, as plain strings — one per paragraph or list item.
 *
 * `/data`'s "it is not" column is a row per item with an icon beside it, and the
 * emails set one beat per line. Both are shapes the block renderer does not
 * produce, so they need the text rather than the markup. List blocks flatten
 * into their items, so a section authored either way yields the same strings.
 * Headings are skipped: a section title is not one of its items.
 *
 * A section that yields no text throws too, so a surface never has to check.
 * The key can survive on a heading alone (or, once admins edit blocks, on
 * non-text blocks), and a caller that takes `[0]` would otherwise render
 * `undefined` at the top of the home page with nothing reporting it.
 *
 * @throws MissingSectionError when no block carries the key, and a plain `Error`
 * when the blocks that do carry it hold no text.
 */
export function selectSectionText(document: FoundationalDocumentDetail, key: string): string[] {
  const text = selectSection(document, key).flatMap((block) => {
    if (block.type === 'paragraph') return [block.text];
    if (block.type === 'list') return [...block.items];
    return [];
  });

  if (text.length === 0) {
    throw new Error(
      `Section "${key}" of foundational document "${document.id}" has no paragraph or ` +
        `list text, and a surface renders its text.`
    );
  }

  return text;
}
