/**
 * The discovery questions as data slots (f-onboarding t-101).
 *
 * Each discovery question is a slot: the person's answer is written as that
 * slot's value, in their own words, with provenance. So it is exported,
 * erased, read back through `get_state` and shown in the person's own panel
 * like everything else the app holds about them (owner ruling at claim,
 * journalled on §15).
 *
 * ## Why a projection of the questions, not rows in the taxonomy
 *
 * The definitions are derived from `app_discovery_question` and handed to
 * Daybreak's global slot sync beside the authored taxonomy
 * ({@link loadAppGlobalSlotDefinitions}). They are never written into
 * `app_slot_definition`. The question row is already the one place an admin
 * edits a question's words, with revisions; a second editable copy in the
 * taxonomy could disagree with it. The projection is a pure code projection,
 * so the sync reconciles it fully (`fp4`), and removing a question drops its
 * slug, which is how the sync retires a global slot.
 *
 * ## Always `sensitive`, never `special_category`
 *
 * Owner ruling, 25 Sept 2026. Daybreak masks `special_category` BEFORE storage:
 * a free-text value becomes a redaction sentinel as it is written
 * (`lib/framework/data-slots/capabilities/masking.ts`). For a discovery answer
 * that means the person's words are gone, to them and to her, and onboarding's
 * whole purpose (a baseline in their words, mirrored back) is defeated.
 * `sensitive` keeps the words, and the admin slot browser masks them unless an
 * admin deliberately reveals, which is audited. The grade is therefore fixed
 * here rather than editable per question.
 *
 * ## Hers to read, never hers to write
 *
 * `fill_slot` refuses a discovery slug (`lib/app/slots/capture.ts`). An answer
 * is what the person wrote, and a reading of hers appended as a newer version
 * would replace their words as the head value. The slots are also left out of
 * the capture vocabulary she is shown, because that reads the taxonomy alone
 * (`lib/app/slots/vocabulary.ts`).
 *
 * @see lib/app/content/admin/questions.ts — the editor, and why ids are never reused
 * @see .context/app/onboarding.md
 */

import { logger } from '@/lib/logging';
import { prisma } from '@/lib/db/client';
import {
  SLOT_DATA_TYPE,
  SLOT_MODE,
  SLOT_SENSITIVITY,
  SLOT_VISIBILITY,
  type SlotDefinitionInput,
} from '@/lib/framework/data-slots';
import { loadGlobalSlotDefinitions } from '@/lib/app/slots/taxonomy-store';
import { DISCOVERY_QUESTION_SET_ID, getDiscoveryQuestions } from '@/lib/app/content/question-store';
import { FULL_WEIGHT, type DiscoveryQuestionView } from '@/lib/app/content/question-view';
import { DISCOVERY_SLOT_GROUP, discoverySlotSlug } from '@/lib/app/onboarding/discovery-slot-names';

/**
 * The slot one question projects to.
 *
 * `description` is the question's own words, because it is what the slot means
 * and what an admin reading a value sees beside it. The number is left out:
 * reordering the set must not rewrite every slot. `priorityWeight` is 0, not the
 * question's weight. That column sequences HER targeted capture, and she never
 * captures an answer, so the question's weight has nothing to say to it.
 */
export function toDiscoverySlotDefinition(
  question: Pick<DiscoveryQuestionView, 'id' | 'text'>
): SlotDefinitionInput {
  return {
    slug: discoverySlotSlug(question.id),
    group: DISCOVERY_SLOT_GROUP,
    description: question.text,
    visibility: SLOT_VISIBILITY.open,
    mode: SLOT_MODE.targeted,
    dataType: SLOT_DATA_TYPE.text,
    sensitivity: SLOT_SENSITIVITY.sensitive,
    priorityWeight: 0,
  };
}

/**
 * One slot per live discovery question. Empty when the set is not in the
 * database, which is the truth rather than a fault.
 */
export async function loadDiscoverySlotDefinitions(): Promise<SlotDefinitionInput[]> {
  const questions = await prisma.appDiscoveryQuestion.findMany({
    where: { setId: DISCOVERY_QUESTION_SET_ID },
    select: { id: true, text: true },
    orderBy: { number: 'asc' },
  });
  return questions.map(toDiscoverySlotDefinition);
}

/**
 * Lelañea's global slot provider: the authored taxonomy, then the discovery
 * questions. This is what `lib/app/leaf-bootstrap.ts` registers with Daybreak.
 *
 * **An empty taxonomy empties the whole answer.** Daybreak's global pass reads
 * an empty provider as a fluke and retires nothing (the case pinned in
 * `tests/integration/lib/framework/data-slots/global-slots.test.ts`), and
 * `loadGlobalSlotDefinitions` relies on that when every taxonomy row is
 * withheld. With the discovery slots appended, that answer would no longer be
 * empty, and the sync would read it as "retire every taxonomy slot". So when the
 * taxonomy contributes nothing, neither does anything else, and the fluke rule
 * holds exactly as it did before this existed. The cost is that the discovery
 * slots are not projected on a database with no taxonomy. In practice there is
 * always one before any sync that could see the questions: the questions reach
 * every database through data migration
 * `20260928100100_app_journey_questions_resources_data`, before any seed runs,
 * so seed 011's sync already projects them alongside the taxonomy it seeds.
 */
export async function loadAppGlobalSlotDefinitions(): Promise<SlotDefinitionInput[]> {
  const taxonomy = await loadGlobalSlotDefinitions();
  if (taxonomy.length === 0) {
    logger.warn(
      'loadAppGlobalSlotDefinitions: the taxonomy supplied nothing, so the discovery slots are held back too — an empty answer is what keeps the sync from retiring the taxonomy'
    );
    return [];
  }
  return [...taxonomy, ...(await loadDiscoverySlotDefinitions())];
}

/** One question as the member surface asks it: the served question and its slot. */
export interface DiscoveryQuestionToAsk extends DiscoveryQuestionView {
  slotSlug: string;
}

/** The questions to ask, under the set's current Core Set setting. */
export interface DiscoverySetToAsk {
  preamble: { style: string; text: string };
  pacing: { rushDiscouraged: boolean; allowPartialCompletion: boolean; note: string };
  /** Whether only the Core Set is being asked. */
  coreOnly: boolean;
  questions: readonly DiscoveryQuestionToAsk[];
}

/**
 * The questions a person is asked, in order, each with the slot its answer is
 * written to. With the Core Set switched on, only the fully weighted ones.
 *
 * Numbers stay the set's own even when the Core Set skips some. They are the
 * questions' identity in the admin, and renumbering here would make the
 * member's "question 4" and the admin's disagree.
 *
 * **The Core Set is never empty.** If the switch is on and no question is
 * fully weighted, every question is asked and the fault is logged: a switch
 * that silently asked nothing would end onboarding before it started.
 *
 * @throws ContentNotSeededError when the set is not in the database.
 */
export async function getDiscoverySet(): Promise<DiscoverySetToAsk> {
  const set = await getDiscoveryQuestions();
  const all = set.questions.map((question) => ({
    ...question,
    slotSlug: discoverySlotSlug(question.id),
  }));
  let questions = all;
  if (set.coreOnly) {
    const core = all.filter((question) => question.weight >= FULL_WEIGHT);
    if (core.length === 0) {
      logger.error(
        'getDiscoverySet: the Core Set is switched on but no question is fully weighted — asking every question instead'
      );
    } else {
      questions = core;
    }
  }
  return { preamble: set.preamble, pacing: set.pacing, coreOnly: set.coreOnly, questions };
}
