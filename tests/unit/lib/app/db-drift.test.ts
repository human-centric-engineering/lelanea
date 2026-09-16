/**
 * Unit test — the app drift-probe bridge (f-overlays t-1).
 *
 * `registerAppDriftProbes()` (the fork-owned `lib/app/db-drift.ts`, called by
 * `scripts/db/check-drift.ts`) registers the framework tier's drift probes, then delegates to the
 * empty leaf hook — the drift analogue of the boot / admin-nav bridges. This asserts the end-to-end
 * wiring the drift check relies on: after the bridge runs, the framework HNSW probe is in the registry.
 *
 * @see lib/app/db-drift.ts
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/db-drift.ts`, not a mock
 * ---------------------------------------------------------------------------
 * Daybreak FILLS that seam with the framework tier's Prisma-unmodelled database
 * objects (the pgvector index behind `FrameworkNodeEmbedding`, and friends), so
 * the expected-objects list here is Daybreak's rather than empty.
 *
 * **What a leaf should expect, and what to do.** Declare your leaf's own
 * unmodelled objects in `lib/app/leaf-db-drift.ts`, which this seam appends —
 * then PIN them here beside the framework's rather than replacing the list.
 * Dropping a framework entry to make your assertion pass re-arms the drift
 * check against an object that legitimately exists, and `check-drift.ts` will
 * report it as unexpected on every CI run.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * LELAÑEA — the leaf probe runs a real query, so the client is stubbed.
 *
 * `constraintExists` closes over the module-level `prisma`. Stubbing it lets the
 * leaf cases below EXECUTE the probe against a chosen `pg_get_constraintdef`
 * result, which is what turns "the ON DELETE action is pinned" from a claim
 * about the registration into an assertion about the check.
 */
