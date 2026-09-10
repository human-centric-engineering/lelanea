/**
 * Selecting parts of an authored document, and the handles the pages select by.
 *
 * Two jobs, and the second is the one that matters more.
 *
 * The first is ordinary: `selectSection`, `paragraphAt` and `paragraphRange`
 * behave as documented, including at the edges.
 *
 * The second is that **every handle a public page selects by still resolves**.
 * `/data` names four disclaimer headings, the home page names three paragraph
 * ranges, and both are the kind of coupling that breaks silently when somebody
 * edits the authored JSON — a renamed heading, a beat inserted near the top.
 * `sections.ts` is built to fail loudly at that, and these cases are what turn
 * "loudly at render" into "loudly in CI, naming the range".
 *
 * ## Pinned to the CONTENT, not to a fixture
 *
 * These read `content/lelanea_foundational_documents.json` through the real
 * loader rather than a synthetic document. A fixture would test the functions
 * and prove nothing about the coupling — which is the entire point of the
 * second half of this file.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE
 * ---------------------------------------------------------------------------
 * This reads the REAL `@/lib/app/content` seam and cannot usefully be mocked.
 * Half of it exists to assert facts about the content itself — that the
 * disclaimer still has a section headed "Crisis Situations", that
 * `the_initiation`'s beat 51 is still where the home page thinks it is — and a
 * fixture would assert those about a document nobody ships.
 *
 * A fork with its own authored content should expect the second `describe`
 * block ("the handles the public pages select by") to fail wholesale, and that
 * is the file working: those cases are the fork's own page-to-content
 * couplings, and they need rewriting to name the fork's headings and ranges,
 * not deleting. The first half — `selectSection`, `paragraphAt`,
 * `paragraphRange` behaviour — is generic apart from the strings it happens to
 * assert on, and is worth keeping with those swapped.
 *
 * A fork that dropped the authored-content pipeline should delete this file
 * along with `lib/app/content/sections.ts`, which has no other consumer.
 */

import { describe, expect, it } from 'vitest';

import { getFoundationalDocument, type FoundationalDocumentDetail } from '@/lib/app/content';
import {
  MissingSectionError,
  listSectionHeadings,
  paragraphAt,
  paragraphRange,
  requireDocument,
  selectSection,
  selectSectionText,
} from '@/lib/app/content/sections';

const disclaimer = (): FoundationalDocumentDetail => requireDocument('disclaimer');

describe('requireDocument', () => {
  it('returns the document the loader returns', () => {
    expect(requireDocument('disclaimer')).toBe(getFoundationalDocument('disclaimer'));
  });

  it('throws on an id the collection does not have, naming it', () => {
    expect(() => requireDocument('the_missing_one')).toThrow(/the_missing_one/);
  });
});

describe('selectSection', () => {
  it('returns the blocks under a heading, without the heading', () => {
    const blocks = selectSection(disclaimer(), 'Crisis Situations');

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((block) => block.type === 'heading')).toBe(false);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
  });

  it('includes the heading when asked, as the first block', () => {
    const blocks = selectSection(disclaimer(), 'Crisis Situations', { includeHeading: true });

    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Crisis Situations' });
    expect(blocks.slice(1).some((block) => block.type === 'heading')).toBe(false);
  });

  it('stops at the next heading rather than running to the end', () => {
    const crisis = selectSection(disclaimer(), 'Crisis Situations');
    const all = disclaimer().blocks;

    expect(crisis.length).toBeLessThan(all.length);
    // The section that FOLLOWS crisis is Spiritual Perspectives; none of its
    // text may leak in. Written as a content assertion rather than a length
    // one, because a length is satisfied by stopping anywhere.
    const text = crisis.map((block) => (block.type === 'paragraph' ? block.text : '')).join(' ');
    expect(text).not.toContain('Advaita Vedanta');
  });

  it('carries the crisis list, which is the reason the crisis box has one', () => {
    // A `list` block inside a selected section reaches the caller intact. If
    // this regressed, `/data`'s crisis box would render the surrounding
    // sentences and silently drop the ten conditions between them.
    const blocks = selectSection(disclaimer(), 'Crisis Situations');
    const list = blocks.find((block) => block.type === 'list');

    expect(list).toBeDefined();
    expect(list?.type === 'list' && list.items).toContain('thoughts of suicide;');
  });

  it('throws a MissingSectionError naming the headings it does have', () => {
    let thrown: unknown;
    try {
      selectSection(disclaimer(), 'Crisis Situation');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MissingSectionError);
    expect((thrown as Error).message).toContain('Crisis Situation');
    // The "did you mean" half — without it the error says what is wrong and
    // nothing about what to write instead.
    expect((thrown as Error).message).toContain('Crisis Situations');
  });

  it('matches exactly, so a heading that drifts by case does not silently pass', () => {
    expect(() => selectSection(disclaimer(), 'crisis situations')).toThrow(MissingSectionError);
  });
});

