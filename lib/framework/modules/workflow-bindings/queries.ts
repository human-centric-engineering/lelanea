/**
 * Module workflow-binding read queries (f-module-bindings t-3) — the read side of
 * `framework_module_workflow`, split from the writer (`./service`) the way t-1 and
 * f-map split their queries.
 *
 * `ModuleWorkflowBinding.workflowId` has no Prisma relation (the X6 boundary keeps a
 * reverse field off the core `AiWorkflow` model), so `include: { workflow }` is not
 * available — the workflow's display fields (and whether it is dispatchable, i.e. has
 * a published version) are STITCHED with one batched follow-up query keyed on the
 * collected workflow ids (no per-row fetch, no N+1).
 */

import type { ModuleWorkflowBinding } from '@prisma/client';
import { prisma } from '@/lib/db/client';
import { NotFoundError } from '@/lib/api/errors';

/** A binding enriched with the bound workflow's display fields (or `null` if gone). */
export interface ModuleWorkflowBindingView extends ModuleWorkflowBinding {
  workflow: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
    /**
     * Whether the workflow has a published version. A binding to an unpublished
     * workflow is legal (it can be wired before publishing) but will be SKIPPED at
     * dispatch, so this is surfaced for the admin UI to flag "won't fire yet".
     */
    hasPublishedVersion: boolean;
  } | null;
}

/**
 * List a module's workflow bindings, newest first, each stitched with the bound
 * workflow's display fields. A binding whose workflow was hard-deleted is already
 * gone via the FK cascade; a workflow that merely can't be found resolves to `null`.
 * Unknown module ⇒ 404 (not an empty list).
 */
export async function listModuleWorkflowBindings(
  moduleSlug: string
): Promise<ModuleWorkflowBindingView[]> {
  const moduleRow = await prisma.module.findFirst({
    where: { slug: moduleSlug },
    select: { id: true },
  });
  if (!moduleRow) throw new NotFoundError(`Module "${moduleSlug}" not found`);

  const bindings = await prisma.moduleWorkflowBinding.findMany({
    where: { moduleId: moduleRow.id },
    orderBy: [{ createdAt: 'desc' }],
  });
  if (bindings.length === 0) return [];

  const workflowIds = [...new Set(bindings.map((b) => b.workflowId))];
  const workflows = await prisma.aiWorkflow.findMany({
    where: { id: { in: workflowIds } },
    select: { id: true, name: true, slug: true, isActive: true, publishedVersionId: true },
  });
  const byId = new Map(workflows.map((w) => [w.id, w]));

  return bindings.map((b) => {
    const w = byId.get(b.workflowId);
    return {
      ...b,
      workflow: w
        ? {
            id: w.id,
            name: w.name,
            slug: w.slug,
            isActive: w.isActive,
            hasPublishedVersion: w.publishedVersionId !== null,
          }
        : null,
    };
  });
}
