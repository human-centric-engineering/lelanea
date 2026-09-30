/**
 * `firstNameFrom` — the one rule the welcome email and the in-app Initiation
 * share for which names count as none.
 */

import { describe, expect, it } from 'vitest';

import { applyFirstName } from '@/components/app/content/authored-document';
import { firstNameFrom, PLATFORM_NAME_FALLBACK } from '@/lib/app/onboarding/first-name';

describe('firstNameFrom', () => {
  it.each([
    ['Maya Reyes', 'Maya'],
    ['Maya', 'Maya'],
    ['  Maya   Reyes  ', 'Maya'],
    ['User', null],
    ['  User  ', null],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
  ])('%j → %j', (input, expected) => {
    expect(firstNameFrom(input)).toBe(expected);
  });

  it('treats the platform stand-in as no name', () => {
    // Pinned to the literal, because the coupling is to a string in
    // Sunrise's `lib/auth/config.ts` (`user.name || 'User'`).
    expect(PLATFORM_NAME_FALLBACK).toBe('User');
  });

  it('does not treat a person actually called User-something as the stand-in', () => {
    expect(firstNameFrom('Userwald Smith')).toBe('Userwald');
  });

  it('hands applyFirstName a null it closes the sentence over, with no stray comma', () => {
    expect(applyFirstName('Welcome, {{first_name}}.', firstNameFrom('User'))).toBe('Welcome.');
    expect(applyFirstName('Welcome, {{first_name}}.', firstNameFrom('Maya Reyes'))).toBe(
      'Welcome, Maya.'
    );
  });
});
