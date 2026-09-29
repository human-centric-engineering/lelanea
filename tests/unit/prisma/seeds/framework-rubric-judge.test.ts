import { describe, it, expect, vi } from 'vitest';

import rubricJudgeSeed from '@/prisma/seeds/framework/001-framework-rubric-judge';
import type { SeedContext } from '@/prisma/runner';

/**
 * Tests for the `framework/001-framework-rubric-judge` seed (f-governance-plus t-3).
 *
 * Contract:
 *  - resolves the SERVICE service-account owner (like the core judge seed) and fails loudly if absent;
 *  - upserts exactly ONE agent, the `eval-judge-framework-rubric` judge, `kind='judge'` + `isSystem`;
 *  - OVERWRITES `systemInstructions` on re-seed (seed-managed rubric), with empty model/provider so
 *    the operator's configured judge/chat default resolves at runtime;
 *  - seeds NO workflow/schedule row (nothing a fresh fork must delete).
 */
function makeCtx(admin: { id: string } | null = { id: 'svc-1' }) {
  const upsert = vi.fn().mockResolvedValue({ slug: 'eval-judge-framework-rubric' });
  const findFirst = vi.fn().mockResolvedValue(admin);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx = {
    prisma: { user: { findFirst }, aiAgent: { upsert } },
    logger,
  } as unknown as SeedContext;
  return { ctx, upsert, findFirst };
}

describe('framework/001-framework-rubric-judge seed', () => {
  it('upserts one framework-rubric judge owned by the service account', async () => {
    const { ctx, upsert, findFirst } = makeCtx();
    await rubricJudgeSeed.run(ctx);

    expect(findFirst).toHaveBeenCalledWith({
      where: { accountType: 'SERVICE' },
      select: { id: true },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    // Keyed on the per-org unique (Sunrise §107): at single the install org.
    expect(arg.where).toEqual({
      orgId_slug: { orgId: 'install', slug: 'eval-judge-framework-rubric' },
    });
    // Create shape: a system judge with runtime-resolved model/provider.
    expect(arg.create).toMatchObject({
      slug: 'eval-judge-framework-rubric',
      kind: 'judge',
      isSystem: true,
      isActive: true,
      model: '',
      provider: '',
      visibility: 'internal',
      knowledgeAccessMode: 'restricted',
      createdBy: 'svc-1',
    });
    expect(typeof arg.create.systemInstructions).toBe('string');
    // Update overwrites the seed-managed rubric.
    expect(arg.update).toMatchObject({ kind: 'judge', isSystem: true });
    expect(typeof arg.update.systemInstructions).toBe('string');
  });

  it('throws when no service account exists (ordering guard)', async () => {
    const { ctx } = makeCtx(null);
    await expect(rubricJudgeSeed.run(ctx)).rejects.toThrow(/service account/i);
  });
});
