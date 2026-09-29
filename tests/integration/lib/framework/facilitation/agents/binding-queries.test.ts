/**
 * Facilitation agent-binding read queries (f-facilitation-agents t-1). Mocks the DB client;
 * proves the batch-stitch of the bound agent's display fields (no N+1), the tombstone
 * surfacing, and the empty-family short-circuit.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    facilitationAgentBinding: { findMany: vi.fn(), findFirst: vi.fn() },
    aiAgent: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

import {
  listFacilitationBindings,
  getFacilitationBindingByRole,
} from '@/lib/framework/facilitation/agents/binding-queries';
import { prisma } from '@/lib/db/client';

beforeEach(() => vi.clearAllMocks());

describe('listFacilitationBindings', () => {
  it('returns an empty list without a second query when there are no bindings', async () => {
    vi.mocked(prisma.facilitationAgentBinding.findMany).mockResolvedValue([] as never);
    expect(await listFacilitationBindings()).toEqual([]);
    expect(prisma.aiAgent.findMany).not.toHaveBeenCalled();
  });

  it('stitches each binding with its bound agent via one batched query (no N+1)', async () => {
    vi.mocked(prisma.facilitationAgentBinding.findMany).mockResolvedValue([
      { id: 'fab-1', agentId: 'a1', role: 'onboarding' },
      { id: 'fab-2', agentId: 'a2', role: 'state' },
    ] as never);
    vi.mocked(prisma.aiAgent.findMany).mockResolvedValue([
      { id: 'a1', name: 'Guide', slug: 'guide', isActive: true, deletedAt: null },
      {
        id: 'a2',
        name: 'Gone',
        slug: '-deleted-a2',
        isActive: false,
        deletedAt: new Date('2026-01-01'),
      },
    ] as never);

    const rows = await listFacilitationBindings();
    expect(prisma.aiAgent.findMany).toHaveBeenCalledTimes(1); // batched, not per-row
    expect(rows[0].agent).toMatchObject({ slug: 'guide', deletedAt: null });
    expect(rows[1].agent?.deletedAt).toBeInstanceOf(Date); // tombstone surfaced, not dropped
  });

  it('sets agent to null when the bound agent row is missing', async () => {
    vi.mocked(prisma.facilitationAgentBinding.findMany).mockResolvedValue([
      { id: 'fab-1', agentId: 'ghost', role: 'onboarding' },
    ] as never);
    vi.mocked(prisma.aiAgent.findMany).mockResolvedValue([] as never);
    expect((await listFacilitationBindings())[0].agent).toBeNull();
  });
});

describe('getFacilitationBindingByRole', () => {
  it('returns null (without an agent lookup) when nothing is bound to the role', async () => {
    vi.mocked(prisma.facilitationAgentBinding.findFirst).mockResolvedValue(null);
    expect(await getFacilitationBindingByRole('made-up')).toBeNull();
    expect(prisma.aiAgent.findUnique).not.toHaveBeenCalled();
  });

  it('stitches the single binding with its bound agent', async () => {
    vi.mocked(prisma.facilitationAgentBinding.findFirst).mockResolvedValue({
      id: 'fab-1',
      agentId: 'a1',
      role: 'state',
    } as never);
    vi.mocked(prisma.aiAgent.findUnique).mockResolvedValue({
      id: 'a1',
      name: 'Reporter',
      slug: 'reporter',
      isActive: true,
      deletedAt: null,
    } as never);
    const view = await getFacilitationBindingByRole('state');
    expect(prisma.facilitationAgentBinding.findFirst).toHaveBeenCalledWith({
      where: { role: 'state' },
    });
    expect(view?.agent).toMatchObject({ slug: 'reporter' });
  });

  it('sets agent to null when the bound agent row is gone (hard-deleted between reads)', async () => {
    vi.mocked(prisma.facilitationAgentBinding.findFirst).mockResolvedValue({
      id: 'fab-1',
      agentId: 'ghost',
      role: 'state',
    } as never);
    vi.mocked(prisma.aiAgent.findUnique).mockResolvedValue(null);
    expect((await getFacilitationBindingByRole('state'))?.agent).toBeNull();
  });
});
