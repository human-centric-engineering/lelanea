/**
 * The discovery questions as data slots (f-onboarding t-101).
 *
 * What reaches Daybreak's global slot sync (and from there the admin slot
 * browser, `get_state` and the person's own panel), and which questions a
 * person is asked under the Core Set switch.
 *
 * Two cases here would be silent in production if wrong. A projection graded
 * `special_category` would throw every answer away at the write (masking runs
 * before storage), and nothing would error. And a provider that appended the
 * discovery slots to an EMPTY taxonomy would turn Daybreak's "empty means a
 * fluke, retire nothing" into "retire every taxonomy slot".
 *
 * @see lib/app/onboarding/discovery-slots.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  appDiscoveryQuestion: { findMany: vi.fn() },
  slotValue: { findMany: vi.fn(), count: vi.fn() },
  slotDefinition: { findMany: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

const loadTaxonomy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/slots/taxonomy-store', () => ({ loadGlobalSlotDefinitions: loadTaxonomy }));

const getQuestions = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/content/question-store', () => ({
  DISCOVERY_QUESTION_SET_ID: 'onboarding_discovery_questions',
  getDiscoveryQuestions: getQuestions,
}));

const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: loggerMock }));

import {
  getDiscoverySet,
  loadAppGlobalSlotDefinitions,
  loadDiscoverySlotDefinitions,
  toDiscoverySlotDefinition,
} from '@/lib/app/onboarding/discovery-slots';
import {
  DISCOVERY_SLOT_GROUP,
  discoverySlotSlug,
  isDiscoverySlotSlug,
} from '@/lib/app/onboarding/discovery-slot-names';
import { listSlotValueHeadsForAdmin } from '@/lib/framework/data-slots/admin-queries';
import { slotMaskingPolicy } from '@/lib/framework/data-slots/capabilities/masking';
import { FRAMEWORK_SUBJECT_DATA_SOURCES } from '@/lib/framework/privacy/export-sources';
import type { DiscoveryQuestionSet, DiscoveryQuestionView } from '@/lib/app/content/question-view';

function question(id: string, number: number, weight = 100): DiscoveryQuestionView {
  return { id, number, text: `Question ${id}?`, inputType: 'long_text', weight, revision: 1 };
}

function set(questions: DiscoveryQuestionView[], coreOnly = false): DiscoveryQuestionSet {
  return {
    collection: {
      id: 'onboarding_discovery_questions',
      title: 'Discovery',
      chartTitle: 'Discovery',
      module: 'module_00_onboarding',
      phase: 8,
      version: '1.0',
      locale: 'en',
      revision: 1,
    },
    preamble: { style: 'italic', text: 'Not to be rushed.' },
    pacing: { rushDiscouraged: true, allowPartialCompletion: true, note: 'Resumable.' },
    coreOnly,
    questions,
  };
}

const TAXONOMY_SLOT = {
  slug: 'aspirations',
  group: 'the_person',
  description: 'What they hope for.',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the slot a question projects to', () => {
  it('files the answer under the question id, in the discovery group, in the person’s view', () => {
    expect(toDiscoverySlotDefinition({ id: 'q07', text: 'What do you want?' })).toEqual({
      slug: 'discovery_q07',
      group: DISCOVERY_SLOT_GROUP,
      description: 'What do you want?',
      visibility: 'open',
      mode: 'targeted',
      dataType: 'text',
      sensitivity: 'sensitive',
      priorityWeight: 0,
    });
  });

  it('is graded so the person’s words are kept at the write, not replaced by a sentinel', () => {
    // The owner ruling, executed: run the projected grade through Daybreak's
    // real masking-before-storage. `special_category` would hand back a
    // sentinel here; the words must survive.
    const { sensitivity, dataType } = toDiscoverySlotDefinition({ id: 'q01', text: 'Q?' });
    const words = 'My mother was ill for most of my childhood.';

    expect(slotMaskingPolicy(sensitivity!, dataType!, { value: words, valueJson: words })).toEqual({
      value: words,
      valueJson: words,
    });
    // And the grade that WOULD lose them, so the assertion above is not vacuous.
    expect(
      slotMaskingPolicy('special_category', dataType!, { value: words, valueJson: words }).value
    ).not.toBe(words);
  });

  it('names and recognises discovery slugs, and nothing else', () => {
    expect(discoverySlotSlug('q30')).toBe('discovery_q30');
    expect(isDiscoverySlotSlug('discovery_q30')).toBe(true);
    expect(isDiscoverySlotSlug('aspirations')).toBe(false);
    expect(isDiscoverySlotSlug('discoveryq30')).toBe(false);
  });
});

describe('where an answer goes once it is written', () => {
  it('is masked on the admin slot browser unless an admin reveals it', async () => {
    const definition = toDiscoverySlotDefinition({ id: 'q01', text: 'Q?' });
    prismaMock.slotValue.findMany.mockResolvedValue([
      {
        id: 'v1',
        userId: 'u1',
        slotSlug: definition.slug,
        version: 1,
        value: 'Their own words.',
        valueJson: null,
        confidence: 1,
        sourceType: 'direct',
        capturedAt: new Date('2026-09-25T10:00:00Z'),
      },
    ]);
    prismaMock.slotValue.count.mockResolvedValue(1);
    prismaMock.slotDefinition.findMany.mockResolvedValue([
      { slug: definition.slug, sensitivity: definition.sensitivity },
    ]);

    const hidden = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: false });
    const revealed = await listSlotValueHeadsForAdmin({ page: 1, limit: 10, reveal: true });

    expect(hidden.items[0]).toMatchObject({ masked: true });
    expect(hidden.items[0].value).not.toBe('Their own words.');
    expect(revealed.items[0]).toMatchObject({ masked: false, value: 'Their own words.' });
  });

  it('is in the person’s subject-access export, with every earlier version', () => {
    // Discovery answers are ordinary slot values, so Daybreak's own source
    // covers them. Erasure is the hand-written ON DELETE CASCADE on
    // `framework_slot_value.userId`, pinned by Daybreak's erasure tests.
    const source = FRAMEWORK_SUBJECT_DATA_SOURCES.find((entry) => entry.model === 'SlotValue');
    expect(source).toMatchObject({ disposition: 'export', section: 'slotValues' });
  });
});

describe('the global slot provider', () => {
  it('hands over the taxonomy, then one slot per live question', async () => {
    loadTaxonomy.mockResolvedValue([TAXONOMY_SLOT]);
    prismaMock.appDiscoveryQuestion.findMany.mockResolvedValue([
      { id: 'q01', text: 'First?' },
      { id: 'q02', text: 'Second?' },
    ]);

    const definitions = await loadAppGlobalSlotDefinitions();

    expect(definitions.map((definition) => definition.slug)).toEqual([
      'aspirations',
      'discovery_q01',
      'discovery_q02',
    ]);
    expect(prismaMock.appDiscoveryQuestion.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { setId: 'onboarding_discovery_questions' } })
    );
  });

  it('hands over nothing at all when the taxonomy supplies nothing, so the sync retires nothing', async () => {
    loadTaxonomy.mockResolvedValue([]);
    prismaMock.appDiscoveryQuestion.findMany.mockResolvedValue([{ id: 'q01', text: 'First?' }]);

    await expect(loadAppGlobalSlotDefinitions()).resolves.toEqual([]);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('discovery slots are held back')
    );
    // Not even read: nothing it returned could be used.
    expect(prismaMock.appDiscoveryQuestion.findMany).not.toHaveBeenCalled();
  });

  it('projects no discovery slots when the questions are not in the database', async () => {
    prismaMock.appDiscoveryQuestion.findMany.mockResolvedValue([]);

    await expect(loadDiscoverySlotDefinitions()).resolves.toEqual([]);
  });
});

describe('which questions a person is asked', () => {
  const questions = [question('q01', 1, 100), question('q02', 2, 40), question('q03', 3, 100)];

  it('asks every question, with the slot each is filed under, when the Core Set is off', async () => {
    getQuestions.mockResolvedValue(set(questions, false));

    const asked = await getDiscoverySet();

    expect(asked.coreOnly).toBe(false);
    expect(asked.questions.map((q) => [q.id, q.slotSlug])).toEqual([
      ['q01', 'discovery_q01'],
      ['q02', 'discovery_q02'],
      ['q03', 'discovery_q03'],
    ]);
  });

  it('asks only the fully weighted questions when the Core Set is on, keeping their numbers', async () => {
    getQuestions.mockResolvedValue(set(questions, true));

    const asked = await getDiscoverySet();

    expect(asked.coreOnly).toBe(true);
    expect(asked.questions.map((q) => [q.id, q.number])).toEqual([
      ['q01', 1],
      ['q03', 3],
    ]);
  });

  it('asks every question, and says why, when the Core Set is on but nothing is fully weighted', async () => {
    getQuestions.mockResolvedValue(set([question('q01', 1, 90), question('q02', 2, 40)], true));

    const asked = await getDiscoverySet();

    expect(asked.questions.map((q) => q.id)).toEqual(['q01', 'q02']);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('no question is fully weighted')
    );
  });

  it('carries the preamble and pacing through', async () => {
    getQuestions.mockResolvedValue(set(questions));

    const asked = await getDiscoverySet();

    expect(asked.preamble.text).toBe('Not to be rushed.');
    expect(asked.pacing.allowPartialCompletion).toBe(true);
  });
});