const queryRaw = vi.fn();
vi.mock('@/lib/db/client', () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

import { registerAppDriftProbes } from '@/lib/app/db-drift';
import { getAppDriftProbes, resetAppDriftProbes } from '@/lib/db/drift-probes';

describe('registerAppDriftProbes (framework drift-probe wiring)', () => {
  beforeEach(() => {
    resetAppDriftProbes();
    queryRaw.mockReset();
  });

  it('wires the framework node-embedding HNSW probe into the registry', () => {
    registerAppDriftProbes();
    const probes = getAppDriftProbes();
    expect(probes.some((p) => p.table === 'framework_node_embedding')).toBe(true);
  });

  it('does not throw when the leaf hook runs (delegation is safe)', () => {
    expect(() => registerAppDriftProbes()).not.toThrow();
  });

  /**
   * LELAÑEA — the leaf's own probe, pinned BESIDE the framework's rather than
   * replacing it, exactly as the fork note above says.
   *
   * `app_waitlist_entry_userId_fkey` is a hand-written FK (a fork table must not
   * add a reverse field to Sunrise's `User`, CUSTOMIZATION.md §5), so Prisma
   * cannot see it and a future `migrate dev` will emit a DROP for it. This is
   * the only thing standing between that and a silently missing constraint.
   */
  it('registers the leaf waitlist FK probe', () => {
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_waitlist_entry');

    expect(probe, 'the leaf FK probe is not registered').toBeDefined();
    expect(probe?.name).toContain('app_waitlist_entry_userId_fkey');
    expect(probe?.kind).toBe('FK constraint');
  });

  it('passes on the FK the migration writes', async () => {
    queryRaw.mockResolvedValueOnce([
      { def: 'FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE SET NULL ON UPDATE CASCADE' },
    ]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_waitlist_entry');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: true });
  });

  it('FAILS when the FK exists but its ON DELETE action has drifted', async () => {
    // The failure this probe is actually for. A constraint re-created with
    // `NO ACTION` passes an existence check and breaks `prisma.user.delete()`
    // with P2003 for every user who had ever joined the waitlist — so a probe
    // that only asked "is it there?" would go green on a broken erasure path.
    queryRaw.mockResolvedValueOnce([
      { def: 'FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE NO ACTION' },
    ]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_waitlist_entry');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: false });
  });

  it('FAILS when the FK is gone, which is what `migrate dev` would do to it', async () => {
    queryRaw.mockResolvedValueOnce([]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_waitlist_entry');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: false });
  });

  /**
   * §06 t-15 — the acknowledgement ledger's FK, the same shape with the
   * OPPOSITE policy. `ON DELETE CASCADE` is the entire Art. 17 disposition for
   * `app_acknowledgement` (no erasure hook stands behind it), so the definition
   * is what is pinned, not the existence.
   */
  it('registers the leaf acknowledgement FK probe', () => {
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_acknowledgement');

    expect(probe, 'the acknowledgement FK probe is not registered').toBeDefined();
    expect(probe?.name).toContain('app_acknowledgement_userId_fkey');
    expect(probe?.kind).toBe('FK constraint');
  });

  it('passes on the CASCADE FK the acknowledgement migration writes', async () => {
    queryRaw.mockResolvedValueOnce([
      { def: 'FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE CASCADE ON UPDATE CASCADE' },
    ]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_acknowledgement');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: true });
  });

  it('FAILS when the acknowledgement FK has the waitlist policy instead', async () => {
    // `SET NULL` is the right answer one table over and the wrong one here:
    // `userId` is NOT NULL on this table, so a SET NULL cascade makes every
    // erasure of a person who reached the gate fail on the constraint.
    queryRaw.mockResolvedValueOnce([
      { def: 'FOREIGN KEY ("userId") REFERENCES "user"(id) ON DELETE SET NULL ON UPDATE CASCADE' },
    ]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_acknowledgement');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: false });
  });

  /**
   * §05 t-25 — the designation note's FK, and the first of the three pointing at
   * a SUNRISE table rather than `user`.
   *
   * `app_knowledge_designation.documentId` references `ai_knowledge_document`
   * (the MAPPED table name, not the model — `B11`). `ON DELETE CASCADE` is what
   * stops a deleted document leaving its licensing note behind as an orphan row
   * keyed on an id nothing resolves.
   */
  it('registers the leaf designation FK probe', () => {
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_knowledge_designation');

    expect(probe, 'the designation FK probe is not registered').toBeDefined();
    expect(probe?.name).toContain('app_knowledge_designation_documentId_fkey');
    expect(probe?.kind).toBe('FK constraint');
  });

  it('passes on the CASCADE FK the designation migration writes', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        def: 'FOREIGN KEY ("documentId") REFERENCES "ai_knowledge_document"(id) ON DELETE CASCADE ON UPDATE CASCADE',
      },
    ]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_knowledge_designation');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: true });
  });

  it('FAILS when the designation FK has drifted to NO ACTION', async () => {
    // The failure this one is actually for: `deleteDocument()` would start
    // failing with P2003 for every document anyone had ever designated, and an
    // existence-only probe would have gone green on it.
    queryRaw.mockResolvedValueOnce([
      {
        def: 'FOREIGN KEY ("documentId") REFERENCES "ai_knowledge_document"(id) ON DELETE NO ACTION',
      },
    ]);
    registerAppDriftProbes();
    const probe = getAppDriftProbes().find((p) => p.table === 'app_knowledge_designation');

    await expect(probe?.probe()).resolves.toMatchObject({ ok: false });
  });

  it('keeps the framework probes when the leaf registers its own', () => {
    registerAppDriftProbes();
    const tables = getAppDriftProbes().map((p) => p.table);

    // Dropping a framework entry to make a leaf assertion pass re-arms the
    // drift check against an object that legitimately exists — `check-drift.ts`
    // then reports it as unexpected on every CI run.
    expect(tables).toContain('framework_node_embedding');
    expect(tables).toContain('app_waitlist_entry');
    expect(tables).toContain('app_acknowledgement');
    expect(tables).toContain('app_knowledge_designation');
  });
});
