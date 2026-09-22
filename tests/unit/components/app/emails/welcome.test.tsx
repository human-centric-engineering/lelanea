// @vitest-environment happy-dom

/**
 * The welcome email — her words, verbatim, then the build's two lines and one
 * action.
 *
 * `BRAND` is pinned to "unconfigured" for every test file (`tests/setup.ts`,
 * #661), so `BRAND.name` reads "Sunrise" here and the product's name is
 * asserted through `BRAND.name` rather than as a literal. The authored beats
 * are different: "Welcome to Lelañea." is in the JSON, not the seam, and is
 * asserted literally — that is the point of the test.
 *
 * @see components/app/emails/welcome.tsx
 */

import { render } from '@react-email/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Her documents are read from the database since t-86. This serves exactly the
// rows the seed writes, through the real projection.
vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);

import { applyFirstName } from '@/components/app/content/authored-document';
import WelcomeEmail, { firstNameFrom, WELCOME_SECTION } from '@/components/app/emails/welcome';
import * as sections from '@/lib/app/content/sections';
import { requireDocument, selectSectionText } from '@/lib/app/content/sections';
import { fakeDocumentStore, rewriteSection } from '@/tests/helpers/app/foundational-documents';
import { BRAND } from '@/lib/brand';

// Real module, spied: the failure-domain case below needs to know WHEN the
// loader is read, not to change what it returns.
vi.mock('@/lib/app/content/sections', { spy: true });

beforeEach(() => {
  vi.mocked(sections.requireDocument).mockClear();
  fakeDocumentStore().reset();
});

const PROPS = {
  userName: 'Maya Reyes',
  userEmail: 'maya@example.com',
  baseUrl: 'https://example.com',
};

describe('WelcomeEmail — the greeting is the Initiation, by position', () => {
  it('quotes the section from the greeting to the product name', async () => {
    // Since t-86 the greeting is a section key stored on the blocks, so a beat
    // inserted above it cannot shift it. What is pinned is that the key still
    // marks the passage the email was written around.
    const beats = selectSectionText(await requireDocument('the_initiation'), WELCOME_SECTION);
    expect(beats[0]).toBe('Welcome, {{first_name}}.');
    expect(beats[beats.length - 1]).toBe('Welcome to Lelañea.');
    expect(beats).toHaveLength(7);
  });

  it('renders every beat of the range, each as its own paragraph, and nothing past it', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    const beats = selectSectionText(await requireDocument('the_initiation'), WELCOME_SECTION);

    for (const beat of beats) {
      expect(html).toContain(escapeForHtml(applyFirstName(beat, 'Maya')));
    }
    // One beat per <p>: the document's `renderStyle: 'cadence'`. Two beats in one
    // paragraph is the merge the render note forbids.
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs.length).toBeGreaterThanOrEqual(beats.length);
    // The eighth beat is where the run stops.
    // The first beat of the next section.
    const [eighth] = selectSectionText(await requireDocument('the_initiation'), 'invitation');
    expect(html).not.toContain(escapeForHtml(eighth));
  });

  it('addresses the reader by first name only', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    expect(html).toContain('Welcome, Maya.');
    expect(html).not.toContain('Welcome, Maya Reyes.');
  });

  it('closes over the gap when the account has no name — including the platform’s “User” stand-in', async () => {
    // `lib/auth/config.ts` passes `user.name || 'User'`, never null. A greeting
    // of "Welcome, User." is the platform's word, not hers, so the stand-in is
    // treated as no name and D7's fallback applies.
    const html = await render(<WelcomeEmail {...PROPS} userName="User" />);
    expect(html).toContain('Welcome.');
    expect(html).not.toContain('Welcome, User');
    expect(html).not.toContain('{{first_name}}');
  });
});

describe('WelcomeEmail — where a loader failure would land', () => {
  it('greets from the DATABASE row, not the file', async () => {
    // t-86: a stored row that differs from the file is what the email sends.
    fakeDocumentStore().editBlocks('the_initiation', (blocks) =>
      rewriteSection(blocks, WELCOME_SECTION, (index) => `Edited greeting ${index}.`)
    );

    const html = await render(<WelcomeEmail {...PROPS} />);

    expect(html).toContain('Edited greeting 0.');
    expect(html).not.toContain('I am so incredibly grateful');
  });

  it('reads the document during render, not when the template is called as a function', async () => {
    // `resolveEmailTemplate` invokes the template as a plain function while the
    // argument to `sendEmail()` is still being built — before the `.catch()`
    // the signup after-hook relies on. A loader throw there would abort account
    // creation. Reading inside a child component moves it into `render()`,
    // which runs inside `sendEmail`'s own try: a failed welcome, not a failed
    // signup.
    const element = WelcomeEmail(PROPS);
    expect(sections.requireDocument).not.toHaveBeenCalled();

    await render(element);
    expect(sections.requireDocument).toHaveBeenCalledWith('the_initiation');
  });
});

describe('firstNameFrom', () => {
  it.each([
    ['Maya Reyes', 'Maya'],
    ['Maya', 'Maya'],
    ['  Maya   Reyes  ', 'Maya'],
    ['User', null],
    ['', null],
    ['   ', null],
  ])('%j → %j', (input, expected) => {
    expect(firstNameFrom(input)).toBe(expected);
  });

  it('does not treat a person actually called User-something as the stand-in', () => {
    expect(firstNameFrom('Userwald Smith')).toBe('Userwald');
  });
});

describe('WelcomeEmail — the build’s part', () => {
  it('has one action, into the app, and the pasted-link fallback', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    expect(html).toContain('href="https://example.com/app"');
    expect(html).toContain('Begin');
    expect((html.match(/href="https:\/\/example\.com\/app"/g) ?? []).length).toBe(2);
    // Not the platform's destination.
    expect(html).not.toContain('/dashboard');
  });

  it('carries the chrome: the lotus from the app origin, the wordmark, the reason, the legal line', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    expect(html).toContain('src="https://example.com/lotus-mark.png"');
    expect(html).toContain(`Welcome to ${BRAND.name}.`); // preview
    expect(html).toContain('maya@example.com');
    expect(html).toContain(BRAND.legalName);
  });

  it('says nothing the platform template said', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    for (const phrase of ['starter template', 'Get Started', 'excited to have you', 'dashboard']) {
      expect(html.toLowerCase()).not.toContain(phrase.toLowerCase());
    }
  });

  it('is a complete HTML document', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    expect(html).toContain('<!DOCTYPE html');
    expect(html).toContain('lang="en"');
  });
});

/** React Email escapes text the way React does; match what the wire carries. */
function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
