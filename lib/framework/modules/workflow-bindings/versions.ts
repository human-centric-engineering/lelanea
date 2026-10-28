/**
 * The version of a module workflow binding's `inputTemplate` (Hub t-151) — what a template save
 * sends back as `If-Match` (Sunrise §122's protocol, `lib/api/record-version.ts`). Its own module,
 * as core keeps its record versions in `lib/orchestration/config-versions.ts`, so the read side
 * (`./queries`) and the writer (`./service`) both compute it without either importing the other.
 *
 * @see lib/framework/modules/workflow-bindings/service.ts — the header has the why
 */

import type { ModuleWorkflowBinding, Prisma } from '@prisma/client';
import { recordVersion } from '@/lib/api/record-version';

/**
 * The version of a binding's `inputTemplate`: the one field a versioned save writes. Its own
 * prefix, so it never equals a core record's version.
 */
export function bindingTemplateVersion(inputTemplate: Prisma.JsonValue): string {
  return recordVersion(['module-workflow-binding-template', inputTemplate ?? null]);
}

/** A binding as every read and write returns it: the row, with its template's version. */
export type VersionedWorkflowBinding = ModuleWorkflowBinding & { version: string };

/** `binding` with its template's version. */
export function withTemplateVersion(binding: ModuleWorkflowBinding): VersionedWorkflowBinding {
  return { ...binding, version: bindingTemplateVersion(binding.inputTemplate) };
}
