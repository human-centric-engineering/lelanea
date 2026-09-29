/**
 * Module workflow-binding read queries (f-module-bindings t-3).
 *
 * `listModuleWorkflowBindings` stitches each binding with the bound workflow's display
 * fields via one batched follow-up (no @relation → no include, no N+1), flags whether
 * the workflow is dispatchable (has a published version), 404s an unknown module, and
 * returns `workflow: null` for a workflow that can't be resolved.
 *
 * @see lib/framework/modules/workflow-bindings/queries.ts
 */

import { it, expect, beforeEach, vi } from 'vitest';

const { prismaFake, store, resetStore } = vi.hoisted(() => {
  const store = {
    modules: new Map<string, any>(),
    workflows: new Map<string, any>(),
    bindings: [] as any[],
  };

  const prismaFake: any = {
    module: {
      findFirst: async ({ where }: any) => {
        for (const m of store.modules.values()) if (m.slug === where.slug) return { ...m };
        return null;
      },
    },
    moduleWorkflowBinding: {
      findMany: async ({ where }: any) =>
        store.bindings.filter((b) => b.moduleId === where.moduleId).map((b) => ({ ...b })),
    },
    aiWorkflow: {
      findMany: async ({ where }: any) =>
        [...store.workflows.values()]
          .filter((w) => where.id.in.includes(w.id))
          .map((w) => ({ ...w })),
    },
  };

  return {
    prismaFake,
    store,
    resetStore: () => {
      store.modules.clear();
      store.workflows.clear();
      store.bindings = [];
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));

import { listModuleWorkflowBindings } from '@/lib/framework/modules/workflow-bindings/queries';
import { NotFoundError } from '@/lib/api/errors';

function seedModule(slug: string): void {
  store.modules.set(`m-${slug}`, { id: `m-${slug}`, slug, name: slug });
}
function seedWorkflow(id: string, opts: { publishedVersionId?: string | null } = {}): void {
  store.workflows.set(id, {
    id,
    name: `${id}-name`,
    slug: id,
    isActive: true,
    // `in` check, not `??`, so an explicit `null` (unpublished) is preserved.
    publishedVersionId: 'publishedVersionId' in opts ? opts.publishedVersionId : 'v1',
  });
}
function seedBinding(moduleSlug: string, workflowId: string, eventType: string): void {
  store.bindings.push({
    id: `b${store.bindings.length + 1}`,
    moduleId: `m-${moduleSlug}`,
    workflowId,
    eventType,
    enabled: true,
    inputTemplate: null,
    createdBy: 'admin',
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

it('404s an unknown module (not an empty list)', async () => {
  await expect(listModuleWorkflowBindings('ghost')).rejects.toBeInstanceOf(NotFoundError);
});

it('returns [] when a module has no bindings', async () => {
  seedModule('reading');
  expect(await listModuleWorkflowBindings('reading')).toEqual([]);
});

it('stitches the workflow display fields and flags a dispatchable workflow', async () => {
  seedModule('reading');
  seedWorkflow('wf-1', { publishedVersionId: 'v3' });
  seedBinding('reading', 'wf-1', 'module.completed');

  const [view] = await listModuleWorkflowBindings('reading');
  expect(view.workflow).toMatchObject({
    id: 'wf-1',
    name: 'wf-1-name',
    slug: 'wf-1',
    isActive: true,
    hasPublishedVersion: true,
  });
});

it('flags an unpublished workflow as not dispatchable', async () => {
  seedModule('reading');
  seedWorkflow('wf-1', { publishedVersionId: null });
  seedBinding('reading', 'wf-1', 'module.entered');

  const [view] = await listModuleWorkflowBindings('reading');
  expect(view.workflow?.hasPublishedVersion).toBe(false);
});

it('resolves workflow to null when the workflow row is missing', async () => {
  seedModule('reading');
  seedBinding('reading', 'wf-gone', 'module.completed');

  const [view] = await listModuleWorkflowBindings('reading');
  expect(view.workflow).toBeNull();
});

it('batches one workflow fetch across many bindings (no N+1)', async () => {
  seedModule('reading');
  seedWorkflow('wf-1');
  seedWorkflow('wf-2');
  seedBinding('reading', 'wf-1', 'module.entered');
  seedBinding('reading', 'wf-2', 'module.completed');
  seedBinding('reading', 'wf-1', 'module.completed');

  const spy = vi.spyOn(prismaFake.aiWorkflow, 'findMany');
  const views = await listModuleWorkflowBindings('reading');
  expect(views).toHaveLength(3);
  expect(spy).toHaveBeenCalledTimes(1);
  // De-duplicated ids in the single query.
  const arg = spy.mock.calls[0][0] as { where: { id: { in: string[] } } };
  expect([...arg.where.id.in].sort()).toEqual(['wf-1', 'wf-2']);
});
