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
import { describe, expect, it } from 'vitest';

import { applyFirstName } from '@/components/app/content/authored-document';
import WelcomeEmail, { firstNameFrom, WELCOME_BEATS } from '@/components/app/emails/welcome';
import { paragraphRange, requireDocument } from '@/lib/app/content/sections';
import { BRAND } from '@/lib/brand';

const PROPS = {
  userName: 'Maya Reyes',
  userEmail: 'maya@example.com',
  baseUrl: 'https://example.com',
};

describe('WelcomeEmail — the greeting is the Initiation, by position', () => {
  it('pins the range to its first and last beat, so an inserted beat fails here', () => {
    // The same protection `sections.test.ts` gives the landing page's excerpts:
    // `the_initiation` has no headings, so a run of it can only be named by
    // index, and an index is silently wrong the moment a beat is inserted
    // upstream. Pin both ends.
    const beats = paragraphRange(
      requireDocument('the_initiation'),
      WELCOME_BEATS.from,
      WELCOME_BEATS.to
    );
    expect(beats[0]).toBe('Welcome, {{first_name}}.');
    expect(beats[beats.length - 1]).toBe('Welcome to Lelañea.');
    expect(beats).toHaveLength(7);
  });

  it('renders every beat of the range, each as its own paragraph, and nothing past it', async () => {
    const html = await render(<WelcomeEmail {...PROPS} />);
    const beats = paragraphRange(
      requireDocument('the_initiation'),
      WELCOME_BEATS.from,
      WELCOME_BEATS.to
    );

    for (const beat of beats) {
      expect(html).toContain(escapeForHtml(applyFirstName(beat, 'Maya')));
    }
    // One beat per <p>: the document's `renderStyle: 'cadence'`. Two beats in one
    // paragraph is the merge the render note forbids.
    const paragraphs = html.match(/<p[^>]*>/g) ?? [];
    expect(paragraphs.length).toBeGreaterThanOrEqual(beats.length);
    // The eighth beat is where the run stops.
    const eighth = paragraphRange(requireDocument('the_initiation'), 7, 8)[0];
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
