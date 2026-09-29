/**
 * Module workflow-binding service (f-module-bindings t-3) — the only module that
 * writes `framework_module_workflow` rows.
 *
 * Binds a module *lifecycle event* to a published `AiWorkflow` (spec §4.2): "when
 * event X happens in this module, run workflow Y". A thin trigger row analogous to
 * `AiWorkflowTrigger` — the dispatch (`./dispatch`) reuses the existing execution
 * machinery. This module owns writes only; reads live in `./queries`, dispatch in
 * `./dispatch`.
 *
 * `workflowId` and `createdBy` have no Prisma relation (the X6 boundary keeps reverse
 * fields off the core `AiWorkflow` / `User` models), so their FKs + delete rules live
 * in the migration SQL. Every write emits a `logAdminAction` audit entry (spec §7).
 */

import { Prisma } from '@prisma/client';
import type { ModuleWorkflowBinding } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import { logAdminAction } from '@/lib/orchestration/audit/admin-audit-logger';
import { mapPrismaWriteError } from '@/lib/framework/shared/prisma-errors';

const ENTITY_TYPE = 'module_workflow_binding';

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Resolve a module row id from its slug, or 404. */
async function loadModuleId(slug: string): Promise<string> {
  const row = await prisma.module.findFirst({ where: { slug }, select: { id: true } });
  if (!row) throw new NotFoundError(`Module "${slug}" not found`);
  return row.id;
}

/**
 * Assert a bindable workflow exists. A workflow need not be *published* to be bound
 * (an admin can wire the automation before publishing) — the published-version check
 * happens at dispatch, which skips a binding whose workflow has no published version.
 */
async function assertWorkflowExists(workflowId: string): Promise<void> {
  const workflow = await prisma.aiWorkflow.findUnique({
    where: { id: workflowId },
    select: { id: true },
  });
  if (!workflow) {
    throw new ValidationError('Workflow not found', {
      workflowId: [`No workflow "${workflowId}"`],
    });
  }
}

/** Load a binding that must belong to the given module, or 404. */
async function loadBindingInModule(
  moduleId: string,
  bindingId: string
): Promise<Pick<ModuleWorkflowBinding, 'id' | 'workflowId' | 'eventType'>> {
  const existing = await prisma.moduleWorkflowBinding.findFirst({
    where: { id: bindingId, moduleId },
    select: { id: true, workflowId: true, eventType: true },
  });
  if (!existing) {
    throw new NotFoundError(`Binding "${bindingId}" not found for this module`);
  }
  return existing;
}

/**
 * Map a Prisma write error on `framework_module_workflow` to a domain error, or
 * rethrow. A P2002 on `(moduleId, eventType, workflowId)` means the same event is
 * already bound to the same workflow; a P2025 means the binding was deleted between
 * the belongs-to guard and the update/delete (a concurrent unbind).
 */
