/**
 * The meter's query shapes (§08 t-56) — the window rules, and which dimensions
 * each side may ask for.
 *
 * @see lib/validations/app-metering.ts
 */

import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  adminBreakdownQuerySchema,
  memberBreakdownQuerySchema,
  turnIdParamSchema,
} from '@/lib/validations/app-metering';

afterEach(() => {
  vi.useRealTimers();
});

describe('dimensions', () => {
  it('a member may not group by person; an admin may', () => {
    expect(memberBreakdownQuerySchema.safeParse({ by: 'user' }).success).toBe(false);
    expect(adminBreakdownQuerySchema.safeParse({ by: 'user' }).success).toBe(true);
  });

  it('a member query carries no person, whatever is sent', () => {
    const parsed = memberBreakdownQuerySchema.parse({
      by: 'seat',
      userId: 'cmu7other0000000000000000',
    });
    expect(parsed).not.toHaveProperty('userId');
  });

  it('an admin may name a person only by a real id', () => {
    expect(adminBreakdownQuerySchema.safeParse({ by: 'seat', userId: 'x y' }).success).toBe(false);
  });
});

describe('the window', () => {
  it('defaults the limit, and leaves the ends for the reader to fill', () => {
    expect(memberBreakdownQuerySchema.parse({ by: 'day' })).toEqual({ by: 'day', limit: 100 });
  });

  it('coerces dates from the query string', () => {
    const parsed = memberBreakdownQuerySchema.parse({
      by: 'day',
      from: '2026-08-01',
      to: '2026-09-01',
    });
    expect(parsed.from).toEqual(new Date('2026-08-01'));
    expect(parsed.to).toEqual(new Date('2026-09-01'));
  });

  it('refuses an empty or backwards window', () => {
    for (const to of ['2026-08-01', '2026-07-01']) {
      expect(
        memberBreakdownQuerySchema.safeParse({ by: 'day', from: '2026-08-01', to }).success
      ).toBe(false);
    }
  });

  it('allows a year, refuses more — including when only `from` is given and `to` is now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-18T00:00:00Z'));
    expect(memberBreakdownQuerySchema.safeParse({ by: 'day', from: '2025-09-18' }).success).toBe(
      true
    );
    expect(memberBreakdownQuerySchema.safeParse({ by: 'day', from: '2025-09-16' }).success).toBe(
      false
    );
  });

  it('caps the groups', () => {
    expect(memberBreakdownQuerySchema.safeParse({ by: 'day', limit: 500 }).success).toBe(true);
    expect(memberBreakdownQuerySchema.safeParse({ by: 'day', limit: 501 }).success).toBe(false);
    expect(memberBreakdownQuerySchema.safeParse({ by: 'day', limit: 0 }).success).toBe(false);
  });
});

describe('turn ids', () => {
  it('accepts what the turn route accepts — up to 128 characters', () => {
    expect(turnIdParamSchema.safeParse('x'.repeat(128)).success).toBe(true);
    expect(turnIdParamSchema.safeParse('x'.repeat(129)).success).toBe(false);
    expect(turnIdParamSchema.safeParse('  ').success).toBe(false);
  });
});
