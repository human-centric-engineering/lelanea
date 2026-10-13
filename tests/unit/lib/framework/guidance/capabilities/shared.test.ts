/**
 * Shared guidance-capability plumbing (f-guidance t-2). Pure.
 */

import { describe, it, expect } from 'vitest';
import { journeyRequest, journeyArgsSchema } from '@/lib/framework/guidance/capabilities/shared';

describe('journeyRequest', () => {
  it('builds a viewer + key scoped to the caller as subject', () => {
    const { viewer, key } = journeyRequest({ graphSlug: 'onboarding' }, 'user-1');
    expect(viewer).toEqual({ userId: 'user-1' });
    expect(key).toEqual({ userId: 'user-1', graphSlug: 'onboarding' });
  });

  it('threads an optional contextKey and omits it when absent', () => {
    expect(journeyRequest({ graphSlug: 'g', contextKey: 'inst-2' }, 'u').key).toEqual({
      userId: 'u',
      graphSlug: 'g',
      contextKey: 'inst-2',
    });
    expect(journeyRequest({ graphSlug: 'g' }, 'u').key).not.toHaveProperty('contextKey');
  });
});

describe('journeyArgsSchema', () => {
  it('requires a non-empty graphSlug', () => {
    expect(journeyArgsSchema.safeParse({ graphSlug: '' }).success).toBe(false);
    expect(journeyArgsSchema.safeParse({ graphSlug: 'g' }).success).toBe(true);
  });
});
