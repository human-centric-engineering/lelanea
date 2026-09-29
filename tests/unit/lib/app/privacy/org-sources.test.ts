/**
 * Lelañea's org-export sources (t-112): which rows each one reads.
 *
 * `leafOrgSources()` declares all 37 app tables as the org's data. What the
 * defaults test does not see is what each source's `fetch` actually asks the
 * database for, and that is where an org export would go wrong: reading
 * another table, or reading another org's rows. So every source is called
 * here against a stub that records its query.
 *
 * The rule restated from core (`ownedBy()`): at `TENANCY_MODE=single` a row
 * with no org is the install org's, so the install org's export carries it;
 * any other org, and every org at `multi`, matches strictly.
 *
 * FORK NOTE — this reads the real `lib/app/leaf-data-export.ts`, not a mock.
 * It has to: the seam's own sources are the thing under test, so a mock would
 * assert the mock. It is Lelañea's seam and Lelañea's test; a fork of Lelañea
 * that changes `leafOrgSources()` updates the count of 37 and the model named
 * in the single-source cases here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const multi = vi.hoisted(() => ({ on: false }));

/** One `findMany` per delegate, created on first touch, recording its args. */
const calls = vi.hoisted(() => new Map<string, unknown[]>());
const prismaStub = vi.hoisted(
  () =>
    new Proxy(
      {},
      {
        get: (_target, delegate: string) => ({
          findMany: (args: unknown) => {
            calls.set(delegate, [...(calls.get(delegate) ?? []), args]);
            return Promise.resolve([]);
          },
        }),
      }
    )
);

vi.mock('@/lib/db/client', () => ({ prisma: prismaStub }));
vi.mock('@/lib/tenancy/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenancy/context')>()),
  isMultiTenant: () => multi.on,
}));

const { leafOrgSources } = await import('@/lib/app/leaf-data-export');

/** `AppWaitlistEntry` → `appWaitlistEntry`, the delegate Prisma generates. */
function delegateOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

async function whereFor(model: string, orgId: string): Promise<unknown> {
  const source = leafOrgSources().sources.find((s) => s.model === model);
  if (!source) throw new Error(`no source for ${model}`);
  calls.clear();
  await source.fetch({ orgId });
  const recorded = calls.get(delegateOf(model));
  expect(recorded).toHaveLength(1);
  return (recorded?.[0] as { where: unknown }).where;
}

beforeEach(() => {
  multi.on = false;
  calls.clear();
});

describe('each source reads its own table', () => {
  it('queries exactly the delegate its model names, once', async () => {
    const { sources } = leafOrgSources();
    expect(sources).toHaveLength(37);
    for (const source of sources) {
      calls.clear();
      await source.fetch({ orgId: 'install' });
      expect([...calls.keys()]).toEqual([delegateOf(source.model)]);
    }
  });
});

describe('which rows an org owns', () => {
  it('gives the install org its NULL-org rows at single', async () => {
    expect(await whereFor('AppTurn', 'install')).toEqual({
      OR: [{ orgId: 'install' }, { orgId: null }],
    });
  });

  it('matches any other org strictly at single', async () => {
    expect(await whereFor('AppTurn', 'org-2')).toEqual({ orgId: 'org-2' });
  });

  it('matches the install org strictly at multi, where a NULL org is nobody’s', async () => {
    multi.on = true;
    expect(await whereFor('AppTurn', 'install')).toEqual({ orgId: 'install' });
  });

  it('applies the same rule to every source', async () => {
    for (const { model } of leafOrgSources().sources) {
      expect(await whereFor(model, 'org-2')).toEqual({ orgId: 'org-2' });
    }
  });
});
