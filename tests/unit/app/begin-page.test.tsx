// @vitest-environment happy-dom

/**
 * `/app/begin` — the page the gate sends people to, rendered as the server would.
 *
 * The REAL ledger, content loader and view sit under it; Prisma, the session,
 * the environment and Next's `redirect` are stubs. So "the disclaimer is on
 * the page" is the authored disclaimer from the content file, and "one action
 * per outstanding kind" is the view reading a status the ledger computed.
 *
 * FORK NOTE — reads `lib/app/content` and `lib/app/gateway/*` for real, for
 * the reason above; a fork with different documents should expect the text
 * assertions to name theirs.
 *
 * @see app/(gate)/app/begin/page.tsx
 */

import { render, screen } from '@testing-library/react';
import { cloneElement, isValidElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { env, findMany, redirect, clearInvalidSession, getServerSession } = vi.hoisted(() => ({
  env: { REQUIRE_EMAIL_VERIFICATION: false, NODE_ENV: 'test' },
  findMany: vi.fn(),
  redirect: vi.fn((to: string): never => {
    throw new Error(`redirected:${to}`);
  }),
  clearInvalidSession: vi.fn((): never => {
    throw new Error('cleared');
  }),
  getServerSession: vi.fn(),
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
vi.mock('@/lib/api/client', () => ({ apiClient: { post: vi.fn() } }));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/navigation', () => ({ redirect }));
vi.mock('@/lib/auth/utils', () => ({ getServerSession }));
vi.mock('@/lib/auth/clear-session', () => ({ clearInvalidSession }));

import BeginPage, { metadata } from '@/app/(gate)/app/begin/page';
import { STEP_COPY } from '@/components/app/views/begin-view';
import { AGE_18_VERSION } from '@/lib/app/gateway/acknowledgements';
import { getFoundationalCollectionMeta, getFoundationalDocument } from '@/lib/app/content';

const VERSION = getFoundationalCollectionMeta().version;
const SESSION = {
  user: { id: 'u1', name: 'Maya Reyes', email: 'maya@example.com', emailVerified: true },
};

/** Resolve async server components down the tree — see shell-layout.test.tsx. */
async function resolveAsync(node: React.ReactNode): Promise<React.ReactNode> {
  if (Array.isArray(node)) return Promise.all(node.map(resolveAsync));
  if (!isValidElement(node)) return node;
  const element = node as React.ReactElement<{ children?: React.ReactNode }>;
  if (typeof element.type === 'function' && element.type.constructor.name === 'AsyncFunction') {
    const rendered = await (element.type as (p: unknown) => Promise<React.ReactNode>)(
      element.props
    );
    return resolveAsync(rendered);
  }
  if (element.props?.children === undefined) return element;
  return cloneElement(element, undefined, await resolveAsync(element.props.children));
}

async function renderPage() {
  const tree = await resolveAsync(await BeginPage());
  const result = render(tree as React.ReactElement);
  expect(document.body.textContent?.trim()).not.toBe('');
  return result;
}

/**
 * A paragraph of an authored document — a sentence only the file has. The
 * first one WITHOUT a placeholder: outside production the renderer wraps an
 * unresolved `[Support Email]` in its own element, which splits the text.
 */
function firstParagraph(id: string): string {
  const doc = getFoundationalDocument(id)!;
  const block = doc.blocks.find(
    (candidate) => candidate.type === 'paragraph' && !/[[{]/.test(candidate.text)
  );
  if (!block || block.type !== 'paragraph') throw new Error(`no plain paragraph in ${id}`);
  return block.text.replace(/\*\*/g, '').slice(0, 40);
}

beforeEach(() => {
  vi.clearAllMocks();
  env.REQUIRE_EMAIL_VERIFICATION = false;
  findMany.mockResolvedValue([]);
  getServerSession.mockResolvedValue(SESSION);
});

describe('/app/begin', () => {
  it('is titled Begin and kept out of search', () => {
    expect(metadata.title).toBe('Begin');
    expect(metadata.robots).toEqual({ index: false });
  });

  it('clears an invalid session before anything else', async () => {
    getServerSession.mockResolvedValue(null);
    await expect(BeginPage()).rejects.toThrow('cleared');
    expect(clearInvalidSession).toHaveBeenCalledWith('/app/begin');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sends an unverified address to verify when verification is on', async () => {
    env.REQUIRE_EMAIL_VERIFICATION = true;
    getServerSession.mockResolvedValue({ user: { ...SESSION.user, emailVerified: false } });
    await expect(BeginPage()).rejects.toThrow('redirected:/verify-email?email=maya%40example.com');
  });

  it('opens on the disclaimer, in full and from the content file, with its control', async () => {
    await renderPage();

    expect(screen.getByText(firstParagraph('disclaimer'), { exact: false })).toBeTruthy();
    // One step at a time: the terms are not on this screen.
    expect(screen.queryByText(firstParagraph('terms_of_use'), { exact: false })).toBeNull();
    // One h1 — the step's — and the document's own title one level down.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 2, name: getFoundationalDocument('disclaimer')!.title })
    ).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: STEP_COPY.disclaimer.action })).toBeTruthy();
  });

  it('reads the caller’s ledger and opens on the first kind still outstanding', async () => {
    findMany.mockResolvedValue([
      { kind: 'disclaimer', documentVersion: VERSION, acknowledgedAt: new Date('2026-09-01') },
      { kind: 'age_18', documentVersion: AGE_18_VERSION, acknowledgedAt: new Date('2026-09-01') },
    ]);
    await renderPage();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u1' } }));
    expect(screen.getByTestId('step-terms')).toBeTruthy();
    expect(screen.getByText(firstParagraph('terms_of_use'), { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: STEP_COPY.terms.action })).toBeTruthy();
  });

  it('is the read-only record afterwards, with Return the only action', async () => {
    findMany.mockResolvedValue([
      { kind: 'disclaimer', documentVersion: VERSION, acknowledgedAt: new Date('2026-09-01') },
      { kind: 'terms', documentVersion: VERSION, acknowledgedAt: new Date('2026-09-01') },
      { kind: 'age_18', documentVersion: AGE_18_VERSION, acknowledgedAt: new Date('2026-09-01') },
    ]);
    await renderPage();

    expect(screen.queryByRole('button')).toBeNull();
    for (const name of ['disclaimer', 'terms', 'age_18'] as const) {
      expect(screen.getByTestId(`record-${name}`)).toBeTruthy();
    }
    // Loaded complete means they came back to read it, not that they just
    // finished — so Return to the account view, not Begin.
    expect(screen.queryByRole('link', { name: 'Begin' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Return' }).getAttribute('href')).toBe('/app/account');
  });
});
