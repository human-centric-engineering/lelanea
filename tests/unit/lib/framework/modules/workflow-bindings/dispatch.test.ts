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
 * The erasure check (Sunrise 0.16.0 §122) is mocked at `findErasedSubjects` — its locks and
 * receipt query are core's and tested there; what is proved here is what the dispatcher asks it
 * (who the run names, erased since when) and what it does with the answer. The blanking and the
 * definition rewrite are core's real functions.
 *
 * @see lib/framework/modules/workflow-bindings/dispatch.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { prismaFake, store, resetStore, drainEngineMock, findErasedMock } = vi.hoisted(() => {
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
    // The run is written in a transaction (under erasure's locks); the fake runs it inline.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaFake)),
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
  const findErasedMock = vi.fn(async () => ({
    addresses: [] as string[],
    userIds: [] as string[],
  }));

  return {
    prismaFake,
    store,
    drainEngineMock,
    findErasedMock,
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
vi.mock('@/lib/privacy/erased-subjects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/privacy/erased-subjects')>()),
  boundLockWaits: vi.fn(async () => undefined),
  findErasedSubjects: findErasedMock,
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runModuleWorkflowBindings } from '@/lib/framework/modules/workflow-bindings/dispatch';
import { getSubjectReadScope, runAsSubject } from '@/lib/auth/subject-context';
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

describe('owner layer (Sunrise §115)', () => {
  it('drains the binding’s workflow across owners when a narrowed member’s request triggers it', async () => {
    seedWorkflow('wf-1');
    seedBinding('wf-1');
    const scopes: string[] = [];
    drainEngineMock.mockImplementationOnce(async () => {
      scopes.push((await getSubjectReadScope()).kind);
    });

    await runAsSubject(
      {
        principal: { userId: 'member-1', credential: 'session' },
        filter: { userId: 'member-1' },
        resolveFilter: () => Promise.resolve({ userId: 'member-1' }),
        unattributedReads: {
          conversation: false,
          dataset: false,
          execution: false,
          experiment: false,
          webhookDelivery: false,
          webhookSubscription: false,
        },
      },
      async () => {
        // Prove the population: outside the crossing, this request IS narrowed.
        expect((await getSubjectReadScope()).kind).toBe('subject');
        await runModuleWorkflowBindings('reading', 'module.completed', { userId: 'member-1' });
      }
    );
    await vi.waitFor(() => expect(scopes).toHaveLength(1));

    // Narrowed ('subject'), the engine's resume read of an execution owned by the binding's
    // author would be refused; 'admitted' is the declared crossing.
    expect(scopes).toEqual(['admitted']);
  });
});

describe('erasure (Sunrise 0.16.0 §122)', () => {
  const NOTIFY_DEFINITION = {
    steps: [
      {
        id: 'notify',
        name: 'Notify',
        type: 'send_notification',
        config: { channel: 'email', to: 'erased@example.com', subject: 's', bodyTemplate: 'b' },
        nextSteps: [],
      },
    ],
    entryStepId: 'notify',
    errorStrategy: 'fail',
  };

  it('asks about everyone the template and the definition name, erased since it read them', async () => {
    seedWorkflow('wf-1', { snapshot: NOTIFY_DEFINITION });
    seedBinding('wf-1', { inputTemplate: { cc: 'Kept@Example.com' } });
    const before = Date.now();

    await runModuleWorkflowBindings('reading', 'module.completed');

    expect(findErasedMock).toHaveBeenCalledTimes(1);
    const [, subjects, options] = findErasedMock.mock.calls[0] as unknown as [
      unknown,
      { addresses: string[]; userIds: string[] },
      { since: Date },
    ];
    expect(subjects.addresses).toEqual(
      expect.arrayContaining(['Kept@Example.com', 'erased@example.com'])
    );
    // Since the read, not ever: taken before the dispatch's first query.
    expect(options.since.getTime()).toBeGreaterThanOrEqual(before - 1);
    expect(options.since.getTime()).toBeLessThanOrEqual(Date.now());
    // Shared: concurrent dispatches do not queue behind each other; erasure still waits.
    expect(options).toMatchObject({ shared: true });
  });

  it('names the member who triggered the event, and takes them out of the payload if erased', async () => {
    seedWorkflow('wf-1');
    seedBinding('wf-1');
    findErasedMock.mockResolvedValueOnce({ addresses: [], userIds: ['member-9'] });

    await runModuleWorkflowBindings('reading', 'module.completed', {
      userId: 'member-9',
      score: 3,
    });

    const [, subjects] = findErasedMock.mock.calls[0] as unknown as [
      unknown,
      { userIds: string[] },
    ];
    expect(subjects.userIds).toContain('member-9');
    const payload = store.createdExecutions[0].inputData.event.payload;
    expect(payload.score).toBe(3);
    expect(JSON.stringify(payload)).not.toContain('member-9');
  });

  it('writes a run that names nobody without a transaction or a check', async () => {
    seedWorkflow('wf-1');
    seedBinding('wf-1', { inputTemplate: { locale: 'en' } });

    const result = await runModuleWorkflowBindings('reading', 'module.completed', { score: 1 });

    expect(result.dispatched).toBe(1);
    expect(prismaFake.$transaction).not.toHaveBeenCalled();
    expect(findErasedMock).not.toHaveBeenCalled();
  });

  it('skips the binding, writing no run, when the stripped definition does not re-validate', async () => {
    seedWorkflow('wf-1', { snapshot: NOTIFY_DEFINITION });
    seedBinding('wf-1');
    findErasedMock.mockResolvedValueOnce({ addresses: ['erased@example.com'], userIds: [] });
    const versionService = await import('@/lib/orchestration/workflows/version-service');
    const spy = vi.spyOn(versionService, 'withoutErasedRecipients').mockImplementationOnce(() => {
      throw new Error('invalid definition after rewrite');
    });

    const result = await runModuleWorkflowBindings('reading', 'module.completed');

    expect(result.dispatched).toBe(0);
    expect(result.skipped).toEqual([
      expect.objectContaining({ reason: 'execution_create_failed' }),
    ]);
    expect(store.createdExecutions).toHaveLength(0);
    expect(drainEngineMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('blanks an erased address in the run input and takes it out of the definition it runs', async () => {
    seedWorkflow('wf-1', { snapshot: NOTIFY_DEFINITION });
    seedBinding('wf-1', { inputTemplate: { to: 'Erased@Example.com', cc: 'kept@example.com' } });
    findErasedMock.mockResolvedValueOnce({ addresses: ['erased@example.com'], userIds: [] });

    const result = await runModuleWorkflowBindings('reading', 'module.completed');

    expect(result.dispatched).toBe(1);
    const inputData = store.createdExecutions[0].inputData;
    expect(inputData).toMatchObject({ to: '', cc: 'kept@example.com' });
    const [, , definition, drainedInput] = drainEngineMock.mock.calls[0];
    expect(drainedInput).toEqual(inputData);
    // The stored definition named them; the one the engine runs does not.
    expect(JSON.stringify(NOTIFY_DEFINITION)).toContain('erased@example.com');
    expect(JSON.stringify(definition)).not.toContain('erased@example.com');
  });

  it('leaves the run untouched when nobody it names was erased', async () => {
    seedWorkflow('wf-1', { snapshot: NOTIFY_DEFINITION });
    seedBinding('wf-1', { inputTemplate: { to: 'erased@example.com' } });

    await runModuleWorkflowBindings('reading', 'module.completed');

    expect(store.createdExecutions[0].inputData).toMatchObject({ to: 'erased@example.com' });
    expect(JSON.stringify(drainEngineMock.mock.calls[0][2])).toContain('erased@example.com');
  });

  it('a lock wait that runs out skips that binding but still runs the others', async () => {
    seedWorkflow('wf-1');
    seedWorkflow('wf-2');
    seedBinding('wf-1', { inputTemplate: { to: 'ops@example.com' } });
    seedBinding('wf-2', { inputTemplate: { to: 'ops@example.com' } });
    findErasedMock.mockRejectedValueOnce(new Error('canceling statement due to lock timeout'));

    const result = await runModuleWorkflowBindings('reading', 'module.completed');

    expect(result.dispatched).toBe(1);
    expect(result.skipped).toEqual([
      expect.objectContaining({ workflowId: 'wf-1', reason: 'execution_create_failed' }),
    ]);
    expect(store.createdExecutions.map((e) => e.workflowId)).toEqual(['wf-2']);
  });
});
