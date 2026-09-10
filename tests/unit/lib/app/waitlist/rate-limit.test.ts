/**
 * The waitlist's per-flow sub-cap, exercised rather than described.
 *
 * The module is four lines of configuration, and configuration is exactly the
 * thing a test of the surrounding code cannot see: the route test mocks this
 * limiter, so nothing else in the suite ever runs it. What is asserted here is
 * the behaviour the numbers produce — five joins an hour from one address, and
 * a bucket that is not shared with anybody else.
 *
 * @see lib/app/waitlist/rate-limit.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { waitlistLimiter, WAITLIST_MAX_PER_INTERVAL } from '@/lib/app/waitlist/rate-limit';

/** Distinct per test, so one case cannot spend another's budget. */
let counter = 0;
function freshIp(): string {
  counter += 1;
  return `198.51.100.${counter}`;
}

beforeEach(() => {
  counter += 100;
});

describe('waitlistLimiter', () => {
  it('allows exactly five joins from one address, then refuses', () => {
    const ip = freshIp();

    for (let attempt = 1; attempt <= WAITLIST_MAX_PER_INTERVAL; attempt++) {
      expect(waitlistLimiter.check(ip).success, `attempt ${attempt} was refused`).toBe(true);
    }

    // Six is the assertion that matters. A cap asserted only from below passes
    // on a limiter that never refuses anything.
    expect(waitlistLimiter.check(ip).success).toBe(false);
  });

  it('reports the cap it is enforcing, so the response headers are truthful', () => {
    const result = waitlistLimiter.check(freshIp());

    expect(result.limit).toBe(WAITLIST_MAX_PER_INTERVAL);
    expect(result.remaining).toBe(WAITLIST_MAX_PER_INTERVAL - 1);
    expect(result.reset).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('gives each address its own bucket', () => {
    const spender = freshIp();
    const bystander = freshIp();

    for (let attempt = 0; attempt <= WAITLIST_MAX_PER_INTERVAL; attempt++) {
      waitlistLimiter.check(spender);
    }
    expect(waitlistLimiter.check(spender).success).toBe(false);

    // One person joining must not close the form for everyone behind the same
    // exhausted counter.
    expect(waitlistLimiter.check(bystander).success).toBe(true);
  });

  it('does not share a bucket with the contact form', async () => {
    // Borrowing `contactLimiter` was the obvious shortcut and would have meant
    // that sending a message through the contact page spent a waitlist join.
    const { contactLimiter } = await import('@/lib/security/rate-limit');
    const ip = freshIp();

    for (let attempt = 0; attempt <= WAITLIST_MAX_PER_INTERVAL; attempt++) {
      waitlistLimiter.check(ip);
    }
    expect(waitlistLimiter.check(ip).success).toBe(false);
    expect(contactLimiter.check(ip).success).toBe(true);
  });

  it('window is an hour, not a minute', () => {
    const { reset } = waitlistLimiter.check(freshIp());
    const secondsAway = reset - Math.floor(Date.now() / 1000);

    // A minute-long window would let a bot make 300 joins an hour from one
    // address, which is the same as no cap for this flow.
    expect(secondsAway).toBeGreaterThan(3500);
    expect(secondsAway).toBeLessThanOrEqual(3601);
  });
});
