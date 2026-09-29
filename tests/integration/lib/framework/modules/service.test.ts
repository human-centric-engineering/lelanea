/**
 * Integration test — module settings write service (f-ops-views t-3).
 *
 * The lifecycle writes over a mocked Prisma client + audit/resolver seams:
 *   - updateModuleSettings: writes only the sent fields, audits only the ones that actually
 *     change, enforces merged-window coherence, 404s on an unknown slug.
 *   - deleteModule: only an UNREGISTERED module can be deleted (registered → 409); a delete
 *     clears the knowledge-access resolver cache and audits; a concurrent delete → 404.
 *
 * @see lib/framework/modules/service.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  module: { findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
  moduleAgentBinding: { findMany: vi.fn() },
}));
const auditMock = vi.hoisted(() => ({ logAdminAction: vi.fn() }));
const resolverMock = vi.hoisted(() => ({ invalidateAgentAccess: vi.fn() }));
const dispatchMock = vi.hoisted(() => ({ runModuleWorkflowBindings: vi.fn() }));

vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => auditMock);
vi.mock('@/lib/orchestration/knowledge/resolveAgentDocumentAccess', () => resolverMock);
vi.mock('@/lib/framework/modules/workflow-bindings', () => dispatchMock);

import { updateModuleSettings, deleteModule } from '@/lib/framework/modules/service';
import { NotFoundError, ConflictError, ValidationError } from '@/lib/api/errors';

function current(over: Record<string, unknown> = {}) {
  return {
    id: 'mod-1',
    slug: 'onboarding',
    name: 'Onboarding',
    status: 'draft',
    audience: 'all',
    featureFlagName: null,
    availableFrom: null,
    availableUntil: null,
    isRegistered: true,
    updatedAt: new Date('2026-02-01T00:00:00.000Z'),
    ...over,
  };
}

const ARGS = { userId: 'admin-1', clientIp: '10.0.0.1' };

describe('updateModuleSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The status-change dispatch is `void`-called with a `.catch()`, so it must return a
    // promise even when a test doesn't care about it.
    dispatchMock.runModuleWorkflowBindings.mockResolvedValue({ matched: 0, dispatched: 0 });
  });

  it('writes the patch and audits the changed fields', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current());
    prismaMock.module.update.mockResolvedValue(current({ status: 'active', name: 'Onboarding' }));

    const patch = { status: 'active' };
    await updateModuleSettings({ slug: 'onboarding', patch, ...ARGS });

    expect(prismaMock.module.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'mod-1' }, data: patch })
    );
    expect(auditMock.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'module.update',
        entityType: 'module',
        entityId: 'mod-1',
        changes: { status: { from: 'draft', to: 'active' } },
      })
    );
  });

  it('serialises Date bounds to ISO strings in the audit diff', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current());
    prismaMock.module.update.mockResolvedValue(current());

    const from = new Date('2026-03-01T00:00:00.000Z');
    await updateModuleSettings({ slug: 'onboarding', patch: { availableFrom: from }, ...ARGS });

    expect(auditMock.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: { availableFrom: { from: null, to: '2026-03-01T00:00:00.000Z' } },
      })
    );
  });

  it('does not audit a no-op patch (re-sent identical values)', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ status: 'active' }));
    prismaMock.module.update.mockResolvedValue(current({ status: 'active' }));

    await updateModuleSettings({ slug: 'onboarding', patch: { status: 'active' }, ...ARGS });

    expect(prismaMock.module.update).toHaveBeenCalled();
    expect(auditMock.logAdminAction).not.toHaveBeenCalled();
  });

  it('rejects an incoherent window (from after until) without writing', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current());

    const patch = {
      availableFrom: new Date('2026-06-01T00:00:00.000Z'),
      availableUntil: new Date('2026-01-01T00:00:00.000Z'),
    };
    await expect(updateModuleSettings({ slug: 'onboarding', patch, ...ARGS })).rejects.toThrow(
      ValidationError
    );
    expect(prismaMock.module.update).not.toHaveBeenCalled();
  });

  it('checks coherence against the MERGED row (patch one bound, current the other)', async () => {
    // current.availableUntil is Jan; patch sets availableFrom to June → incoherent merge.
    prismaMock.module.findFirst.mockResolvedValue(
      current({ availableUntil: new Date('2026-01-01T00:00:00.000Z') })
    );
    await expect(
      updateModuleSettings({
        slug: 'onboarding',
        patch: { availableFrom: new Date('2026-06-01T00:00:00.000Z') },
        ...ARGS,
      })
    ).rejects.toThrow(ValidationError);
    expect(prismaMock.module.update).not.toHaveBeenCalled();
  });

  it('404s on an unknown slug', async () => {
    prismaMock.module.findFirst.mockResolvedValue(null);
    await expect(
      updateModuleSettings({ slug: 'missing', patch: { name: 'x' }, ...ARGS })
    ).rejects.toThrow(NotFoundError);
  });

  it('fires module.status_changed bindings on a status change, with { from, to }', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ status: 'draft' }));
    prismaMock.module.update.mockResolvedValue(current({ status: 'active' }));

    await updateModuleSettings({ slug: 'onboarding', patch: { status: 'active' }, ...ARGS });

    expect(dispatchMock.runModuleWorkflowBindings).toHaveBeenCalledWith(
      'onboarding',
      'module.status_changed',
      { from: 'draft', to: 'active' }
    );
  });

  it('does NOT fire module.status_changed when a non-status field changes', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current());
    prismaMock.module.update.mockResolvedValue(current({ name: 'Renamed' }));

    await updateModuleSettings({ slug: 'onboarding', patch: { name: 'Renamed' }, ...ARGS });

    expect(dispatchMock.runModuleWorkflowBindings).not.toHaveBeenCalled();
  });

  it('does NOT fire module.status_changed on a no-op status re-submit', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ status: 'active' }));
    prismaMock.module.update.mockResolvedValue(current({ status: 'active' }));

    await updateModuleSettings({ slug: 'onboarding', patch: { status: 'active' }, ...ARGS });

    expect(dispatchMock.runModuleWorkflowBindings).not.toHaveBeenCalled();
  });

  it('swallows a status_changed dispatch failure (never fails the settings write)', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ status: 'draft' }));
    prismaMock.module.update.mockResolvedValue(current({ status: 'active' }));
    dispatchMock.runModuleWorkflowBindings.mockRejectedValue(new Error('dispatch boom'));

    // The write resolves with the fresh row even though the dispatch rejected.
    await expect(
      updateModuleSettings({ slug: 'onboarding', patch: { status: 'active' }, ...ARGS })
    ).resolves.toMatchObject({ status: 'active' });
  });
});

describe('deleteModule', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes an unregistered module, evicts each bound agent, and audits', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ isRegistered: false }));
    // Two bindings, one a duplicate agent (two roles) — the eviction set dedups.
    prismaMock.moduleAgentBinding.findMany.mockResolvedValue([
      { agentId: 'agent-1' },
      { agentId: 'agent-2' },
      { agentId: 'agent-1' },
    ]);
    prismaMock.module.delete.mockResolvedValue(undefined);

    await deleteModule({ slug: 'onboarding', ...ARGS });

    // Bindings enumerated for THIS module before the delete.
    expect(prismaMock.moduleAgentBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { moduleId: 'mod-1' } })
    );
    expect(prismaMock.module.delete).toHaveBeenCalledWith({ where: { id: 'mod-1' } });
    // Exactly the bound agents, deduped — not a global cache clear.
    expect(resolverMock.invalidateAgentAccess).toHaveBeenCalledTimes(2);
    expect(resolverMock.invalidateAgentAccess).toHaveBeenCalledWith('agent-1');
    expect(resolverMock.invalidateAgentAccess).toHaveBeenCalledWith('agent-2');
    expect(auditMock.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module.delete', entityId: 'mod-1' })
    );
  });

  it('deletes a module with no bindings without evicting anything', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ isRegistered: false }));
    prismaMock.moduleAgentBinding.findMany.mockResolvedValue([]);
    prismaMock.module.delete.mockResolvedValue(undefined);

    await deleteModule({ slug: 'onboarding', ...ARGS });

    expect(prismaMock.module.delete).toHaveBeenCalled();
    expect(resolverMock.invalidateAgentAccess).not.toHaveBeenCalled();
  });

  it('refuses to delete a registered module (409), without enumerating or evicting', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ isRegistered: true }));

    await expect(deleteModule({ slug: 'onboarding', ...ARGS })).rejects.toThrow(ConflictError);
    expect(prismaMock.moduleAgentBinding.findMany).not.toHaveBeenCalled();
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
    expect(resolverMock.invalidateAgentAccess).not.toHaveBeenCalled();
    expect(auditMock.logAdminAction).not.toHaveBeenCalled();
  });

  it('404s on an unknown slug', async () => {
    prismaMock.module.findFirst.mockResolvedValue(null);
    await expect(deleteModule({ slug: 'missing', ...ARGS })).rejects.toThrow(NotFoundError);
    expect(prismaMock.module.delete).not.toHaveBeenCalled();
  });

  it('maps a concurrent delete (P2025) to a clean 404, evicting nothing', async () => {
    prismaMock.module.findFirst.mockResolvedValue(current({ isRegistered: false }));
    prismaMock.moduleAgentBinding.findMany.mockResolvedValue([{ agentId: 'agent-1' }]);
    prismaMock.module.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('gone', { code: 'P2025', clientVersion: 'x' })
    );

    await expect(deleteModule({ slug: 'onboarding', ...ARGS })).rejects.toThrow(NotFoundError);
    // The evictions and audit run only after a successful delete.
    expect(resolverMock.invalidateAgentAccess).not.toHaveBeenCalled();
    expect(auditMock.logAdminAction).not.toHaveBeenCalled();
  });
});
