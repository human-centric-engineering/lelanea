/**
 * The question editor, now that answers are filed under question ids
 * (f-onboarding t-101).
 *
 * Each case guards something that would fail silently. A reused id would file a
 * new question's answers together with the old one's, so people's words would
 * read as replies to a question they were never asked. An import that reset
 * weights would quietly empty the Core Set. A reworded question that did not
 * re-sync would leave the AI reading the old wording beside every answer.
 *
 * Run against the REAL seeded rows (`content-db-fake.ts`), with the one slot
 * projection the editor reads inserted by hand.
 *
 * @see lib/app/content/admin/questions.ts
 * @see lib/app/content/admin/registry.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import { createContentDbFake, type ContentDbFake } from '@/tests/helpers/app/content-db-fake';

const db = vi.hoisted(() => ({ current: null as ContentDbFake | null }));
vi.mock('@/lib/db/client', () => ({
  prisma: new Proxy({}, { get: (_target, key) => db.current?.client[key as string] }),
}));
vi.mock('@/lib/app/content/knowledge-mirror', () => ({
  reconcileKnowledgeMirror: vi.fn(async () => ({ status: 'reconciled', failed: [] })),
}));

const resync = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/slots/definitions-admin', () => ({ resyncGlobalSlots: resync }));

import { seedJourneyStructure } from '@/lib/app/content/journey-store';
import { seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import {
  applyQuestionsImport,
  createQuestion,
  deleteQuestion,
  exportQuestionsFile,
  getQuestionsAdminView,
  previewQuestionsImport,
  restoreQuestionRevision,
  restoreQuestionSetRevision,
  updateQuestion,
  updateQuestionSet,
} from '@/lib/app/content/admin/questions';
import { collectionHandlers, entityHandlers } from '@/lib/app/content/admin/registry';
import {
  questionCreateSchema,
  questionSaveSchema,
  questionSetSaveSchema,
} from '@/lib/app/content/admin/validation';
import type { DiscoveryQuestionsFile } from '@/lib/app/content/schemas';

const EDITOR = 'editor';
const NEW_QUESTION = {
  text: 'A new one?',
  inputType: 'long_text' as const,
  hint: null,
  conditionalFollowUp: null,
  weight: 100,
};

/** What the global sync leaves behind for a question: its slot, active or not. */
function slotFor(fake: ContentDbFake, questionId: string, isActive = true) {
  fake.insert('slotDefinition', {
    id: `slot-${questionId}`,
    slug: `discovery_${questionId}`,
    scope: 'global',
    isActive,
  });
}

async function questionView(id: string) {
  return (await getQuestionsAdminView()).set!.questions.find((question) => question.id === id)!;
}

async function exported(): Promise<DiscoveryQuestionsFile> {
  return JSON.parse(JSON.stringify(await exportQuestionsFile())) as DiscoveryQuestionsFile;
}

beforeEach(async () => {
  vi.clearAllMocks();
  resync.mockResolvedValue({ status: 'synced' });
  db.current = createContentDbFake();
  const client = db.current.client as unknown as PrismaClient;
  await seedJourneyStructure(buildJourneySeed(), client);
  await seedDiscoveryQuestions(buildQuestionSeed(), client);
});

describe('a question id is never given out twice', () => {
  it('a new question takes the id after the highest, not a removed one’s', async () => {
    // q30 is the last question. Remove it, as the sync would leave it: a
    // deactivated slot with people's answers still filed under it.
    const q30 = await questionView('q30');
    await deleteQuestion('q30', q30.revision, EDITOR);
    slotFor(db.current!, 'q30', false);

    const created = await createQuestion(NEW_QUESTION, EDITOR);

    expect(created.id).toBe('q31');
  });

  it('still hands out the next id when nothing was ever removed', async () => {
    // The population is the seeded set, so "q31" is not an accident of an
    // empty table.
    expect((await getQuestionsAdminView()).set!.questions).toHaveLength(30);

    await expect(createQuestion(NEW_QUESTION, EDITOR)).resolves.toMatchObject({ id: 'q31' });
  });

  it('an import that would re-create a removed question’s id is refused, naming it', async () => {
    const file = await exported();
    const q30 = await questionView('q30');
    await deleteQuestion('q30', q30.revision, EDITOR);
    slotFor(db.current!, 'q30', false);

    // The file still has q30: importing it would bring the id back.
    const plan = await previewQuestionsImport(file, false);

    expect(plan.refusals).toEqual([expect.stringContaining('"q30"')]);
    await expect(applyQuestionsImport(file, false, EDITOR)).rejects.toThrow(/q30/);
  });

  it('an id with answers but no slot yet is not given out either', async () => {
    // A question added while the sync was failing: answered, then removed,
    // before any sync projected its slot. The answers are the only trace.
    const q30 = await questionView('q30');
    await deleteQuestion('q30', q30.revision, EDITOR);
    db.current!.insert('slotValue', {
      id: 'answer-1',
      userId: 'someone',
      slotSlug: 'discovery_q30',
      version: 1,
      value: 'Their words.',
    });

    await expect(createQuestion(NEW_QUESTION, EDITOR)).resolves.toMatchObject({ id: 'q31' });
  });

  it('a live question with a slot is not mistaken for a removed one', async () => {
    slotFor(db.current!, 'q01');
    slotFor(db.current!, 'q02');

    const plan = await previewQuestionsImport(await exported(), false);

    expect(plan.refusals).toEqual([]);
  });
});

