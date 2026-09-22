// @vitest-environment happy-dom

/**
 * The waitlist confirmation — what they have joined in her words, what happens
 * next in ours, no date, no way off, and a footer that tells a stranger why.
 *
 * `BRAND` is pinned to "unconfigured" for the suite (#661); the product's name
 * is asserted through `BRAND.name`. The authored beats are in the JSON and are
 * asserted literally.
 *
 * @see components/app/emails/waitlist-confirmation.tsx
 */

import { render } from '@react-email/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Her documents are read from the database since t-86. This serves exactly the
// rows the seed writes, through the real projection.
vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);

import WaitlistConfirmationEmail, {
  CONFIRMATION_SECTION,
  firstNameOf,
} from '@/components/app/emails/waitlist-confirmation';
import * as sections from '@/lib/app/content/sections';
import { requireDocument, selectSectionText } from '@/lib/app/content/sections';
import { fakeDocumentStore, rewriteSection } from '@/tests/helpers/app/foundational-documents';
import { BRAND } from '@/lib/brand';

vi.mock('@/lib/app/content/sections', { spy: true });

beforeEach(() => {
  vi.mocked(sections.requireDocument).mockClear();
  fakeDocumentStore().reset();
});

const PROPS = { name: 'Ada Lovelace', email: 'ada@example.com', baseUrl: 'https://example.com' };

describe('WaitlistConfirmationEmail — what they have joined, in her words', () => {
  it('quotes the section whose first and last beat are the invitation', async () => {
    const beats = selectSectionText(await requireDocument('the_initiation'), CONFIRMATION_SECTION);
    expect(beats[0]).toBe('This is not simply an app.');
    expect(beats[1]).toBe('It is an invitation.');
    expect(beats[beats.length - 1]).toMatch(/^An invitation to explore/);
    expect(beats).toHaveLength(3);
  });

  it('renders the three beats, and not the greeting that precedes them', async () => {
    const html = await render(<WaitlistConfirmationEmail {...PROPS} />);
    expect(html).toContain('This is not simply an app.');
    expect(html).toContain('It is an invitation.');
    expect(html).toContain('An invitation to explore');
    // The line before the range greets someone who has arrived. A joiner has not.
    expect(html).not.toContain('Welcome to Lelañea.');
    expect(html).not.toContain('{{first_name}}');
  });

  it('quotes the DATABASE row, not the file', async () => {
    // t-86: a stored row that differs from the file is what the email sends.
    fakeDocumentStore().editBlocks('the_initiation', (blocks) =>
      rewriteSection(blocks, CONFIRMATION_SECTION, (index) => `Edited beat ${index}.`)
    );

    const html = await render(<WaitlistConfirmationEmail {...PROPS} />);

    expect(html).toContain('Edited beat 0.');
    expect(html).toContain('Edited beat 2.');
    expect(html).not.toContain('This is not simply an app.');
  });

  it('reads the document during render, not when called as a function', async () => {
    const element = WaitlistConfirmationEmail(PROPS);
    expect(sections.requireDocument).not.toHaveBeenCalled();
    await render(element);
    expect(sections.requireDocument).toHaveBeenCalledWith('the_initiation');
  });
});

describe('firstNameOf', () => {
  it.each([
    ['Ada Lovelace', 'Ada'],
    ['Zoë', 'Zoë'],
    ['Núria Pérez-Bosch', 'Núria'],
    ["O'Brien", "O'Brien"],
    ['李 明', '李'],
    ['', null],
    ['   ', null],
    [null, null],
    ['https://evil.example/claim', null],
    ['ada@example.com', null],
    ['Click here: free', 'Click'], // a plain word; the sentence never follows it
    ['x'.repeat(41), null],
    ['Ada1', null],
    ['<b>Ada</b>', null],
    ['---', null],
    ["''", null],
    ['-Ada', null],
  ])('%j → %j', (input, expected) => {
    expect(firstNameOf(input)).toBe(expected);
  });
});

describe('WaitlistConfirmationEmail — what happens next, in ours', () => {
  it('addresses them by first name when one was given, and plainly when not', async () => {
    expect(await render(<WaitlistConfirmationEmail {...PROPS} />)).toContain(
      'Ada, you are on the list.'
    );
    expect(await render(<WaitlistConfirmationEmail {...PROPS} name={null} />)).toContain(
      'You are on the list.'
    );
    expect(await render(<WaitlistConfirmationEmail {...PROPS} name="   " />)).toContain(
      'You are on the list.'
    );
  });

  it('reflects nothing that is not a first name — a URL as a name gets the plain greeting', async () => {
    // The address is unverified and the sender is ours: a "name" of
    // https://evil.example/claim would arrive as a clickable link at the top
    // of a branded email to someone who never typed it. React escapes HTML;
    // it cannot stop a mail client auto-linking a bare URL.
    const html = await render(
      <WaitlistConfirmationEmail {...PROPS} name="https://evil.example/claim" />
    );
    expect(html).not.toContain('evil.example');
    expect(html).toContain('You are on the list.');
  });

  it('promises to write when we open, admits there is no date, and invents none', async () => {
    const html = await render(<WaitlistConfirmationEmail {...PROPS} />);
    expect(html).toContain('We do not have a date yet');
    expect(html).toContain('this is the only email you will get from us');
    // A month, a year, a "Q4" — any of them would be invented. Digits live in
    // the head (the dark-mode colours) and in markup, never in the body's text.
    const body = html.slice(html.indexOf('<body'));
    const text = body.replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ');
    expect(text).not.toMatch(/\d/);
  });

  it('has no unsubscribe, preferences or opt-out — owner ruling', async () => {
    const html = await render(<WaitlistConfirmationEmail {...PROPS} />);
    for (const word of ['unsubscribe', 'preferences', 'opt out', 'opt-out', 'manage your']) {
      expect(html.toLowerCase()).not.toContain(word);
    }
    // And no action at all: one acknowledgement is the whole email.
    expect(html).not.toMatch(/<a [^>]*href="https:\/\/example\.com\/(app|login|signup)/);
  });

  it('tells a stranger why it arrived, and that nothing more will', async () => {
    // The address is unverified: someone else may have typed it.
    const html = await render(<WaitlistConfirmationEmail {...PROPS} />);
    expect(html).toContain('ada@example.com was added to the');
    expect(html).toContain('If that was not you, nothing more will come');
  });

  it('carries the chrome', async () => {
    const html = await render(<WaitlistConfirmationEmail {...PROPS} />);
    expect(html).toContain('src="https://example.com/lotus-mark.png"');
    expect(html).toContain(`You are on the ${BRAND.name} list.`);
    expect(html).toContain(BRAND.legalName);
  });
});
