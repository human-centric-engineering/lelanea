/**
 * Selecting parts of a stored document by section key, and the keys the
 * surfaces select by.
 *
 * Two jobs, and the second is the one that matters more.
 *
 * The first is ordinary: `requireDocument`, `selectSection`,
 * `selectSectionHeading` and `selectSectionText` behave as documented,
 * including at the edges.
 *
 * The second is that **every key a surface selects by resolves to the passage
 * it showed before t-86**. The home page, `/data` and both emails used to cut
 * her text by paragraph index, heading text and a regex. The seed now puts the
 * owner's keys on the blocks, and these cases pin the opening and closing words
 * of each key's passage. A key that drifted would render valid prose in the
 * wrong place, and nothing else would notice.
 *
 * ## Pinned to the SEEDED content, not to a fixture
 *
 * The document store is replaced by the fake in
 * `tests/helpers/app/foundational-documents.ts`, which holds exactly the rows the
 * real seed builds from `content/lelanea_foundational_documents.json`, through
 * the real row projection. Only the query is faked.
 *
 * FORK NOTE: a fork with its own authored content should expect the last
 * `describe` block to fail wholesale. Those are its own page-to-content
 * couplings, and they need rewriting to name its own keys, not deleting.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);

import {
  MissingSectionError,
  requireDocument,
  selectSection,
  selectSectionHeading,
  selectSectionText,
} from '@/lib/app/content/sections';
import { fakeDocumentStore } from '@/tests/helpers/app/foundational-documents';

const store = fakeDocumentStore();
const disclaimer = () => requireDocument('disclaimer');

beforeEach(() => store.reset());

describe('requireDocument', () => {
  it('returns the stored document', async () => {
    const document = await requireDocument('disclaimer');

    expect(document.id).toBe('disclaimer');
    expect(document.blocks.length).toBe(document.blockCount);
  });

  it('throws on an id the database does not have, naming it', async () => {
    await expect(requireDocument('the_missing_one')).rejects.toThrow(/the_missing_one/);
  });

  it('throws on an unseeded database, pointing at the seed', async () => {
    store.empty();

    await expect(requireDocument('disclaimer')).rejects.toThrow(/db:seed/);
  });
});

describe('selectSection', () => {
  it('returns a keyed section without its heading by default', async () => {
    const blocks = selectSection(await disclaimer(), 'crisis');

    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.some((block) => block.type === 'heading')).toBe(false);
    expect(blocks[0]).toMatchObject({ type: 'paragraph', section: 'crisis' });
  });

  it('includes the heading when asked, as the first block', async () => {
    const blocks = selectSection(await disclaimer(), 'crisis', { includeHeading: true });

    expect(blocks[0]).toMatchObject({ type: 'heading', text: 'Crisis Situations' });
    expect(blocks.slice(1).some((block) => block.type === 'heading')).toBe(false);
  });

  it('returns only the blocks carrying the key, not the rest of the document', async () => {
    const document = await disclaimer();
    const crisis = selectSection(document, 'crisis');

    expect(crisis.length).toBeLessThan(document.blocks.length);
    // The section after crisis is Spiritual Perspectives; none of its text may
    // leak in. A content assertion, because a length is satisfied by stopping
    // anywhere.
    const text = crisis.map((block) => (block.type === 'paragraph' ? block.text : '')).join(' ');
    expect(text).not.toContain('Advaita Vedanta');
  });

  it('carries the crisis list, which is the reason the crisis box has one', async () => {
    const list = selectSection(await disclaimer(), 'crisis').find((block) => block.type === 'list');

    expect(list?.type === 'list' && list.items).toContain('thoughts of suicide;');
  });

  it('throws a MissingSectionError naming the keys the document does have', async () => {
    const document = await disclaimer();
    let thrown: unknown;
    try {
      selectSection(document, 'crises');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MissingSectionError);
    expect((thrown as Error).message).toContain('"crises"');
    // The "did you mean" half.
    expect((thrown as Error).message).toContain('"crisis"');
  });

  it('follows the key rather than a position, so a block inserted above moves nothing', async () => {
    // What keys buy over the paragraph indexes they replaced. An admin inserting
    // a paragraph at the top of the disclaimer shifted every index the old /data
    // and home page used. It must not shift a key.
    const before = selectSectionText(await disclaimer(), 'commitment');
    store.editBlocks('disclaimer', (blocks) => [
      { type: 'paragraph', text: 'Inserted above everything.', section: null },
      ...blocks,
    ]);

    expect(selectSectionText(await disclaimer(), 'commitment')).toEqual(before);
  });
});

describe('selectSectionHeading', () => {
  it("returns the section's heading as stored", async () => {
    expect(selectSectionHeading(await disclaimer(), 'coaching')).toBe(
      'Coaching Is Different from Therapy'
    );
  });

  it('throws when the section has no heading', async () => {
    const document = await disclaimer();

    expect(() => selectSectionHeading(document, 'commitment')).toThrow(/no heading/);
  });
});

describe('selectSectionText', () => {
  it('flattens paragraphs into strings, in order, keeping the bold markers', async () => {
    const lines = selectSectionText(await disclaimer(), 'is_not');

    expect(lines[0]).toBe('Lelañea is **not** a medical application.');
    // `/data` renders these through `InlineText`, which turns `**not**` into a
    // `<strong>`. Stripping here would flatten the one word the page exists for.
    expect(lines[0]).toContain('**not**');
  });

  it('flattens a list into its items', async () => {
    const lines = selectSectionText(await disclaimer(), 'crisis');

    expect(lines).toContain('thoughts of suicide;');
  });
});

/**
 * The couplings between a surface and the seeded keys.
 *
 * Everything above tests the functions. This tests that the keys still mark the
 * passages each surface showed before t-86, which is what breaks when nobody has
 * touched any code.
 */