describe('the weight and the Core Set switch', () => {
  it('a weight edit is saved as a revision and served', async () => {
    const q02 = await questionView('q02');
    const result = await updateQuestion(
      'q02',
      { ...NEW_QUESTION, text: q02.text, hint: q02.hint ?? null, weight: 40 },
      q02.revision,
      EDITOR
    );

    expect(result.changed).toEqual(['weight']);
    expect((await questionView('q02')).weight).toBe(40);
    const revisions = db
      .current!.rows('appDiscoveryQuestionRevision')
      .filter((row) => row.questionId === 'q02');
    expect(revisions.at(-1)).toMatchObject({ weight: 40, changedFields: ['weight'] });
  });

  it('switching the Core Set on is a set revision', async () => {
    const result = await switchCoreSetOn();

    expect(result.changed).toEqual(['coreOnly']);
    expect((await getQuestionsAdminView()).set!.coreOnly).toBe(true);
  });

  async function switchCoreSetOn() {
    const view = (await getQuestionsAdminView()).set!;
    const { collection, preamble, pacing } = view;

    return updateQuestionSet(
      collection.id,
      {
        title: collection.title,
        chartTitle: collection.chartTitle,
        moduleId: collection.module,
        phase: collection.phase,
        preamble,
        pacing,
        version: collection.version,
        locale: collection.locale,
        coreOnly: true,
      },
      collection.revision,
      EDITOR
    );
  }

  it('an import of her file, which carries no weights, keeps the stored weights and switch', async () => {
    const q02 = await questionView('q02');
    await updateQuestion(
      'q02',
      { ...NEW_QUESTION, text: q02.text, hint: q02.hint ?? null, weight: 40 },
      q02.revision,
      EDITOR
    );
    await switchCoreSetOn();
    const file = await exported();
    for (const question of file.questions) delete question.weight;

    const plan = await previewQuestionsImport(file, false);

    expect(plan.writesNothing).toBe(true);
    await applyQuestionsImport(file, false, EDITOR);
    expect((await questionView('q02')).weight).toBe(40);
    expect((await getQuestionsAdminView()).set!.coreOnly).toBe(true);
  });

  it('restoring an old wording brings back the words and keeps the weight', async () => {
    const q07 = await questionView('q07');
    // Reword it, then take it out of the Core Set.
    await updateQuestion(
      'q07',
      { ...NEW_QUESTION, text: 'Reworded?', hint: q07.hint ?? null, weight: 100 },
      q07.revision,
      EDITOR
    );
    const reworded = await questionView('q07');
    await updateQuestion(
      'q07',
      { ...NEW_QUESTION, text: reworded.text, hint: reworded.hint ?? null, weight: 40 },
      reworded.revision,
      EDITOR
    );
    const lowered = await questionView('q07');

    // Revision 1 is the seed: the original words, at weight 100.
    const result = await restoreQuestionRevision('q07', 1, lowered.revision, EDITOR);

    expect(result.changed).toEqual(['text']);
    expect(await questionView('q07')).toMatchObject({ text: q07.text, weight: 40 });
  });

  it('restoring an old framing keeps the Core Set switch on', async () => {
    await switchCoreSetOn();
    const view = (await getQuestionsAdminView()).set!;
    await updateQuestionSet(
      view.collection.id,
      {
        title: view.collection.title,
        chartTitle: view.collection.chartTitle,
        moduleId: view.collection.module,
        phase: view.collection.phase,
        preamble: { ...view.preamble, text: 'A new preamble.' },
        pacing: view.pacing,
        version: view.collection.version,
        locale: view.collection.locale,
        coreOnly: true,
      },
      view.collection.revision,
      EDITOR
    );
    const edited = (await getQuestionsAdminView()).set!;

    // Revision 1 is the seed: the original preamble, with the switch off.
    const result = await restoreQuestionSetRevision(
      edited.collection.id,
      1,
      edited.collection.revision,
      EDITOR
    );

    expect(result.changed).toEqual(['preamble']);
    const after = (await getQuestionsAdminView()).set!;
    expect(after.preamble.text).toBe(view.preamble.text);
    expect(after.coreOnly).toBe(true);
  });

  it('an import whose file names a weight applies it', async () => {
    const file = await exported();
    file.questions[1].weight = 25;

    await applyQuestionsImport(file, false, EDITOR);

    expect((await questionView('q02')).weight).toBe(25);
  });

  it('an export carries the weights, so a round trip keeps them', async () => {
    const file = await exported();

    expect(file.questions.every((question) => question.weight === 100)).toBe(true);
  });
});

