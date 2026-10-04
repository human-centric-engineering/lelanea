/**
 * Every global slot definition Lelañea hands Daybreak: the authored taxonomy
 * and the eleven voice leanings (f-leanings t-135).
 *
 * Daybreak takes ONE global provider (`registerGlobalSlotDefinitionProvider`,
 * last registration wins), so the two sources meet here rather than in two
 * registrations that would replace each other.
 *
 * ## Why the leanings are code, not taxonomy rows
 *
 * The taxonomy is operator-owned: an admin edits, retires and reclassifies its
 * rows. The leanings are keyed by code (the dials, the pole lines, the bounds),
 * so an admin retiring one, or turning one `open` and putting it in front of
 * the AI's capture, would break the feature silently. They are a pure code
 * projection, and the taxonomy validation refuses their group and prefix.
 *
 * ## Empty stays empty
 *
 * Daybreak's global pass reads an EMPTY provider as a fluke and retires
 * nothing, while a slug it no longer receives is deactivated (both pinned in
 * `tests/integration/lib/framework/data-slots/global-slots.test.ts`). Adding
 * the leanings to a taxonomy read that came back empty would turn that fluke
 * into "every authored slot was removed". So when the taxonomy gives nothing,
 * this gives nothing: the leanings' projection waits for the next good pass,
 * and nothing about them depends on it (see `leaningSlotDefinitions`).
 *
 * A taxonomy read that throws still throws, as it did before this existed.
 *
 * @see lib/app/slots/taxonomy-store.ts — the taxonomy half
 * @see lib/app/voice/leanings.ts — the leanings half
 */

import type { SlotDefinitionInput } from '@/lib/framework/data-slots';
import { loadGlobalSlotDefinitions } from '@/lib/app/slots/taxonomy-store';
import { leaningSlotDefinitions } from '@/lib/app/voice/leanings';

export async function loadAppGlobalSlotDefinitions(): Promise<SlotDefinitionInput[]> {
  const taxonomy = await loadGlobalSlotDefinitions();
  if (taxonomy.length === 0) return [];
  return [...taxonomy, ...leaningSlotDefinitions()];
}
