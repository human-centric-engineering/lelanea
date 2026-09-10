/**
 * Selecting one named section out of an authored document.
 *
 * ## Why this exists
 *
 * `/data` is a designed page, not a rendering of a whole document. It shows the
 * disclaimer's "what it is / what it is not" columns, its crisis guidance and
 * its coaching-versus-therapy explanation as three separate pieces of the page,
 * with the site's own chrome around each. The full document is at `/disclaimer`.
 *
 * The obvious way to build that page is to retype the seven "Lelañea is not…"
 * lines into a `const` beside the layout. That is precisely the drift
 * `.context/app/content.md` exists to prevent: the moment a string is pasted
 * into JSX it stops tracking the source, and the copy on the most
 * legally-sensitive page in the site is the copy that must never drift.
 *
 * So a page names the section it wants and gets the authored blocks back.
 *
 * ## Sections are found by their heading, and a miss is fatal
 *
 * `selectSection` throws when the heading is not there. That is deliberate and
 * it is the whole design of this module.
 *
 * The alternative — return an empty array — fails silently, and consider what
 * silently means here: `/data` renders its "it is not" column as an empty box
 * under a green tick, and the page that exists so somebody looking for therapy
 * works out before they sign up that this is not it says nothing at all. A 500
 * on a content-integrity failure is loud, correct, and impossible to miss.
 *
 * It cannot reach production either way: `sections.test.ts` pins every heading
 * these pages depend on, so renaming one in the authored JSON fails the suite
 * rather than the page.
 *
 * ## The section ends at the next heading of the same or higher rank
 *
 * Not "the next heading of any kind" — a subsection nested under the one asked
 * for belongs to it, and stopping at the first `h3` would silently truncate.
 * Nothing in the authored files nests today (every heading is level 2); the
 * rule is written for the outline the schema permits rather than the one the
 * current copy happens to have.
 *
 * @see lib/app/content/index.ts — the loader whose frozen documents these are
 * @see .context/app/content.md — the pipeline this is part of
 */

import { getFoundationalDocument, type FoundationalDocumentDetail } from '@/lib/app/content';

/** The blocks of one document, as the loader hands them out. */
type Blocks = FoundationalDocumentDetail['blocks'];

/**
 * A document a page cannot render without.
 *
 * `getFoundationalDocument` returns `null` for an unknown id, which is right
 * for the API route — a caller can ask for anything, and the answer is a 404.
 * A page is not that: it names a constant id that the collection's own
 * referential check already guarantees resolves, so `null` here means the
 * authored file lost a document rather than that somebody typed a bad URL.
 *
 * `notFound()` would be the wrong response to that. It tells a reader the page
 * does not exist, when what has actually happened is that the site's own
 * content is broken — and it does it quietly, on the legal pages, where the
 * quiet version is worst. This throws for the same reason `selectSection` does.
 */
export function requireDocument(id: string): FoundationalDocumentDetail {
  const document = getFoundationalDocument(id);

  if (!document) {
    throw new Error(
      `Authored document "${id}" is missing from content/lelanea_foundational_documents.json. ` +
        `A public page renders it by id; either the document was removed or the id was changed.`
    );
  }

  return document;
}

/**
 * Thrown when a section a page asked for is not in the document.
 *
 * A named class rather than a bare `Error` so a caller that genuinely wants to
 * degrade — nothing does today — can tell a missing section from a bug in the
 * loader, and so the message is one thing rather than assembled at each site.
 */
export class MissingSectionError extends Error {
  constructor(
    readonly documentId: string,
    readonly heading: string,
    available: readonly string[]
  ) {
    super(
      `Authored document "${documentId}" has no section headed "${heading}". ` +
        `Its headings are: ${available.map((text) => `"${text}"`).join(', ')}. ` +
        `A page depends on this section; either the heading was renamed in ` +
        `content/lelanea_foundational_documents.json or the page is asking for the wrong one.`
    );
  }
}

/** Every heading in a document, in authored order — the error's "did you mean". */
export function listSectionHeadings(document: FoundationalDocumentDetail): string[] {
  return document.blocks.filter((block) => block.type === 'heading').map((block) => block.text);
}

/**
 * The blocks of one section.
 *
 * ## The heading is excluded by default, and `includeHeading` is not a
 * convenience
 *
 * `/data` labels its two columns with its own chrome ("it is designed to
 * support", in the palette's green ink), so rendering the document's own `h2`
 * there as well would print a second title in a second size. That is the
 * default.
 *
 * Where the page DOES want the authored heading on screen — the crisis box
 * shows "Crisis Situations" as its title — `includeHeading` returns it as a
 * block, so the words come from the document rather than from a literal in a
 * page file. The distinction matters more than it looks: the heading string is
 * already in the page as the SELECTOR, and rendering that constant instead is
 * how an authored heading quietly becomes a second copy of itself. Selecting by
 * a string and displaying a string are different acts, and only the first one
 * may take a literal.
 *
 * Matching is exact and case-sensitive. A looser match would let a heading
 * drift by a word and keep passing, which is the failure this module is here
 * to make impossible.
 *
 * @throws MissingSectionError when no heading matches.
 */
