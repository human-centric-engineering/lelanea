/**
 * The shell is closed until you have read and agreed (§06 t-16).
 *
 * The layout is called as the server would call it, with the REAL gate and the
 * REAL ledger underneath — only Prisma, the environment and Next's `redirect`
 * are stubs. `redirect()` throws in Next and the stub throws too, carrying the
 * target, so "was redirected, and where" is one assertion.
 *
 * What is NOT rendered: nothing. A redirected layout never returns a tree, and
 * the pass-through case asserts only that no redirect was thrown — what the
 * frame then contains is `tests/unit/components/app/shell/shell-layout.test.tsx`.
 *
 * FORK NOTE — this reads `lib/app/gateway/*` and `lib/app/content` for real,
 * because the re-gate case depends on the ledger matching rows against the
 * version the content file actually carries. A fork with its own gate should
 * expect to replace this file rather than pin ours.
 *
 * @see app/(lelanea)/app/layout.tsx · lib/app/gateway/gate.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env, findMany, redirect, clearInvalidSession } = vi.hoisted(() => ({
  env: { REQUIRE_EMAIL_VERIFICATION: false, NODE_ENV: 'test' },
  findMany: vi.fn(),
  redirect: vi.fn((to: string): never => {
    throw new Error(`redirected:${to}`);
  }),
  clearInvalidSession: vi.fn((): never => {
    throw new Error('cleared');
  }),
}));

const session = vi.hoisted(() => ({
  current: null as {
    user: { id: string; name: string | null; email: string; emailVerified: boolean; role: string };
  } | null,
}));

vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/db/client', () => ({
  prisma: {
    featureFlag: { findUnique: vi.fn(async () => null) },
    appAcknowledgement: { findMany },
  },
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/app', redirect }));
vi.mock('@/lib/auth/utils', () => ({ getServerSession: vi.fn(async () => session.current) }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));

import ShellLayout from '@/app/(lelanea)/app/layout';
import { AGE_18_VERSION } from '@/lib/app/gateway/acknowledgements';
import { getFoundationalCollectionMeta } from '@/lib/app/content';

const VERSION = getFoundationalCollectionMeta().version;
const AT = new Date('2026-09-01T00:00:00.000Z');

function row(kind: string, documentVersion: string) {
  return { kind, documentVersion, acknowledgedAt: AT };
}

/** Every kind at its current version — the state that opens the shell. */
const ALL_CURRENT = [
  row('disclaimer', VERSION),
  row('terms', VERSION),
  row('age_18', AGE_18_VERSION),
];

async function enter(): Promise<string | null> {
  try {
    await ShellLayout({ children: null });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('redirected:')) return message.slice('redirected:'.length);
    throw error;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  env.REQUIRE_EMAIL_VERIFICATION = false;
  env.NODE_ENV = 'test';
  findMany.mockResolvedValue([]);
  session.current = {
    user: {
      id: 'u1',
      name: 'Maya Reyes',
      email: 'maya@example.com',
      emailVerified: true,
      role: 'USER',
    },
  };
});

describe('the shell layout gates on entry', () => {
  it('sends a person with no acknowledgements to /app/begin', async () => {
    await expect(enter()).resolves.toBe('/app/begin');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
  });

  it('sends a person with SOME acknowledgements to /app/begin too', async () => {
    findMany.mockResolvedValue([row('disclaimer', VERSION), row('age_18', AGE_18_VERSION)]);
    await expect(enter()).resolves.toBe('/app/begin');
  });

  it('lets a fully acknowledged person in', async () => {
    findMany.mockResolvedValue(ALL_CURRENT);
    await expect(enter()).resolves.toBeNull();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('re-gates when a document version has moved on, but not the age confirmation', async () => {
    // The person agreed to an earlier collection. The ledger holds their age
    // confirmation as still standing (its constant did not move) and both
    // documents as outstanding — so they are sent back, and only for those.
    findMany.mockResolvedValue([
      row('disclaimer', `${VERSION}-earlier`),
      row('terms', `${VERSION}-earlier`),
      row('age_18', AGE_18_VERSION),
    ]);
    await expect(enter()).resolves.toBe('/app/begin');

    // The "only the changed kind" half, asserted on what the gate page would
    // be told: the ledger the layout consulted reports exactly the two.
    const { getGateStatus } = await import('@/lib/app/gateway/acknowledgements');
    const status = await getGateStatus('u1');
    expect(status.outstanding).toEqual(['disclaimer', 'terms']);
  });

  it('sends an unverified address to verify BEFORE asking anything, when verification is on', async () => {
    env.REQUIRE_EMAIL_VERIFICATION = true;
    session.current!.user.emailVerified = false;
    findMany.mockResolvedValue(ALL_CURRENT);

    await expect(enter()).resolves.toBe('/verify-email?email=maya%40example.com');
    // Verification comes first, so the ledger was not even read.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('does not demand verification when the platform is not requiring it', async () => {
    env.REQUIRE_EMAIL_VERIFICATION = false;
    session.current!.user.emailVerified = false;
    findMany.mockResolvedValue(ALL_CURRENT);

    await expect(enter()).resolves.toBeNull();
  });

  it('still clears an invalid session before any of this', async () => {
    session.current = null;
    await expect(enter()).rejects.toThrow('cleared');
    expect(findMany).not.toHaveBeenCalled();
  });
});
