/**
 * The discovery questions as the data slots of the module that asks them
 * (f-onboarding t-101).
 *
 * Each discovery question is a slot: the person's answer is written as that
 * slot's value, in their own words, with provenance. So it is exported,
 * erased, read back through `get_state` and shown in the person's own panel
 * like everything else the app holds about them (owner ruling at claim,
 * journalled on §15).
 *
 * ## Onboarding's slots, declared the way Daybreak declares a module's
 *
 * The slots are the `slotDefinitions` of the module the set names (Onboarding,
 * in her file), so Daybreak scopes them `module:onboarding` and the module owns
 * them (`.context/app/building-with-daybreak.md`). They are built from
 * `app_discovery_question`, the one place an admin edits a question's words,
 * and handed to `registerModule()` with the module's names, the way t-87 hands
 * it their titles. Nothing of Daybreak's is edited or wrapped: after a question
 * write, {@link resyncDiscoverySlots} registers the modules again and runs
 * Daybreak's own slot sync. Being module slots does not hide them from later
 * modules: `get_state` reads a person's values in every scope, filtered only
 * by the agent's allowlist, which names the `discovery` group.
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
import { getRegisteredModule, registerModule } from '@/lib/framework/modules/registry';
import {
  SLOT_DATA_TYPE,
  SLOT_MODE,
  SLOT_SCOPE_MODULE_PREFIX,
  SLOT_SENSITIVITY,
  SLOT_VISIBILITY,
  listSlotDefinitions,
  syncRegisteredSlotDefinitions,
  type SlotDefinitionInput,
} from '@/lib/framework/data-slots';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import type { JourneyStructure } from '@/lib/app/content/journey-view';
import { DISCOVERY_QUESTION_SET_ID, getDiscoveryQuestions } from '@/lib/app/content/question-store';
import { FULL_WEIGHT, type DiscoveryQuestionView } from '@/lib/app/content/question-view';
import {
  getModuleDefinitions,
  moduleSlugFromId,
  type DiscoveryModuleSlots,
} from '@/lib/app/modules/definitions';
import { JOURNEY_MODULES } from '@/lib/app/journey/roster';
import { readDiscoveryConfig } from '@/lib/app/onboarding/discovery-config-store';
import {
  DISCOVERY_SLOT_GROUP,
  DISCOVERY_SLOT_PREFIX,
  discoverySlotSlug,
  isDiscoverySlotSlug,
} from '@/lib/app/onboarding/discovery-slot-names';

/**
 * The slot one question projects to.
 *
 * `description` is the question's own words, because it is what the slot means
 * and what an admin reading a value sees beside it. The number is left out:
 * reordering the set must not rewrite every slot.
 *
 * `priorityWeight` is 0, not the question's weight. Daybreak defines it as
 * sequencing ("higher = asked sooner"), and a question's weight says something
 * else: whether it is core, which the owner defines as asked and never
 * skippable. Borrowing the column would bend Daybreak's meaning.
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
 * The module the set names, and one slot per live question. `null` when the
 * set is not in the database, which is the truth rather than a fault: the
 * module then declares no slots. A failed read throws.
 */
export async function loadDiscoveryModuleSlots(): Promise<DiscoveryModuleSlots | null> {
  const set = await prisma.appQuestionSet.findFirst({
    where: { slug: DISCOVERY_QUESTION_SET_ID },
    select: {
      moduleSlug: true,
      questions: { select: { slug: true, text: true }, orderBy: { number: 'asc' } },
    },
  });
  if (!set) return null;
  return {
    moduleId: set.moduleSlug,
    slotDefinitions: set.questions.map(({ slug, text }) =>
      toDiscoverySlotDefinition({ id: slug, text })
    ),
  };
}

/**
 * The discovery slots as Daybreak last synced them: the active `discovery_`
 * rows in a module scope, read through Daybreak's own slot reader and
 * re-projected exactly as the questions would be. The fallback when the
 * questions cannot be read, so the module keeps declaring what it declared.
 * `null` when there are none, or their module is not on the journey.
 */
async function lastSyncedDiscoverySlots(): Promise<DiscoveryModuleSlots | null> {
  const rows = (await listSlotDefinitions()).filter(
    (row) =>
      row.isActive &&
      isDiscoverySlotSlug(row.slug) &&
      row.scope.startsWith(SLOT_SCOPE_MODULE_PREFIX)
  );
  const moduleSlug = rows[0]?.scope.slice(SLOT_SCOPE_MODULE_PREFIX.length);
  const owner = JOURNEY_MODULES.find((entry) => moduleSlugFromId(entry.id) === moduleSlug);
  if (!owner) return null;
  return {
    moduleId: owner.id,
    slotDefinitions: rows
      .filter((row) => row.scope === rows[0]?.scope)
      .map((row) =>
        toDiscoverySlotDefinition({
          id: row.slug.slice(DISCOVERY_SLOT_PREFIX.length),
          text: row.description,
        })
      ),
  };
}

/** Where the discovery slots a registration declared came from. */
export type DiscoverySource = 'questions' | 'last-synced' | 'none';

