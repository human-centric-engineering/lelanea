/**
 * Data-slots domain — what the system learns about the user: insert-only versioned
 * slot values with confidence, source type, and per-version provenance, plus the
 * authored slot definitions that shape them (spec §6).
 *
 * `f-slots` populates the definition side and the value engine: the
 * `SlotDefinitionInput` type + free-string vocabulary, module-declared registration
 * with the boot-time `framework_slot_definition` sync, and the insert-only value
 * engine over `framework_slot_value`. The `fill_slot` / `get_state` capabilities
 * that drive capture (with PII/masking/exposure) are `f-slot-capture` (feature 10).
 * See `.context/framework/planning/f-slots.md` and the spec §6.
 */

export type { SlotDefinitionInput } from '@/lib/framework/data-slots/definition';
export {
  SLOT_SCOPE,
  SLOT_SCOPE_MODULE_PREFIX,
  SLOT_VISIBILITY,
  SLOT_MODE,
  SLOT_DATA_TYPE,
  SLOT_SENSITIVITY,
  SLOT_SOURCE_TYPE,
  moduleSlotScope,
} from '@/lib/framework/data-slots/vocabulary';
export type {
  SlotScope,
  SlotVisibility,
  SlotMode,
  SlotDataType,
  SlotSensitivity,
  SlotSourceType,
} from '@/lib/framework/data-slots/vocabulary';
export {
  syncRegisteredSlotDefinitions,
  registerGlobalSlotDefinitionProvider,
  syncGlobalSlotDefinitions,
} from '@/lib/framework/data-slots/sync';
export type {
  GlobalSlotDefinitionProvider,
  GlobalSlotSyncResult,
} from '@/lib/framework/data-slots/sync';
export { listSlotDefinitions } from '@/lib/framework/data-slots/queries';
export { appendSlotValue, getSlotHeads } from '@/lib/framework/data-slots/values';
export type {
  SlotValueProvenance,
  AppendSlotValueInput,
  GetSlotHeadsOptions,
} from '@/lib/framework/data-slots/values';