describe('selectSectionText', () => {
  it('flattens paragraphs and list items into strings, in order', () => {
    const lines = selectSectionText(disclaimer(), 'What Lelañea Is Not');

    expect(lines[0]).toBe('Lelañea is **not** a medical application.');
    expect(lines).toContain(
      'Lelañea is **not** a substitute for professional medical or mental healthcare.'
    );
  });

  it('keeps the bold markers rather than stripping them', () => {
    // `/data` renders these through `InlineText`, which is what turns `**not**`
    // into a `<strong>`. Stripping here would silently flatten the emphasis the
    // author put on the one word the page exists for.
    const lines = selectSectionText(disclaimer(), 'What Lelañea Is Not');

    expect(lines[0]).toContain('**not**');
  });

  it('splits into seven items and one qualifying note, as /data renders them', () => {
    // The section is EIGHT paragraphs: seven "Lelañea is **not** a…" lines and
    // a closing qualifier about concepts the app references without endorsing.
    // `/data` puts the seven in the crossed column and the qualifier beneath
    // it; the first version rendered all eight as rows, which read as an eighth
    // thing Lelañea is not.
    //
    // Both counts are pinned. Seven catches an item being lost; one catches an
    // item being added and silently landing in the note instead of the column.
    const isNotItem = /^Lelañea is \*\*not\*\* /;
    const lines = selectSectionText(disclaimer(), 'What Lelañea Is Not');

    expect(lines.filter((line) => isNotItem.test(line))).toHaveLength(7);
    expect(lines.filter((line) => !isNotItem.test(line))).toHaveLength(1);
  });
});

describe('paragraphAt', () => {
  const philosophy = (): FoundationalDocumentDetail => requireDocument('the_heart_behind_lelanea');

  it('counts from the start', () => {
    expect(paragraphAt(philosophy(), 0)).toBe(
      'Lelañea was created as an invitation into conscious living.'
    );
  });

  it('counts from the end when negative', () => {
    expect(paragraphAt(philosophy(), -1)).toBe(
      'It is the continual remembrance of who we have always been.'
    );
  });

  it('throws past either end, naming the length', () => {
    expect(() => paragraphAt(philosophy(), 999)).toThrow(/999/);
    expect(() => paragraphAt(philosophy(), -999)).toThrow(/-999/);
  });
});

describe('paragraphRange', () => {
  it('returns a half-open range', () => {
    const beats = paragraphRange(requireDocument('the_initiation'), 7, 10);

    expect(beats).toEqual(['This is not simply an app.', 'It is an invitation.', beats[2]]);
    expect(beats).toHaveLength(3);
  });

  it('throws on an inverted or out-of-bounds range', () => {
    const doc = requireDocument('the_initiation');

    expect(() => paragraphRange(doc, 10, 7)).toThrow();
    expect(() => paragraphRange(doc, 0, 9999)).toThrow();
    expect(() => paragraphRange(doc, -1, 3)).toThrow();
  });
});

/**
 * The couplings between a page and the authored file.
 *
 * Everything above tests the functions. This tests the CONTENT still fits the
 * pages, which is the part that breaks when nobody has touched any code.
 */
describe('the handles the public pages select by', () => {
  it('/data finds all four disclaimer sections it renders', () => {
    const doc = disclaimer();

    for (const heading of [
      'The Purpose of Lelañea',
      'What Lelañea Is Not',
      'Crisis Situations',
      'Coaching Is Different from Therapy',
    ]) {
      expect(listSectionHeadings(doc), `"${heading}" is gone from the disclaimer`).toContain(
        heading
      );
      expect(selectSection(doc, heading).length).toBeGreaterThan(0);
    }
  });

  it("the home page's three card ranges still start and end where it thinks", () => {
    // The fragility `paragraphRange` documents, made loud. A beat inserted
    // anywhere above index 7 in `the_initiation` shifts all three ranges, and
    // the cards would render her prose starting mid-thought — valid text, wrong
    // text, and nothing else would notice.
    const initiation = requireDocument('the_initiation');
    const disclosures = disclaimer();

    const invitation = paragraphRange(initiation, 7, 10);
    expect(invitation[0]).toBe('This is not simply an app.');
    expect(invitation.at(-1)).toContain('magnificent intelligence');

    const guide = paragraphRange(initiation, 51, 60);
    expect(guide[0]).toBe('My role is not to tell you who you are.');
    expect(guide.at(-1)).toBe('There is nothing you are required to believe.');

    const healthcare = paragraphRange(disclosures, 72, 74);
    expect(healthcare[0]).toBe(
      'Lelañea was created with deep respect for both contemplative wisdom and modern healthcare.'
    );
    expect(healthcare.at(-1)).toContain('not to replace licensed professionals');
  });

  it('the purpose section still ends on the negation /data moves out of the column', () => {
    // `/data` renders all but the last paragraph under a green tick reading
    // "it is designed to support", and the last one beneath both columns. If a
    // paragraph were appended to this section, the negation would silently move
    // back INTO the tick column and the new one would take its place below.
    const purpose = selectSectionText(disclaimer(), 'The Purpose of Lelañea');

    expect(purpose.at(-1)).toBe(
      'Lelañea is not intended to provide healthcare, mental healthcare, psychotherapy, or crisis intervention.'
    );
    expect(purpose.slice(0, -1).every((line) => !line.startsWith('Lelañea is not'))).toBe(true);
  });

  it("the home page's hero and band still bracket the philosophy document", () => {
    const philosophy = requireDocument('the_heart_behind_lelanea');

    expect(paragraphAt(philosophy, 0)).toContain('invitation into conscious living');
    expect(paragraphAt(philosophy, 1)).toContain('remembering who they are beneath conditioning');
    expect(paragraphAt(philosophy, -2)).toContain('not viewed as becoming someone new');
    expect(paragraphAt(philosophy, -1)).toContain('continual remembrance');
  });
});
