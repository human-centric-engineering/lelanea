/**
 * The waitlist schemas — what reaches the table, and what a visitor is told.
 *
 * Two properties matter beyond "it validates". The email is normalised, which is
 * what makes the table's unique index mean one person rather than one spelling.
 * And a blank optional field becomes `undefined`, so a question somebody skipped
 * is stored as NULL rather than as an empty string that reads like an answer.
 *
 * @see lib/validations/app-waitlist.ts
 */

import { describe, it, expect } from 'vitest';

import {
  waitlistSchema,
  waitlistClientSchema,
  waitlistWithHoneypotSchema,
} from '@/lib/validations/app-waitlist';

describe('waitlistSchema', () => {
  it('accepts an email on its own — the other three are optional (D2)', () => {
    const parsed = waitlistSchema.parse({ email: 'ada@example.com' });

    expect(parsed).toEqual({
      email: 'ada@example.com',
      name: undefined,
      heardFrom: undefined,
      intent: undefined,
    });
  });

  it('lower-cases and trims the email', () => {
    // `@unique` on a raw column is case-SENSITIVE, so without this "Ada@…" and
    // "ada@…" are two rows and one person is on the list twice.
    expect(waitlistSchema.parse({ email: '  Ada@Example.COM  ' }).email).toBe('ada@example.com');
  });

  it.each([
    ['a blank string', ''],
    ['whitespace only', '   '],
  ])('turns %s in an optional field into undefined, not an empty value', (_why, value) => {
    const parsed = waitlistSchema.parse({
      email: 'ada@example.com',
      name: value,
      heardFrom: value,
      intent: value,
    });

    expect(parsed.name).toBeUndefined();
    expect(parsed.heardFrom).toBeUndefined();
    expect(parsed.intent).toBeUndefined();
  });

  it('trims a real answer rather than discarding it', () => {
    const parsed = waitlistSchema.parse({ email: 'ada@example.com', intent: '  to slow down  ' });

    expect(parsed.intent).toBe('to slow down');
  });

  it.each([
    ['a missing email', {}],
    ['an empty email', { email: '' }],
    ['a string that is not an address', { email: 'not-an-email' }],
    ['an address with no domain', { email: 'ada@' }],
    ['an address over 255 characters', { email: `${'a'.repeat(250)}@example.com` }],
  ])('rejects %s', (_why, input) => {
    expect(waitlistSchema.safeParse(input).success).toBe(false);
  });

  it('tells the reader what to do, in the prototype’s own words', () => {
    const result = waitlistSchema.safeParse({ email: 'not-an-email' });

    expect(result.success).toBe(false);
    const message = result.success ? '' : (result.error.issues[0]?.message ?? '');
    // The register matters as much as the fact: this is the first thing a
    // stranger does on the site, and "Invalid email address" is the platform's
    // voice on a sign-in form, not hers.
    expect(message).toBe('That email address does not look complete. Check it and try once more.');
    expect(message).not.toMatch(/invalid/i);
  });

  it('caps a long free-text answer rather than storing whatever arrives', () => {
    const tooLong = waitlistSchema.safeParse({
      email: 'ada@example.com',
      intent: 'x'.repeat(2001),
    });

    expect(tooLong.success).toBe(false);
    expect(
      waitlistSchema.safeParse({ email: 'ada@example.com', intent: 'x'.repeat(2000) }).success
    ).toBe(true);
  });
});

describe('the honeypot split', () => {
  it('lets the CLIENT schema accept a filled honeypot', () => {
    // Rejecting it client-side would tell the bot which field it is, which is
    // the one thing a honeypot must never do.
    expect(
      waitlistClientSchema.safeParse({ email: 'ada@example.com', website: 'http://spam.example' })
        .success
    ).toBe(true);
  });

  it('makes the SERVER schema reject one', () => {
    expect(
      waitlistWithHoneypotSchema.safeParse({
        email: 'ada@example.com',
        website: 'http://spam.example',
      }).success
    ).toBe(false);
  });

  it('lets the server schema through when the honeypot is empty or absent', () => {
    expect(
      waitlistWithHoneypotSchema.safeParse({ email: 'ada@example.com', website: '' }).success
    ).toBe(true);
    expect(waitlistWithHoneypotSchema.safeParse({ email: 'ada@example.com' }).success).toBe(true);
  });

  it('names the honeypot field on the issue, which is what the route keys off', () => {
    const result = waitlistWithHoneypotSchema.safeParse({
      email: 'ada@example.com',
      website: 'spam',
    });

    expect(result.success).toBe(false);
    // The route answers a honeypot validation failure with a 200 rather than a
    // 400, and it recognises one by this path. If the path ever stopped being
    // `website` the route would silently start returning a 400 that names the
    // field — the exact disclosure the honeypot exists to avoid.
    const paths = result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('website');
  });
});
