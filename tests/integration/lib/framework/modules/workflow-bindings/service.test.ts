/**
 * Module workflow-binding service (f-module-bindings t-3).
 *
 * Exercises the real bind / update / unbind logic against a small STATEFUL in-memory
 * Prisma fake — `create`/`update`/`delete` mutate a store and the finders read it
 * back, so the belongs-to-this-module guard and the duplicate/not-found mappings are
 * proven for real (house style: no live DB in vitest). The HTTP contract is the
 * routes test; the dispatch is its own test.
 *
 * The real `@prisma/client` is NOT mocked — the P2002 duplicate path must raise a
 * genuine `PrismaClientKnownRequestError`.
 *
 * @see lib/framework/modules/workflow-bindings/service.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';

// ─── Stateful in-memory Prisma fake ──────────────────────────────────────────
const { prismaFake, store, resetStore } = vi.hoisted(() => {
  const store = {
    modules: new Map<string, any>(),
    workflows: new Map<string, any>(),
    bindings: new Map<string, any>(),
    seq: 0,
  };
  const id = (p: string) => `${p}${(store.seq += 1)}`;

  const moduleModel = {
    findFirst: async ({ where }: any) => {
      for (const m of store.modules.values()) if (m.slug === where.slug) return { ...m };
      return null;
    },
  };

  const aiWorkflow = {
    findUnique: async ({ where }: any) => {
      const row = store.workflows.get(where.id);
      return row ? { ...row } : null;
    },
  };

  const moduleWorkflowBinding = {
    create: async ({ data }: any) => {
      for (const b of store.bindings.values()) {
        if (
          b.moduleId === data.moduleId &&
          b.eventType === data.eventType &&
          b.workflowId === data.workflowId
        ) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: 'framework_module_workflow_moduleId_eventType_workflowId_key' },
          });
        }
      }
      const row = {
        id: id('b'),
        moduleId: data.moduleId,
        workflowId: data.workflowId,
        eventType: data.eventType,
        enabled: data.enabled ?? true,
        inputTemplate: data.inputTemplate ?? null,
        createdBy: data.createdBy ?? null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      };
      store.bindings.set(row.id, row);
      return { ...row };
    },
    findFirst: async ({ where }: any) => {
      const row = store.bindings.get(where.id);
      if (!row) return null;
      if (where.moduleId && row.moduleId !== where.moduleId) return null;
      return { ...row };
    },
    update: async ({ where, data }: any) => {
      const row = store.bindings.get(where.id);
      if (!row) throw new Error('not found');
      if (data.enabled !== undefined) row.enabled = data.enabled;
      if ('inputTemplate' in data) {
        row.inputTemplate = data.inputTemplate === Prisma.JsonNull ? null : data.inputTemplate;
      }
      return { ...row };
    },
    delete: async ({ where }: any) => {
      const row = store.bindings.get(where.id);
      if (!row) throw new Error('not found');
      store.bindings.delete(where.id);
      return { ...row };
    },
  };

  const prismaFake: any = {
    module: moduleModel,
    aiWorkflow,
    moduleWorkflowBinding,
  };

  return {
    prismaFake,
    store,
    resetStore: () => {
      store.modules.clear();
      store.workflows.clear();
      store.bindings.clear();
      store.seq = 0;
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({ logAdminAction: vi.fn() }));

import {
  bindWorkflow,
  updateWorkflowBinding,
  unbindWorkflow,
} from '@/lib/framework/modules/workflow-bindings/service';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { NotFoundError, ValidationError } from '@/lib/api/errors';

const USER = 'admin-1';

function seedModule(slug: string): void {
  store.modules.set(`m-${slug}`, { id: `m-${slug}`, slug, name: slug });
}
function seedWorkflow(id: string): void {
  store.workflows.set(id, { id, slug: id, name: id });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('bindWorkflow', () => {
  it('binds an event to a workflow, records the author, and audits it', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');

    const binding = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });

    expect(binding).toMatchObject({
      workflowId: 'wf-1',
      eventType: 'module.completed',
      enabled: true,
      createdBy: USER,
    });
    expect(store.bindings.size).toBe(1);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'module_workflow_binding.create',
        entityId: binding.id,
      })
    );
  });

  it('persists inputTemplate and an explicit enabled=false', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');
    const binding = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.entered',
      inputTemplate: { greeting: 'hi' },
      enabled: false,
      userId: USER,
    });
    expect(store.bindings.get(binding.id).inputTemplate).toEqual({ greeting: 'hi' });
    expect(store.bindings.get(binding.id).enabled).toBe(false);
  });

  it('404s when the module is not found', async () => {
    seedWorkflow('wf-1');
    await expect(
      bindWorkflow({ moduleSlug: 'ghost', workflowId: 'wf-1', eventType: 'x', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.bindings.size).toBe(0);
  });

  it('rejects an unknown workflow with a ValidationError (no write)', async () => {
    seedModule('reading');
    await expect(
      bindWorkflow({ moduleSlug: 'reading', workflowId: 'nope', eventType: 'x', userId: USER })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.bindings.size).toBe(0);
    expect(logAdminAction).not.toHaveBeenCalled();
  });

  it('maps a duplicate (module, event, workflow) to a ValidationError, not a raw P2002', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');
    await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });
    await expect(
      bindWorkflow({
        moduleSlug: 'reading',
        workflowId: 'wf-1',
        eventType: 'module.completed',
        userId: USER,
      })
    ).rejects.toBeInstanceOf(ValidationError);
    expect(store.bindings.size).toBe(1);
  });

  it('allows the same workflow on a different event', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');
    await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.entered',
      userId: USER,
    });
    await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });
    expect(store.bindings.size).toBe(2);
  });
});

describe('updateWorkflowBinding', () => {
  beforeEach(() => {
    seedModule('reading');
    seedWorkflow('wf-1');
  });

  it('toggles enabled and replaces inputTemplate', async () => {
    const b = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      inputTemplate: { a: 1 },
      userId: USER,
    });
    const updated = await updateWorkflowBinding({
      moduleSlug: 'reading',
      bindingId: b.id,
      enabled: false,
      inputTemplate: { b: 2 },
      userId: USER,
    });
    expect(updated.enabled).toBe(false);
    expect(store.bindings.get(b.id).inputTemplate).toEqual({ b: 2 });
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_workflow_binding.update' })
    );
  });

  it('clears inputTemplate when passed null', async () => {
    const b = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      inputTemplate: { a: 1 },
      userId: USER,
    });
    await updateWorkflowBinding({
      moduleSlug: 'reading',
      bindingId: b.id,
      inputTemplate: null,
      userId: USER,
    });
    expect(store.bindings.get(b.id).inputTemplate).toBeNull();
  });

  it('404s when the binding belongs to a different module', async () => {
    seedModule('writing');
    const b = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });
    await expect(
      updateWorkflowBinding({
        moduleSlug: 'writing',
        bindingId: b.id,
        enabled: false,
        userId: USER,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('unbindWorkflow', () => {
  it('removes the binding and audits it', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');
    const b = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });
    await unbindWorkflow({ moduleSlug: 'reading', bindingId: b.id, userId: USER });
    expect(store.bindings.size).toBe(0);
    expect(logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'module_workflow_binding.delete', entityId: b.id })
    );
  });

  it('404s for a binding that is not in the named module', async () => {
    seedModule('reading');
    await expect(
      unbindWorkflow({ moduleSlug: 'reading', bindingId: 'nope', userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('write-error mapping (concurrency races)', () => {
  const p2025 = () =>
    new Prisma.PrismaClientKnownRequestError('not found', {
      code: 'P2025',
      clientVersion: 'test',
    });

  afterEach(() => vi.restoreAllMocks());

  it('updateWorkflowBinding: the binding vanishing mid-update (P2025) → NotFoundError, not 500', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');
    const b = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });
    vi.spyOn(prismaFake.moduleWorkflowBinding, 'update').mockRejectedValueOnce(p2025());
    await expect(
      updateWorkflowBinding({
        moduleSlug: 'reading',
        bindingId: b.id,
        enabled: false,
        userId: USER,
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('unbindWorkflow: the binding vanishing mid-delete (P2025) → NotFoundError, not 500', async () => {
    seedModule('reading');
    seedWorkflow('wf-1');
    const b = await bindWorkflow({
      moduleSlug: 'reading',
      workflowId: 'wf-1',
      eventType: 'module.completed',
      userId: USER,
    });
    vi.spyOn(prismaFake.moduleWorkflowBinding, 'delete').mockRejectedValueOnce(p2025());
    await expect(
      unbindWorkflow({ moduleSlug: 'reading', bindingId: b.id, userId: USER })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
