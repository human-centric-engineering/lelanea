/**
 * Module workflow-binding dispatch (f-module-bindings t-3, reconciliation #4).
 *
 * `runModuleWorkflowBindings(moduleSlug, eventType, payload)` is the "event → workflow"
 * entry: it resolves the enabled bindings for `(module, eventType)` and runs each
 * bound workflow via the **existing** execution machinery — create a PENDING
 * `AiWorkflowExecution` pinned to the workflow's published version, then
 * `drainEngine(...)` fire-and-forget. No new engine, no new run path; this mirrors the
 * scheduler and inbound-trigger dispatch exactly (spec §4.2 says lifecycle events run
 * a workflow — `emitHookEvent` is outbound-webhook-only and can't, so this uses
 * `drainEngine` like every other row→workflow trigger).
 *
 * **Nothing calls this yet.** The module-lifecycle *event source* (what fires
 * `module.entered` / `module.completed`) is **f-engagement** (08); t-3 ships the
 * dispatch callable/testable in isolation and f-engagement wires the real event later
 * (the 08/09 `JourneyEvent` coordination — no hard dependency edge). It is written to
 * be safe to call directly: an unknown module or an event with no bindings is a clean
 * no-op, and a binding whose workflow is inactive / unpublished / malformed is skipped
 * (logged), never allowed to abort the others.
 */

import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { isRecord } from '@/lib/utils';
import { WorkflowStatus } from '@/types/orchestration';
import { workflowDefinitionSchema } from '@/lib/validations/orchestration';
import { drainEngine } from '@/lib/orchestration/scheduling/scheduler';
import { resolveMaxCostPerExecution } from '@/lib/orchestration/llm/cost-caps';

/** Attribution source pinned on executions triggered by a module lifecycle event. */
const TRIGGER_SOURCE = 'module-event';

export interface ModuleWorkflowDispatchResult {
  moduleSlug: string;
  eventType: string;
  /** Enabled bindings found for `(module, eventType)`. */
  matched: number;
  /** Executions created and drained. */
  dispatched: number;
  /** Bindings that matched but did not run, with the reason. */
  skipped: Array<{ bindingId: string; workflowId: string; reason: string }>;
}

/**
 * Run every enabled workflow bound to `(moduleSlug, eventType)`. Each run's input is
 * the operator's static `inputTemplate` merged under a live `event` envelope
 * (`{ event: { moduleSlug, eventType, payload } }` — the envelope wins on key
 * collision, so a workflow always finds the event data at `input.event`). Returns a
 * summary; the workflows themselves run asynchronously (fire-and-forget drain).
 */
export async function runModuleWorkflowBindings(
  moduleSlug: string,
  eventType: string,
  payload: Record<string, unknown> = {}
): Promise<ModuleWorkflowDispatchResult> {
  const result: ModuleWorkflowDispatchResult = {
    moduleSlug,
    eventType,
    matched: 0,
    dispatched: 0,
    skipped: [],
  };

  const moduleRow = await prisma.module.findFirst({
    where: { slug: moduleSlug },
    select: { id: true },
  });
  if (!moduleRow) {
    // An event for an unregistered / unknown module fires nothing. Not an error —
    // the event source is decoupled from the module registry.
    logger.warn('Module workflow dispatch: unknown module, no bindings run', {
      moduleSlug,
      eventType,
    });
    return result;
  }

  const bindings = await prisma.moduleWorkflowBinding.findMany({
    where: { moduleId: moduleRow.id, eventType, enabled: true },
  });
  result.matched = bindings.length;
  if (bindings.length === 0) return result;

  // Batch-fetch the bound workflows (no @relation → no include) with the fields the
  // dispatch needs: liveness, cost cap, and the published version to pin + run.
  const workflowIds = [...new Set(bindings.map((b) => b.workflowId))];
  const workflows = await prisma.aiWorkflow.findMany({
    where: { id: { in: workflowIds } },
    select: {
      id: true,
      slug: true,
      isActive: true,
      maxCostPerExecutionUsd: true,
      publishedVersion: { select: { id: true, snapshot: true } },
    },
  });
  const byId = new Map(workflows.map((w) => [w.id, w]));

  // Org-wide default cost cap, resolved once for the whole fan-out.
  const orgSettings = await prisma.aiOrchestrationSettings.findUnique({
    where: { slug: 'global' },
    select: { defaultMaxCostPerExecutionUsd: true },
  });
  const settingsDefault = orgSettings?.defaultMaxCostPerExecutionUsd ?? null;

  for (const binding of bindings) {
    const skip = (reason: string): void => {
      result.skipped.push({ bindingId: binding.id, workflowId: binding.workflowId, reason });
      logger.warn('Module workflow dispatch: binding skipped', {
        moduleSlug,
        eventType,
        bindingId: binding.id,
        workflowId: binding.workflowId,
        reason,
      });
    };

    const workflow = byId.get(binding.workflowId);
    if (!workflow) {
      skip('workflow_not_found');
      continue;
    }
    if (!workflow.isActive) {
      skip('workflow_inactive');
      continue;
    }
    if (!workflow.publishedVersion) {
      skip('no_published_version');
      continue;
    }

    const defParsed = workflowDefinitionSchema.safeParse(workflow.publishedVersion.snapshot);
    if (!defParsed.success) {
      skip('invalid_definition');
      continue;
    }

    const inputData: Record<string, unknown> = {
      ...(isRecord(binding.inputTemplate) ? binding.inputTemplate : {}),
      event: { moduleSlug, eventType, payload },
    };

    const budgetLimitUsd = resolveMaxCostPerExecution({
      callerOverride: null,
      workflowDefault: workflow.maxCostPerExecutionUsd,
      settingsDefault,
    });

    try {
      const execution = await prisma.aiWorkflowExecution.create({
        data: {
          workflowId: workflow.id,
          versionId: workflow.publishedVersion.id,
          status: WorkflowStatus.PENDING,
          inputData: inputData as Prisma.InputJsonValue,
          executionTrace: [],
          userId: binding.createdBy,
          triggerSource: TRIGGER_SOURCE,
          ...(budgetLimitUsd !== undefined ? { budgetLimitUsd } : {}),
        },
      });

      // Fire-and-forget — the workflow runs asynchronously; identical crash handling
      // to the scheduler / inbound paths (drainEngine repairs the row on failure).
      void drainEngine(
        execution.id,
        { id: workflow.id, slug: workflow.slug },
        defParsed.data,
        inputData,
        binding.createdBy,
        workflow.publishedVersion.id
      );

      result.dispatched++;
    } catch (err) {
      // A failed execution-row insert must not abort the other bindings.
      logger.error(
        'Module workflow dispatch: failed to create execution',
        err instanceof Error ? err : new Error(String(err)),
        { moduleSlug, eventType, bindingId: binding.id, workflowId: workflow.id }
      );
      skip('execution_create_failed');
    }
  }

  logger.info('Module workflow dispatch complete', {
    moduleSlug,
    eventType,
    matched: result.matched,
    dispatched: result.dispatched,
    skipped: result.skipped.length,
  });

  return result;
}
