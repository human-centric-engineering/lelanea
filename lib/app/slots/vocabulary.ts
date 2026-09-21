/**
 * What she is looking for, put in front of her — the taxonomy as the model
 * reads it (f-slots t-72, security review round 1).
 *
 * ## Why this exists: without it the taxonomy is decoration
 *
 * Granting `fill_slot` is not enough to make her fill an authored slot, because
 * **nothing in the platform tells a model which slugs exist.** The tool's
 * advertised schema names one example (`"primary_goal"`, which is not even in
 * this taxonomy) and says "a new slug captures a new fact"; `get_state` returns
 * slots already filled, so it cannot introduce an empty one; and Daybreak's
 * module context injects a module's slot VALUES, not the vocabulary — and our
 * taxonomy hangs on no module by design.
 *
 * Measured, on the first real turn of `npm run smoke:app-slot-capture`: told
 * that someone had not spoken to their brother since their father died, she
 * minted `family_communication` and used none of the 50 authored slots that
 * cover exactly that. t-70's taxonomy and t-71's editor were both unreachable
 * from the only path that writes.
 *
 * **And it was a data-protection gap, not just a wasted feature.** Sensitivity
 * is read off the slot's DEFINITION (`fill-slot.ts`:
 * `definition?.sensitivity ?? standard`), and masking fires only for
 * `special_category` (`masking.ts`). A minted slug has no definition, so it is
 * always `standard`, so it is never masked. Nine slots in this taxonomy are
 * `special_category` — physical, emotional and spiritual health, i.e. GDPR
 * Art. 9 categories — and every one of them was unreachable on the capture
 * path. Someone's words about their health or their faith landed as raw prose
 * in the profile store, where the classification existed precisely to stop
 * that.
 *
 * So this block is what makes the `special_category` classification mean
 * something at runtime, which is why it is not merely a prompt improvement.
 *
 * ## Why it is not in the tool schema, where it belongs
 *
 * The obvious home is `fill_slot`'s `slotSlug` parameter — an enum, or the list
 * in its description. That is closed to a leaf: `getCapabilityDefinitions()`
 * advertises `ai_capability.functionDefinition` from the **database row**, and
 * `syncFrameworkCapabilities()` projects that row from Daybreak's own registry
 * (`getRegisteredFrameworkCapabilities()`, not the dispatcher) and reconciles it
 * on every boot. Our subclass wins the *dispatch*, never the *advertisement*.
 * Writing the row from a leaf seed would be reverted by the next boot.
 *
 * Mounting it in the prompt instead has one advantage worth keeping: it is read
 * from the database per turn, so an admin's edit in the editor reaches her on
 * her next turn rather than at the next deploy.
 *
 * ## Hidden slots are not here
 *
 * `visibility: hidden` slots — the whole `development` group — are left out
 * entirely, which means she cannot fill them. That is the strict reading of
 * §12: *"Development is a tuning signal, never a grade. It must never rank,
 * score, or display that as a level."* Putting the descriptions of a
 * development scale in her prompt so she could record against it is the first
 * step toward her reasoning out loud about which rung someone is on, and
 * nothing in t-72 needs it. Whoever fills development can decide how, with that
 * risk in front of them.
 *
 * Note the consequence: she may still WRITE a hidden slot if she somehow names
 * one (there is no write facet), she simply is not told they exist. The
 * allowlist's read facet is what guarantees she never reads one back.
 *
 * @see lib/app/voice/context-contributor.ts — the block this is spliced into
 * @see .context/app/slots.md — "Capture"
 */

import { logger } from '@/lib/logging';
import { loadGlobalSlotDefinitions } from '@/lib/app/slots/taxonomy-store';
import { SLOT_VISIBILITY } from '@/lib/framework/data-slots';

/**
 * The heading, and the rule that travels with the list.
 *
 * The invention rule is here rather than only in her system instructions
 * because this is where it is read: the list and the licence to go outside it
 * are one thought, and a model weighing "does anything here fit?" is looking at
 * this block, not at a paragraph three sections up. The instructions carry it
 * too — owner ruling, 21 Sept 2026: inventing needs a strong case.
 */
const HEADING = 'What you can already record about this person, and what each one means:';

const RULE = [
  'Use one of these names whenever one fits, even loosely — they are what the',
  'people who run this place decided is worth understanding, and a reading filed',
  'under one of them is read back properly.',
  'Only invent a new name when something genuinely matters to this person and',
  'nothing above covers it. That is the exception, not the habit: an invented',
  'name is nobody’s decision but yours, it is never shown to anyone, and it',
  'cannot be handled as carefully as the ones above. If in doubt, use the',
  'closest name here.',
].join('\n');

/**
 * One line per slot, in the order the store returns them (group, then slug).
 *
 * **Newlines collapsed, and that is structural.** `buildContext` frames this
 * whole block with a fence at column 0, and a description is free text an admin
 * types or uploads. A description containing a newline followed by a fence would
 * close the block early and continue as prose the model reads as its own
 * instructions — the same hole `exemplars.ts` quotes every passage line to
 * close. One line per slot means nothing from the table can reach column 0
 * except the `- ` this writes.
 *
 * **The slug is flattened too, not just the description** — found by
 * /code-review. `app_slot_definition.slug` is a plain `String` with no database
 * constraint, and `loadGlobalSlotDefinitions()` validates only the four
 * classifier columns. Today's writers (the seed, t-71's editor) both validate a
 * slug, so a newline in one needs a hand edit to the table — but the invariant
 * above is stated absolutely, and enforcing it for one field while assuming it
 * of the other is how a stated invariant becomes untrue without anyone editing
 * the sentence.
 */
function line(slot: { slug: string; description: string }): string {
  return `- ${flatten(slot.slug)}: ${flatten(slot.description)}`;
}

/** Any run of whitespace to one space. Applied to the SLUG as well — see {@link line}. */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * The vocabulary block, or `''` when there is nothing to offer.
 *
 * Empty rather than a note, on an unseeded database or a failed read: a block
 * saying "the list could not be loaded" would tell the model the list exists
 * and is being withheld, which is an invitation to invent. With no block she
 * behaves as she did before this existed — she invents — and the log line below
 * is how an operator finds out, rather than the profile filling with minted
 * slugs and nobody knowing why.
 *
 * Grouped by the store's own ordering rather than by a heading per group. A
 * group key is a bucket for the editor, not a thing to explain to a model, and
 * `life_areas` as a heading says less than the slugs beneath it already do.
 */
export async function slotVocabulary(): Promise<string> {
  let offered: Awaited<ReturnType<typeof loadGlobalSlotDefinitions>>;
  try {
    offered = await loadGlobalSlotDefinitions();
  } catch (err) {
    // Never throws out to the contributor: `buildContext` catches a failing
    // contributor by blanking the whole context block, which would take her
    // register and her own passages with it. Degrade to no vocabulary.
    logger.warn('slotVocabulary: could not read the taxonomy; she will not be offered one', {
      error: err instanceof Error ? err.message : String(err),
    });
    return '';
  }

  const visible = offered.filter((slot) => slot.visibility !== SLOT_VISIBILITY.hidden);
  if (visible.length === 0) {
    logger.warn(
      'slotVocabulary: no active, visible slot definitions — she is capturing with no taxonomy in front of her, so anything she records will be a minted slug'
    );
    return '';
  }

  return [HEADING, '', ...visible.map(line), '', RULE].join('\n');
}