/**
 * Register the journey's modules with their words and the discovery slots,
 * replacing the registration in place (`registerModule` is idempotent by
 * slug). **Never throws**: Daybreak's boot contract is that boot never rejects
 * into instrumentation (`tests/integration/lib/framework/boot.test.ts`).
 *
 * Each read that fails is logged and has a fallback:
 * - **The journey text** keeps the names already registered, so a failed read
 *   on a question save does not undo boot's; at boot those are the roster's,
 *   spelled from the slug. That is cosmetic.
 * - **The discovery questions** fall back to the slots Daybreak last synced,
 *   so the module declares what it declared before. Registering Onboarding
 *   with no slots would have Daybreak's module pass retire every one of them.
 *   Only when that read fails too does the module register without them, and
 *   then the database is unreachable, so the sync that follows cannot write
 *   either. If it somehow can, the slots are deactivated, not deleted: the
 *   answers stay, and the next registration that reads the questions
 *   reactivates them.
 */
export async function registerJourneyModules(): Promise<DiscoverySource> {
  let structure: JourneyStructure | undefined;
  try {
    structure = await getJourneyStructure();
  } catch (err) {
    logger.warn(
      'registerJourneyModules: module names could not be read; registered from the roster',
      {
        error: err instanceof Error ? err.message : String(err),
      }
    );
  }

  let discovery: DiscoveryModuleSlots | null = null;
  let source: DiscoverySource = 'none';
  try {
    discovery = await loadDiscoveryModuleSlots();
    source = 'questions';
  } catch (err) {
    logger.error(
      'registerJourneyModules: the discovery questions could not be read; declaring the slots as last synced',
      { error: err instanceof Error ? err.message : String(err) }
    );
    try {
      discovery = await lastSyncedDiscoverySlots();
      source = discovery ? 'last-synced' : 'none';
    } catch (fallbackErr) {
      logger.error(
        'registerJourneyModules: the last-synced discovery slots could not be read either; registering the module without them',
        { error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr) }
      );
    }
  }

  for (const definition of getModuleDefinitions(structure, discovery ?? undefined)) {
    const current = structure ? undefined : getRegisteredModule(definition.slug);
    registerModule(
      current ? { ...definition, name: current.name, description: current.description } : definition
    );
  }
  return source;
}

/** What a question write says about the slots its answers are filed under. */
export type DiscoverySlotSyncOutcome = { status: 'synced' } | { status: 'failed'; message: string };

/** The tail of the re-sync queue; see `resyncDiscoverySlots`. */
let resyncQueue: Promise<void> = Promise.resolve();

/**
 * Re-project the discovery slots after a question write: register the modules
 * again with the questions as they now are, then run Daybreak's slot sync.
 * Reported, never thrown: the write has committed either way.
 *
 * The sync is idempotent, so a run with nothing to change writes nothing.
 *
 * **One at a time, in this process.** The module registry is process-global,
 * so two overlapping writes could each register, and the older snapshot land
 * last and be the one synced while the newer write reports `synced`. Queued
 * the way Daybreak queues its own global slot sync.
 */
export function resyncDiscoverySlots(
  context: Record<string, unknown>
): Promise<DiscoverySlotSyncOutcome> {
  const run = resyncQueue.then(() => resyncNow(context));
  resyncQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function resyncNow(context: Record<string, unknown>): Promise<DiscoverySlotSyncOutcome> {
  try {
    // Not from the questions means this write did not reach the slots: sync
    // nothing, and say so, rather than re-declare what was already there.
    if ((await registerJourneyModules()) !== 'questions') {
      throw new Error('the discovery questions could not be read');
    }
    await syncRegisteredSlotDefinitions();
    return { status: 'synced' };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'the slot sync failed';
    logger.error(
      'discovery slots: the question write committed but the slots did not follow — the agent is still reading the previous questions until the next save or boot',
      { ...context, error: message }
    );
    return { status: 'failed', message };
  }
}

/** One question as the member surface asks it: the served question and its slot. */
export interface DiscoveryQuestionToAsk extends DiscoveryQuestionView {
  slotSlug: string;
  /** Fully weighted: asked, and never skippable (owner ruling, 25 Sept 2026). */
  core: boolean;
}

/** The questions to ask, under the module's current Core Set setting. */
export interface DiscoverySetToAsk {
  /** The slug of the module that asks them: the provenance an answer is written with. */
  moduleSlug: string;
  preamble: { style: string; text: string };
  pacing: { rushDiscouraged: boolean; allowPartialCompletion: boolean; note: string };
  /** Whether only the Core Set is being asked (the module's config). */
  coreOnly: boolean;
  questions: readonly DiscoveryQuestionToAsk[];
}

/**
 * The questions a person is asked, in order, each with the slot its answer is
 * written to and whether it is core. With the module's Core Set switch on,
 * only the core ones.
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
  const moduleSlug = moduleSlugFromId(set.collection.module);
  const { coreSetOnly } = await readDiscoveryConfig(moduleSlug);
  const all = set.questions.map((question) => ({
    ...question,
    slotSlug: discoverySlotSlug(question.id),
    core: question.weight >= FULL_WEIGHT,
  }));
  let questions = all;
  if (coreSetOnly) {
    const core = all.filter((question) => question.core);
    if (core.length === 0) {
      logger.error(
        'getDiscoverySet: the Core Set is switched on but no question is fully weighted — asking every question instead'
      );
    } else {
      questions = core;
    }
  }
  return {
    moduleSlug,
    preamble: set.preamble,
    pacing: set.pacing,
    coreOnly: coreSetOnly,
    questions,
  };
}
