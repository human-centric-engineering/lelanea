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

import WaitlistConfirmationEmail, {
  CONFIRMATION_BEATS,
} from '@/components/app/emails/waitlist-confirmation';
import * as sections from '@/lib/app/content/sections';
import { paragraphRange, requireDocument } from '@/lib/app/content/sections';
import { BRAND } from '@/lib/brand';

vi.mock('@/lib/app/content/sections', { spy: true });

beforeEach(() => {
  vi.mocked(sections.requireDocument).mockClear();
});

const PROPS = { name: 'Ada Lovelace', email: 'ada@example.com', baseUrl: 'https://example.com' };

describe('WaitlistConfirmationEmail — what they have joined, in her words', () => {
  it('pins the range to its first and last beat', () => {
    const beats = paragraphRange(
      requireDocument('the_initiation'),
      CONFIRMATION_BEATS.from,
      CONFIRMATION_BEATS.to
    );
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

  it('reads the document during render, not when called as a function', async () => {
    const element = WaitlistConfirmationEmail(PROPS);
    expect(sections.requireDocument).not.toHaveBeenCalled();
    await render(element);
    expect(sections.requireDocument).toHaveBeenCalledWith('the_initiation');
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
