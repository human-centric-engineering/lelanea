/**
 * The read-access seam (f-journey-state t-2) — `canRead` / `subjectScope`.
 *
 * Pure and DB-free (the single-user path takes no DB), so this is a `tests/unit`
 * file. Covers the four contracted decisions today plus the #367-input shape:
 * self-read allow, admin-support allow, default-deny, and that `scope`
 * (`own|team|all` + tier) is *carried* without the predicate branching on
 * unmodelled inputs yet.
 */

import { describe, it, expect } from 'vitest';
import {
  canWrite,
  canRead,
  subjectScope,
  adminSupportViewer,
  type JourneyViewer,
  type AccessScope,
} from '@/lib/framework/shared/access';

const alice: JourneyViewer = { userId: 'user_alice' };
const support: JourneyViewer = { userId: 'user_support', isAdminSupport: true };

describe('canRead', () => {
  it('allows a viewer to read their own subject', async () => {
    await expect(canRead(alice, 'user_alice')).resolves.toBe(true);
  });

  it('allows an explicit admin-support viewer to read another subject', async () => {
    await expect(canRead(support, 'user_alice')).resolves.toBe(true);
  });

  it('default-denies an unrelated viewer', async () => {
    await expect(canRead(alice, 'user_bob')).resolves.toBe(false);
  });

  it('does not treat a plain role-less viewer as support', async () => {
    // No `isAdminSupport` flag ⇒ no override, even for a non-self subject.
    await expect(canRead({ userId: 'user_x' }, 'user_bob')).resolves.toBe(false);
  });

  it('carries `scope` without granting cross-user reads on unmodelled inputs (async #367 contract)', async () => {
    // `own | team | all` + tier are accepted and carried, but no cross-user grant
    // is modelled today, so a non-self / non-support viewer is still denied
    // regardless of what `scope` asks for. When #367 lands this delegates instead.
    const scopes: AccessScope[] = [
      { ownership: 'own' },
      { ownership: 'team' },
      { ownership: 'all' },
      { ownership: 'all', tier: 'premium' },
    ];
    for (const scope of scopes) {
      await expect(canRead(alice, 'user_bob', scope)).resolves.toBe(false);
    }
  });

  it('returns a Promise (async from day one — decision 7)', () => {
    expect(canRead(alice, 'user_alice')).toBeInstanceOf(Promise);
  });
});

describe('subjectScope', () => {
  it('narrows to the viewer’s own subject by default (single-user Lelanea)', async () => {
    await expect(subjectScope(alice)).resolves.toEqual({ userId: 'user_alice' });
  });

  it('still narrows to own for a non-support viewer asking for `all` (no silent broadening)', async () => {
    await expect(subjectScope(alice, { ownership: 'all' })).resolves.toEqual({
      userId: 'user_alice',
    });
  });

  it('widens to every subject ({}) for an admin-support viewer, mirroring canRead', async () => {
    // The set form of canRead granting an admin-support viewer any single subject:
    // the two faces of the seam agree, and the widening does not depend on `scope`.
    await expect(subjectScope(support)).resolves.toEqual({});
    await expect(subjectScope(support, { ownership: 'own' })).resolves.toEqual({});
    await expect(subjectScope(support, { ownership: 'all' })).resolves.toEqual({});
  });

  it('agrees with canRead for every viewer/subject pairing (row filter == access decision)', async () => {
    // For any (viewer, subject): canRead allow ⇔ subject passes subjectScope's filter.
    const viewers = [alice, support];
    const subjects = ['user_alice', 'user_support', 'user_bob'];
    for (const viewer of viewers) {
      const filter = await subjectScope(viewer);
      for (const subject of subjects) {
        const allowed = await canRead(viewer, subject);
        const passesFilter = filter.userId === undefined || filter.userId === subject;
        expect(passesFilter).toBe(allowed);
      }
    }
  });
});

describe('adminSupportViewer', () => {
  it('builds the operator viewer with the explicit admin-support override set', () => {
    expect(adminSupportViewer('user_op')).toEqual({ userId: 'user_op', isAdminSupport: true });
  });

  it('produces a viewer canRead grants cross-user reads', async () => {
    await expect(canRead(adminSupportViewer('user_op'), 'user_someone_else')).resolves.toBe(true);
  });
});

describe('canWrite', () => {
  it('grants the subject themselves', async () => {
    await expect(canWrite(alice, 'user_alice')).resolves.toBe(true);
  });

  it('grants the explicit admin-support override', async () => {
    await expect(canWrite(support, 'user_alice')).resolves.toBe(true);
  });

  it('denies a third party by default', async () => {
    await expect(canWrite(alice, 'user_bob')).resolves.toBe(false);
  });

  it('denies a third party whatever ownership scope is asked for', async () => {
    // The pin, stated as a test. `scope` is carried for Sunrise #367's resolver;
    // no ownership widening may reach the WRITE grant.
    for (const ownership of ['own', 'team', 'all'] as const) {
      await expect(canWrite(alice, 'user_bob', { ownership })).resolves.toBe(false);
    }
  });

  it('is no wider than canRead for any viewer/subject pair', async () => {
    // The composition invariant: a write requires the read. If #367 ever makes
    // canRead NARROWER, this holds the write down with it — so a stale write grant
    // cannot outlive the read it depends on.
    const viewers = [alice, support];
    const subjects = ['user_alice', 'user_bob', 'user_support'];

    for (const viewer of viewers) {
      for (const subject of subjects) {
        const write = await canWrite(viewer, subject);
        const read = await canRead(viewer, subject);
        if (write) expect(read).toBe(true);
      }
    }
  });
});
