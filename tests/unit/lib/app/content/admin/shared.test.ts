/**
 * The refusal a content write gives when it loses a race (t-91).
 *
 * Two admins save one item at once: both read revision N, one lands, and the
 * other's conditional `updateMany` matches nothing. The loser is told the
 * revision the row is really at, read again, rather than guessed as N + 1 —
 * which would be wrong whenever the winner moved it more than one revision.
 */

import { describe, expect, it } from 'vitest';

import { ConflictError } from '@/lib/api/errors';
import { revisionMovedNow } from '@/lib/app/content/admin/shared';

describe('revisionMovedNow', () => {
  it('reports the revision the row is at now, read again', async () => {
    const error = await revisionMovedNow('"The Call"', 3, Promise.resolve({ revision: 6 }));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({
      status: 409,
      details: { reason: 'revision_moved', currentRevision: 6 },
    });
    expect(error.message).toContain('revision 3, now 6');
  });

  it('falls back to the revision read when the row has gone', async () => {
    const error = await revisionMovedNow('"The Call"', 3, Promise.resolve(null));

    expect(error).toMatchObject({ details: { currentRevision: 3 } });
  });
});
