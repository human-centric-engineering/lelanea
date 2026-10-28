/**
 * Module workflow bindings (f-module-bindings t-3) — bind a module lifecycle event to
 * a published `AiWorkflow` (spec §4.2). Writes go through `./service` (the sole
 * writer), reads through `./queries`, and the "event → workflow" dispatch through
 * `./dispatch` (`runModuleWorkflowBindings`, reused by f-engagement's event source).
 * Request schemas in `./api-schemas`; a template's save version (`If-Match`, t-151) in `./versions`. Sibling of the agent bindings (t-1) and
 * knowledge grants (t-4).
 */

export {
  bindWorkflow,
  updateWorkflowBinding,
  unbindWorkflow,
  type BindWorkflowArgs,
  type UpdateWorkflowBindingArgs,
  type UnbindWorkflowArgs,
} from '@/lib/framework/modules/workflow-bindings/service';
export {
  bindingTemplateVersion,
  withTemplateVersion,
  type VersionedWorkflowBinding,
} from '@/lib/framework/modules/workflow-bindings/versions';
export {
  listModuleWorkflowBindings,
  type ModuleWorkflowBindingView,
} from '@/lib/framework/modules/workflow-bindings/queries';
export {
  runModuleWorkflowBindings,
  type ModuleWorkflowDispatchResult,
} from '@/lib/framework/modules/workflow-bindings/dispatch';
