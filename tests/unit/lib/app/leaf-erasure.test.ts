/**
 * `lib/app/leaf-erasure.ts` — the waitlist's Art. 17 hook, registered.
 *
 * What the hook DOES is pinned in `waitlist/service.test.ts`
 * (`eraseWaitlistEntriesForUser`), and that erasure reaches it end to end in
 * `waitlist/privacy.test.ts`. This pins the registration itself: the right
 * function, in the phase whose failure rolls the erasure back, once.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { initLeafErasureHooks } from '@/lib/app/leaf-erasure';
import { WAITLIST_ERASURE_HOOK, eraseWaitlistEntriesForUser } from '@/lib/app/waitlist/service';
import {
  getErasureCleanupHooks,
  __resetErasureCleanupHooksForTests,
} from '@/lib/privacy/erasure-hooks';

/** Ours only: the read also runs core's lazy init, which adds the framework's hook. */
function waitlistHooks() {
  return getErasureCleanupHooks().filter((hook) => hook.name === WAITLIST_ERASURE_HOOK);
}

describe('initLeafErasureHooks', () => {
  beforeEach(() => __resetErasureCleanupHooksForTests());

  it('registers the waitlist delete in the in-transaction phase', () => {
    initLeafErasureHooks();

    const hooks = waitlistHooks();
    expect(hooks).toHaveLength(1);
    expect(hooks[0]?.scrubInTransaction).toBe(eraseWaitlistEntriesForUser);
    // NOT `cleanupExternal`: that phase is best-effort and its failures are
    // swallowed, which is wrong for a delete that must roll the erasure back.
    expect(hooks[0]?.cleanupExternal).toBeUndefined();
  });

  it('is idempotent, so a repeated init does not double-register', () => {
    initLeafErasureHooks();
    initLeafErasureHooks();

    expect(waitlistHooks()).toHaveLength(1);
  });
});