describe('the keys the surfaces select by', () => {
  it("/data's 'it is not' column is exactly the seven items, and the qualifier is apart", async () => {
    // The section is eight paragraphs under its heading: seven "Lelañea is
    // **not** a…" lines and a qualifier. Rendering all eight as rows read as an
    // eighth thing Lelañea is not. Both counts are pinned.
    const document = await disclaimer();
    const items = selectSectionText(document, 'is_not');
    const context = selectSectionText(document, 'is_not_context');

    expect(items).toHaveLength(7);
    expect(items.every((line) => line.startsWith('Lelañea is **not** '))).toBe(true);
    expect(context).toHaveLength(1);
    expect(context[0]).toMatch(/^Although some concepts/);
  });

  it("/data's purpose column holds no negation, and the negation is its own key", async () => {
    // Under a green tick reading "it is designed to support", a negation says
    // the opposite of its label.
    const document = await disclaimer();
    const purpose = selectSectionText(document, 'purpose');

    expect(purpose).toHaveLength(3);
    expect(purpose.every((line) => !line.startsWith('Lelañea is not'))).toBe(true);
    expect(selectSectionText(document, 'purpose_limits')).toEqual([
      'Lelañea is not intended to provide healthcare, mental healthcare, psychotherapy, or crisis intervention.',
    ]);
  });

  it("the home page's three cards start and end where they did", async () => {
    const initiation = await requireDocument('the_initiation');

    const invitation = selectSectionText(initiation, 'invitation');
    expect(invitation[0]).toBe('This is not simply an app.');
    expect(invitation.at(-1)).toContain('magnificent intelligence');
    expect(invitation).toHaveLength(3);

    const guide = selectSectionText(initiation, 'guide');
    expect(guide[0]).toBe('My role is not to tell you who you are.');
    expect(guide.at(-1)).toBe('There is nothing you are required to believe.');
    expect(guide).toHaveLength(9);

    const commitment = selectSectionText(await disclaimer(), 'commitment');
    expect(commitment).toEqual([
      'Lelañea was created with deep respect for both contemplative wisdom and modern healthcare.',
      expect.stringContaining('not to replace licensed professionals'),
    ]);
  });

  it("the home page's hero and band are the philosophy document's two ends", async () => {
    const philosophy = await requireDocument('the_heart_behind_lelanea');

    expect(selectSectionText(philosophy, 'invitation')).toEqual([
      'Lelañea was created as an invitation into conscious living.',
    ]);
    expect(selectSectionText(philosophy, 'purpose')[0]).toContain(
      'remembering who they are beneath conditioning'
    );
    expect(selectSectionText(philosophy, 'remembrance')).toEqual([
      'Transformation is not viewed as becoming someone new.',
      'It is the continual remembrance of who we have always been.',
    ]);
  });

  it('the welcome email is the seven beats ending on the product name', async () => {
    const welcome = selectSectionText(await requireDocument('the_initiation'), 'welcome');

    expect(welcome).toHaveLength(7);
    expect(welcome[0]).toBe('Welcome, {{first_name}}.');
    expect(welcome.at(-1)).toBe('Welcome to Lelañea.');
  });
});
