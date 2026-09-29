/**
 * Module workflow-binding dispatch (f-module-bindings t-3, reconciliation #4).
 *
 * `runModuleWorkflowBindings` resolves enabled bindings for `(module, eventType)` and
 * runs each bound *published* workflow via the existing machinery — a PENDING
 * `AiWorkflowExecution` pinned to the published version, then a fire-and-forget
 * `drainEngine`. Proven directly (nothing wires it until f-engagement): `drainEngine`
 * and Prisma are mocked; we assert what the dispatch creates and hands off, and that a
 * skippable binding (inactive / unpublished / malformed / missing) is skipped without
 * aborting the others.
 *
 * @see lib/framework/modules/workflow-bindings/dispatch.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaFake, store, resetStore, drainEngineMock } = vi.hoisted(() => {
  const store = {
    module: null as { id: string } | null,
    bindings: [] as any[],
    workflows: new Map<string, any>(),
    settingsDefault: null as number | null,
    createdExecutions: [] as any[],
    execSeq: 0,
    createThrowsFor: new Set<string>(), // workflowIds whose execution create should throw
  };

  const prismaFake: any = {
    module: { findFirst: async () => store.module },
    moduleWorkflowBinding: {
      findMany: vi.fn(async () => store.bindings.map((b) => ({ ...b }))),
    },
    aiWorkflow: {
      findMany: async ({ where }: any) =>
        [...store.workflows.values()]
          .filter((w) => where.id.in.includes(w.id))
          .map((w) => ({ ...w })),
    },
    aiOrchestrationSettings: {
      findUnique: async () => ({ defaultMaxCostPerExecutionUsd: store.settingsDefault }),
    },
    aiWorkflowExecution: {
      create: async ({ data }: any) => {
        if (store.createThrowsFor.has(data.workflowId)) throw new Error('insert failed');
        const row = { id: `exec-${(store.execSeq += 1)}`, ...data };
        store.createdExecutions.push(row);
        return row;
      },
    },
  };

  const drainEngineMock = vi.fn();

  return {
    prismaFake,
    store,
    drainEngineMock,
    resetStore: () => {
      store.module = { id: 'm-1' };
      store.bindings = [];
      store.workflows.clear();
      store.settingsDefault = null;
      store.createdExecutions = [];
      store.execSeq = 0;
      store.createThrowsFor = new Set();
    },
  };
});

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/orchestration/scheduling/scheduler', () => ({ drainEngine: drainEngineMock }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runModuleWorkflowBindings } from '@/lib/framework/modules/workflow-bindings/dispatch';
import { WorkflowStatus } from '@/types/orchestration';

const VALID_DEFINITION = {
  steps: [{ id: 'step1', name: 'Start', type: 'llm_call', config: {}, nextSteps: [] }],
  entryStepId: 'step1',
  errorStrategy: 'fail',
};

function seedWorkflow(
  id: string,
  opts: {
    isActive?: boolean;
    published?: boolean;
    snapshot?: unknown;
    maxCostPerExecutionUsd?: number | null;
  } = {}
): void {
  store.workflows.set(id, {
    id,
    slug: id,
    isActive: opts.isActive ?? true,
    maxCostPerExecutionUsd: opts.maxCostPerExecutionUsd ?? null,
    publishedVersion:
      opts.published === false
        ? null
        : { id: `${id}-v1`, snapshot: opts.snapshot ?? VALID_DEFINITION },
  });
}
function seedBinding(workflowId: string, overrides: Record<string, unknown> = {}): void {
  store.bindings.push({
    id: `b${store.bindings.length + 1}`,
    moduleId: 'm-1',
    workflowId,
    eventType: 'module.completed',
    enabled: true,
    inputTemplate: null,
    createdBy: 'author-1',
    ...overrides,
  });
}

beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});

describe('resolution / no-op paths', () => {
  it('unknown module → clean no-op (no bindings query, no dispatch)', async () => {
    store.module = null;
    const result = await runModuleWorkflowBindings('ghost', 'module.completed');
    expect(result).toMatchObject({ matched: 0, dispatched: 0, skipped: [] });
    expect(prismaFake.moduleWorkflowBinding.findMany).not.toHaveBeenCalled();
    expect(drainEngineMock).not.toHaveBeenCalled();
  });

  it('no matching bindings → matched 0, dispatched 0', async () => {
    const result = await runModuleWorkflowBindings('reading', 'module.entered');
    expect(result).toMatchObject({ matched: 0, dispatched: 0 });
    expect(drainEngineMock).not.toHaveBeenCalled();
  });

  it('queries only enabled bindings for the given event', async () => {
    await runModuleWorkflowBindings('reading', 'module.completed');
    expect(prismaFake.moduleWorkflowBinding.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { moduleId: 'm-1', eventType: 'module.completed', enabled: true },
      })
    );
  });
});

describe('happy path', () => {
  it('creates a PENDING execution pinned to the published version and drains it', async () => {
    seedWorkflow('wf-1', { maxCostPerExecutionUsd: 5 });
    seedBinding('wf-1');

    const result = await runModuleWorkflowBindings('reading', 'module.completed', { userId: 'u9' });

    expect(result).toMatchObject({ matched: 1, dispatched: 1, skipped: [] });
    expect(store.createdExecutions).toHaveLength(1);
    const exec = store.createdExecutions[0];
    expect(exec).toMatchObject({
      workflowId: 'wf-1',
      versionId: 'wf-1-v1',
      status: WorkflowStatus.PENDING,
      userId: 'author-1',
      triggerSource: 'module-event',
      budgetLimitUsd: 5,
    });

    expect(drainEngineMock).toHaveBeenCalledTimes(1);
    const [execId, workflow, definition, inputData, userId, versionId] =
      drainEngineMock.mock.calls[0];
    expect(execId).toBe(exec.id);
    expect(workflow).toEqual({ id: 'wf-1', slug: 'wf-1' });
    expect(definition).toMatchObject({ entryStepId: 'step1' });
    expect(userId).toBe('author-1');
    expect(versionId).toBe('wf-1-v1');
    expect(inputData).toMatchObject({
      event: { moduleSlug: 'reading', eventType: 'module.completed', payload: { userId: 'u9' } },
    });
  });

  it('merges the inputTemplate under the event envelope (envelope wins on collision)', async () => {
    seedWorkflow('wf-1');
    seedBinding('wf-1', { inputTemplate: { locale: 'en', event: 'SHOULD_BE_OVERWRITTEN' } });

    await runModuleWorkflowBindings('reading', 'module.completed', { score: 1 });

    const inputData = store.createdExecutions[0].inputData;
    expect(inputData.locale).toBe('en');
    expect(inputData.event).toEqual({
      moduleSlug: 'reading',
      eventType: 'module.completed',
      payload: { score: 1 },
    });
  });

  it('fans out to every matching enabled binding', async () => {
    seedWorkflow('wf-1');
    seedWorkflow('wf-2');
    seedBinding('wf-1');
    seedBinding('wf-2');

    const result = await runModuleWorkflowBindings('reading', 'module.completed');
    expect(result.dispatched).toBe(2);
    expect(drainEngineMock).toHaveBeenCalledTimes(2);
  });
});

describe('skip paths (never abort the others)', () => {
  it('skips a binding whose workflow has no published version', async () => {
    seedWorkflow('wf-1', { published: false });
    seedBinding('wf-1');

    const result = await runModuleWorkflowBindings('reading', 'module.completed');
    expect(result).toMatchObject({ matched: 1, dispatched: 0 });
    expect(result.skipped[0]).toMatchObject({ workflowId: 'wf-1', reason: 'no_published_version' });
    expect(drainEngineMock).not.toHaveBeenCalled();
  });

  it('skips an inactive workflow', async () => {
    seedWorkflow('wf-1', { isActive: false });
    seedBinding('wf-1');
    const result = await runModuleWorkflowBindings('reading', 'module.completed');
    expect(result.skipped[0]).toMatchObject({ reason: 'workflow_inactive' });
  });

  it('skips a workflow with a malformed published snapshot', async () => {
    seedWorkflow('wf-1', { snapshot: { not: 'a workflow' } });
    seedBinding('wf-1');
    const result = await runModuleWorkflowBindings('reading', 'module.completed');
    expect(result.skipped[0]).toMatchObject({ reason: 'invalid_definition' });
    expect(store.createdExecutions).toHaveLength(0);
  });

  it('skips a binding whose workflow row is missing', async () => {
    seedBinding('wf-missing'); // no seedWorkflow
    const result = await runModuleWorkflowBindings('reading', 'module.completed');
    expect(result.skipped[0]).toMatchObject({ reason: 'workflow_not_found' });
  });

  it('a failing execution insert skips that binding but still runs the others', async () => {
    seedWorkflow('wf-1');
    seedWorkflow('wf-2');
    seedBinding('wf-1');
    seedBinding('wf-2');
    store.createThrowsFor.add('wf-1');

    const result = await runModuleWorkflowBindings('reading', 'module.completed');
    expect(result.dispatched).toBe(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({ workflowId: 'wf-1', reason: 'execution_create_failed' }),
    ]);
    expect(drainEngineMock).toHaveBeenCalledTimes(1);
  });
});