describe('what the edit routes accept', () => {
  it('a save must send the weight, so a form that forgot it cannot reset it', () => {
    const { weight: _weight, ...withoutWeight } = NEW_QUESTION;

    expect(questionSaveSchema.safeParse({ ...withoutWeight, revision: 1 }).success).toBe(false);
    expect(
      questionSaveSchema.safeParse({ ...NEW_QUESTION, weight: null, revision: 1 }).success
    ).toBe(false);
  });

  it('a weight is a whole number from 0 to 100', () => {
    for (const weight of [-1, 101, 50.5]) {
      expect(questionSaveSchema.safeParse({ ...NEW_QUESTION, weight, revision: 1 }).success).toBe(
        false
      );
    }
    for (const weight of [0, 100]) {
      expect(questionSaveSchema.safeParse({ ...NEW_QUESTION, weight, revision: 1 }).success).toBe(
        true
      );
    }
  });

  it('a new question is fully weighted unless it says otherwise', () => {
    const { weight: _weight, ...withoutWeight } = NEW_QUESTION;

    expect(questionCreateSchema.parse(withoutWeight).weight).toBe(100);
    expect(questionCreateSchema.parse({ ...withoutWeight, weight: 30 }).weight).toBe(30);
  });

  it('a set save must say whether the Core Set is on', () => {
    const body = {
      title: 'T',
      chartTitle: 'C',
      moduleId: 'module_00_onboarding',
      phase: 8,
      preamble: { style: 'italic', text: 'P' },
      pacing: { rushDiscouraged: true, allowPartialCompletion: true, note: 'N' },
      version: '1.0',
      locale: 'en',
      revision: 1,
    };

    expect(questionSetSaveSchema.safeParse(body).success).toBe(false);
    expect(questionSetSaveSchema.safeParse({ ...body, coreOnly: false }).success).toBe(true);
  });
});

describe('a question write re-projects the slot its answers are filed under', () => {
  const question = entityHandlers('questions', 'question');

  it('rewording re-syncs, and says how the sync went', async () => {
    const q01 = await questionView('q01');

    const outcome = await question.save(
      'q01',
      { ...NEW_QUESTION, text: 'Reworded?', hint: q01.hint ?? null, revision: q01.revision },
      EDITOR
    );

    expect(resync).toHaveBeenCalledTimes(1);
    expect(outcome.result).toMatchObject({ slotSync: { status: 'synced' } });
    // The audit entry records the revision, not the sync.
    expect(outcome.audit).toEqual({ revision: q01.revision + 1 });
  });

  it('a save that changes nothing still re-syncs, so saving again is a real retry', async () => {
    const q01 = await questionView('q01');

    const outcome = await question.save(
      'q01',
      { ...NEW_QUESTION, text: q01.text, hint: q01.hint ?? null, revision: q01.revision },
      EDITOR
    );

    expect(outcome.changed).toEqual([]);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(outcome.result).toMatchObject({ slotSync: { status: 'synced' } });
  });

  it('a failed sync is reported on a save that did commit', async () => {
    resync.mockResolvedValue({ status: 'failed', message: 'the sync threw' });
    const q01 = await questionView('q01');

    const outcome = await question.save(
      'q01',
      { ...NEW_QUESTION, text: 'Reworded again?', hint: q01.hint ?? null, revision: q01.revision },
      EDITOR
    );

    expect(outcome.result).toMatchObject({ slotSync: { status: 'failed' } });
    expect((await questionView('q01')).text).toBe('Reworded again?');
  });

  it('adding and removing a question both re-sync', async () => {
    const created = await question.create!(NEW_QUESTION, EDITOR);
    const view = await questionView(created.id);
    await question.remove!(created.id, view.revision, EDITOR);

    expect(resync).toHaveBeenCalledTimes(2);
  });

  it('an import re-syncs, even one that writes nothing, so re-applying a file is a retry', async () => {
    const handlers = collectionHandlers('questions');
    const file = await exported();

    const plan = await handlers.apply(file, false, EDITOR);

    expect(plan.writesNothing).toBe(true);
    expect(resync).toHaveBeenCalledTimes(1);
  });
});