export function selectSection(
  document: FoundationalDocumentDetail,
  heading: string,
  options: { includeHeading?: boolean } = {}
): Blocks {
  const start = document.blocks.findIndex(
    (block) => block.type === 'heading' && block.text === heading
  );

  if (start === -1) {
    throw new MissingSectionError(document.id, heading, listSectionHeadings(document));
  }

  // Non-null: `start` came from `findIndex` on this array, and the predicate
  // above already narrowed the block at that index to a heading.
  const startBlock = document.blocks[start]!;
  const level = startBlock.type === 'heading' ? startBlock.level : 2;

  const rest = document.blocks.slice(start + 1);
  const end = rest.findIndex((block) => block.type === 'heading' && block.level <= level);
  const body = end === -1 ? rest : rest.slice(0, end);

  return options.includeHeading ? [startBlock, ...body] : body;
}

/** Every paragraph and list item in a document, as plain strings, in order. */
function paragraphs(document: FoundationalDocumentDetail): string[] {
  return document.blocks.flatMap((block) => {
    if (block.type === 'paragraph') return [block.text];
    if (block.type === 'list') return [...block.items];
    return [];
  });
}

/**
 * One paragraph by position — from the start, or from the end when negative.
 *
 * The home page's hero is the first two paragraphs of
 * `the_heart_behind_lelanea` and its quote band is the last two. There are no
 * headings in that document to select by, so position is the only handle; the
 * two ends are the stable part of a document that gains and loses material in
 * the middle, which is why this counts from an end rather than taking a slice
 * out of the interior.
 *
 * It THROWS rather than returning `undefined` for the same reason everything
 * else here does. `beats[7]` on a shortened document renders the string
 * "undefined" into an `h1` in the brand display face, at the top of the site's
 * front page, and nothing anywhere reports it.
 */
export function paragraphAt(document: FoundationalDocumentDetail, index: number): string {
  const all = paragraphs(document);
  const resolved = index < 0 ? all.length + index : index;
  const text = all[resolved];

  if (text === undefined) {
    throw new Error(
      `Authored document "${document.id}" has ${all.length} paragraphs; a page asked for ` +
        `index ${index}. Either the document was shortened or the page is reading the wrong one.`
    );
  }

  return text;
}

/**
 * A contiguous run of paragraphs, `from` up to but not including `to`.
 *
 * ## Selecting by index is fragile, and the remedy is a pinned assertion
 *
 * `the_initiation` has seventy beats and not one heading, so a run of it can
 * only be named by position. Insert a beat near the top and every later index
 * shifts by one — silently, because the result is still a valid run of her
 * prose, just the wrong one.
 *
 * That is a real cost and it is paid the same way `selectSection` pays for
 * heading drift: loudly. `sections.test.ts` pins the opening and closing beat
 * of every range a page uses, so a shifted document fails the suite naming the
 * range rather than shipping a card that quietly starts mid-thought.
 *
 * Prefer `selectSection` wherever a document HAS headings. This is for the one
 * that does not.
 *
 * @throws when the range runs past the end of the document.
 */
export function paragraphRange(
  document: FoundationalDocumentDetail,
  from: number,
  to: number
): string[] {
  const all = paragraphs(document);

  if (from < 0 || to > all.length || from >= to) {
    throw new Error(
      `Authored document "${document.id}" has ${all.length} paragraphs; a page asked for ` +
        `[${from}, ${to}). Either the document changed length or the page is reading the wrong one.`
    );
  }

  return all.slice(from, to);
}

/**
 * The paragraphs of a section, as plain strings.
 *
 * `/data`'s two columns are a row per item with an icon beside it, which is a
 * shape the block renderer does not produce — so that page needs the text
 * rather than the markup. The seven "Lelañea is **not** a medical application."
 * lines are authored as seven separate paragraphs, not as a list block, which
 * is the reconciliation finding behind this function existing at all.
 *
 * List blocks are flattened into their items so a section authored either way
 * yields the same strings; a heading inside the section is skipped, since a
 * subsection title is not one of the items.
 */
export function selectSectionText(document: FoundationalDocumentDetail, heading: string): string[] {
  return paragraphs({ ...document, blocks: selectSection(document, heading) });
}