function rethrowWorkflowBindingWriteError(
  err: unknown,
  ctx: { moduleSlug: string; eventType?: string; workflowId?: string }
): never {
  mapPrismaWriteError(err, {
    onUnique: () => {
      throw new ValidationError('This event is already bound to that workflow', {
        eventType: [
          `"${ctx.eventType}" is already bound to workflow "${ctx.workflowId}" in module "${ctx.moduleSlug}"`,
        ],
      });
    },
    notFound: 'Binding was removed concurrently',
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface BindWorkflowArgs {
  moduleSlug: string;
  workflowId: string;
  eventType: string;
  inputTemplate?: Record<string, unknown>;
  enabled?: boolean;
  userId: string;
  clientIp?: string | null;
}

/**
 * Bind a module event to a workflow. Validates that the workflow exists (published or
 * not). A duplicate `(module, event, workflow)` is a `ValidationError`, not a raw
 * Prisma constraint error. The binding records its author in `createdBy` (retained on
 * erasure) — that id becomes the triggered execution's `userId` at dispatch.
 */
export async function bindWorkflow(args: BindWorkflowArgs): Promise<ModuleWorkflowBinding> {
  const {
    moduleSlug,
    workflowId,
    eventType,
    inputTemplate,
    enabled = true,
    userId,
    clientIp,
  } = args;

  const moduleId = await loadModuleId(moduleSlug);
  await assertWorkflowExists(workflowId);

  let binding: ModuleWorkflowBinding;
  try {
    binding = await prisma.moduleWorkflowBinding.create({
      data: {
        moduleId,
        workflowId,
        eventType,
        enabled,
        createdBy: userId,
        ...(inputTemplate !== undefined
          ? { inputTemplate: inputTemplate as Prisma.InputJsonValue }
          : {}),
      },
    });
  } catch (err) {
    rethrowWorkflowBindingWriteError(err, { moduleSlug, eventType, workflowId });
  }

  logAdminAction({
    userId,
    action: 'module_workflow_binding.create',
    entityType: ENTITY_TYPE,
    entityId: binding.id,
    entityName: `${moduleSlug}:${eventType}`,
    metadata: { moduleSlug, workflowId, eventType, enabled },
    clientIp: clientIp ?? null,
  });

  return binding;
}

export interface UpdateWorkflowBindingArgs {
  moduleSlug: string;
  bindingId: string;
  enabled?: boolean;
  /** `undefined` = leave unchanged; `null` = clear; object = set. */
  inputTemplate?: Record<string, unknown> | null;
  userId: string;
  clientIp?: string | null;
}

/**
 * Update a binding's `enabled` flag and/or its `inputTemplate`. The binding must
 * belong to the named module (else 404). Changing the event or workflow is an
 * unbind + rebind, not a patch.
 */
export async function updateWorkflowBinding(
  args: UpdateWorkflowBindingArgs
): Promise<ModuleWorkflowBinding> {
  const { moduleSlug, bindingId, enabled, inputTemplate, userId, clientIp } = args;

  const moduleId = await loadModuleId(moduleSlug);
  await loadBindingInModule(moduleId, bindingId);

  let binding: ModuleWorkflowBinding;
  try {
    binding = await prisma.moduleWorkflowBinding.update({
      where: { id: bindingId },
      data: {
        ...(enabled !== undefined ? { enabled } : {}),
        ...(inputTemplate !== undefined
          ? {
              inputTemplate:
                inputTemplate === null ? Prisma.JsonNull : (inputTemplate as Prisma.InputJsonValue),
            }
          : {}),
      },
    });
  } catch (err) {
    // A concurrent unbind (P2025) → 404 instead of a raw 500.
    rethrowWorkflowBindingWriteError(err, { moduleSlug });
  }

  logAdminAction({
    userId,
    action: 'module_workflow_binding.update',
    entityType: ENTITY_TYPE,
    entityId: binding.id,
    entityName: `${moduleSlug}:${binding.eventType}`,
    metadata: {
      moduleSlug,
      bindingId,
      enabled,
      inputTemplateChanged: inputTemplate !== undefined,
    },
    clientIp: clientIp ?? null,
  });

  return binding;
}

export interface UnbindWorkflowArgs {
  moduleSlug: string;
  bindingId: string;
  userId: string;
  clientIp?: string | null;
}

/** Remove a binding. The binding must belong to the named module (else 404). */
export async function unbindWorkflow(args: UnbindWorkflowArgs): Promise<void> {
  const { moduleSlug, bindingId, userId, clientIp } = args;

  const moduleId = await loadModuleId(moduleSlug);
  const existing = await loadBindingInModule(moduleId, bindingId);

  try {
    await prisma.moduleWorkflowBinding.delete({ where: { id: bindingId } });
  } catch (err) {
    // Concurrent unbind between the guard and the delete → 404, not a raw 500.
    rethrowWorkflowBindingWriteError(err, { moduleSlug });
  }

  logAdminAction({
    userId,
    action: 'module_workflow_binding.delete',
    entityType: ENTITY_TYPE,
    entityId: bindingId,
    entityName: `${moduleSlug}:${existing.eventType}`,
    metadata: { moduleSlug, workflowId: existing.workflowId, eventType: existing.eventType },
    clientIp: clientIp ?? null,
  });
}
