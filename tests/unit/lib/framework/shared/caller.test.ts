/**
 * The framework's one "who is this tool acting for" check. Pure.
 */

import { describe, it, expect } from 'vitest';
import { checkUserCaller } from '@/lib/framework/shared/caller';

describe('checkUserCaller', () => {
  it('returns the signed-in user id', () => {
    expect(checkUserCaller({ userId: 'user-1' }, 'Guidance')).toEqual({
      ok: true,
      userId: 'user-1',
    });
  });

  it('refuses a system-initiated run with no_user_context, naming the feature', () => {
    expect(checkUserCaller({ userId: null }, 'Slot capture')).toEqual({
      ok: false,
      code: 'no_user_context',
      message: 'Slot capture is unavailable for system-initiated runs (no user context).',
    });
  });

  it('treats an empty user id as no user, as core does', () => {
    expect(checkUserCaller({ userId: '' }, 'Guidance')).toMatchObject({
      ok: false,
      code: 'no_user_context',
    });
  });

  it('refuses an anonymous embed widget visitor with anonymous_visitor', () => {
    expect(checkUserCaller({ userId: 'embed_0123456789abcdef' }, 'Guidance')).toEqual({
      ok: false,
      code: 'anonymous_visitor',
      message: 'Guidance is unavailable to anonymous embed widget visitors.',
    });
  });
});
