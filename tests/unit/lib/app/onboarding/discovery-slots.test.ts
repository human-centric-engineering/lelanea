/**
 * The discovery questions as the data slots of the module that asks them
 * (f-onboarding t-101).
 *
 * What the module hands Daybreak through `registerModule()` (and from there the
 * slot sync, the admin slot browser, `get_state` and the person's own panel),
 * and which questions a person is asked under the module's Core Set switch.
 *
 * Two cases here would be silent in production if wrong. A projection graded
 * `special_category` would throw every answer away at the write (masking runs
 * before storage), and nothing would error. And registering the module without
 * its slots after a failed read would have Daybreak's module pass retire every
 * discovery slot, so a failed read declares the slots as last synced instead:
 * it cannot throw, because boot must never reject.
 *
 * @see lib/app/onboarding/discovery-slots.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  appQuestionSet: { findFirst: vi.fn() },
  slotValue: { findMany: vi.fn(), count: vi.fn() },
  slotDefinition: { findMany: vi.fn() },
}));
vi.mock('@/lib/db/client', () => ({ prisma: prismaMock }));

const getStructure = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/content/journey-store', () => ({ getJourneyStructure: getStructure }));

const getConfigForm = vi.hoisted(() => vi.fn());
vi.mock('@/lib/framework/modules/config', () => ({ getModuleConfigForm: getConfigForm }));

const syncSlots = vi.hoisted(() => vi.fn());
const listSlots = vi.hoisted(() => vi.fn());
vi.mock('@/lib/framework/data-slots', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/framework/data-slots')>()),
  syncRegisteredSlotDefinitions: syncSlots,
  listSlotDefinitions: listSlots,
}));

const getQuestions = vi.hoisted(() => vi.fn());
vi.mock('@/lib/app/content/question-store', () => ({
  DISCOVERY_QUESTION_SET_ID: 'onboarding_discovery_questions',
  getDiscoveryQuestions: getQuestions,
}));

const loggerMock = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger: loggerMock }));

import {
  getDiscoverySet,
  loadDiscoveryModuleSlots,
  registerJourneyModules,
  resyncDiscoverySlots,
  toDiscoverySlotDefinition,
} from '@/lib/app/onboarding/discovery-slots';
import {
  __resetModuleRegistryForTests,
  getRegisteredModule,
  getRegisteredModules,
  registerModule,
} from '@/lib/framework/modules/registry';
import { describeConfigSchema } from '@/lib/framework/modules/config/schema-descriptors';
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

function set(questions: DiscoveryQuestionView[]): DiscoveryQuestionSet {
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
    questions,
  };
}

/** The module's stored config, as Daybreak's reader hands it back. */
function storedConfig(values: unknown) {
  getConfigForm.mockResolvedValue({ registered: true, descriptors: [], values });
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetModuleRegistryForTests();
  getStructure.mockRejectedValue(new Error('not needed here'));
  storedConfig({});
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

describe('the module that asks them declares them', () => {
  const ONBOARDING_SET = {
    moduleSlug: 'module_00_onboarding',
    questions: [
      { slug: 'q01', text: 'First?' },
      { slug: 'q02', text: 'Second?' },
    ],
  };

  it('reads the module the set names, and one slot per live question', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);

    const discovery = await loadDiscoveryModuleSlots();

    expect(discovery?.moduleId).toBe('module_00_onboarding');
    expect(discovery?.slotDefinitions.map((definition) => definition.slug)).toEqual([
      'discovery_q01',
      'discovery_q02',
    ]);
    expect(prismaMock.appQuestionSet.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: 'onboarding_discovery_questions' } })
    );
  });

  it('declares nothing when the questions are not in the database', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(null);

    await expect(loadDiscoveryModuleSlots()).resolves.toBeNull();
  });

  it('registers Onboarding with the slots and the Core Set switch, and no other module with either', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);

    await registerJourneyModules();

    const onboarding = getRegisteredModule('onboarding');
    expect(onboarding?.slotDefinitions?.map((definition) => definition.slug)).toEqual([
      'discovery_q01',
      'discovery_q02',
    ]);
    expect(describeConfigSchema(onboarding!.configSchema)).toEqual([
      expect.objectContaining({ key: 'coreSetOnly', type: 'boolean', default: false }),
    ]);
    const others = getRegisteredModules().filter((other) => other.slug !== 'onboarding');
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) {
      expect(other.slotDefinitions).toBeUndefined();
      expect(describeConfigSchema(other.configSchema)).toEqual([]);
    }
  });

  it('follows the set to another module when the set names one', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue({
      ...ONBOARDING_SET,
      moduleSlug: 'module_01_values',
    });

    await registerJourneyModules();

    expect(getRegisteredModule('values')?.slotDefinitions).toHaveLength(2);
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toBeUndefined();
  });

  it('keeps the names already registered when a later read of them fails', async () => {
    await registerJourneyModules();
    registerModule({
      ...getRegisteredModule('onboarding')!,
      name: 'Onboarding, as she titled it',
      description: 'Read from its row at boot.',
    });
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);

    await registerJourneyModules();

    expect(getRegisteredModule('onboarding')).toMatchObject({
      name: 'Onboarding, as she titled it',
      description: 'Read from its row at boot.',
    });
    // The slots still follow the questions.
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toHaveLength(2);
  });

  it('still declares the slots when only the module names could not be read', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);

    await registerJourneyModules();

    expect(getRegisteredModule('onboarding')?.name).toBe('Onboarding');
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toHaveLength(2);
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('module names could not be read'),
      expect.anything()
    );
  });

  /** A slot row as Daybreak stores it, for the last-synced fallback. */
  function row(slug: string, description: string, overrides: Record<string, unknown> = {}) {
    return { slug, description, scope: 'module:onboarding', isActive: true, ...overrides };
  }

  it('declares the slots as Daybreak last synced them when the questions cannot be read', async () => {
    prismaMock.appQuestionSet.findFirst.mockRejectedValue(new Error('connection lost'));
    listSlots.mockResolvedValue([
      row('aspirations', 'A taxonomy slot.', { scope: 'global' }),
      row('discovery_q01', 'First?'),
      row('discovery_q02', 'Second?'),
      row('discovery_q03', 'Removed?', { isActive: false }),
    ]);

    await expect(registerJourneyModules()).resolves.toBe('last-synced');

    // Exactly what the questions would have declared, so the sync changes nothing.
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toEqual([
      toDiscoverySlotDefinition({ id: 'q01', text: 'First?' }),
      toDiscoverySlotDefinition({ id: 'q02', text: 'Second?' }),
    ]);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('declaring the slots as last synced'),
      expect.anything()
    );
  });

  it('registers every module, without the slots, when neither read works, and never throws', async () => {
    prismaMock.appQuestionSet.findFirst.mockRejectedValue(new Error('connection lost'));
    listSlots.mockRejectedValue(new Error('connection lost'));

    await expect(registerJourneyModules()).resolves.toBe('none');

    expect(getRegisteredModules()).toHaveLength(17);
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toBeUndefined();
    // The switch still has its schema, so the Config tab and the stored value stay valid.
    expect(describeConfigSchema(getRegisteredModule('onboarding')!.configSchema)).toHaveLength(1);
  });

  it('re-registers and runs Daybreak’s slot sync after a question write', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);
    syncSlots.mockResolvedValue(undefined);

    await expect(resyncDiscoverySlots({ questionId: 'q01' })).resolves.toEqual({
      status: 'synced',
    });
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toHaveLength(2);
    expect(syncSlots).toHaveBeenCalledTimes(1);
  });

  it('runs overlapping re-syncs one at a time, so the newer questions are the ones synced', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);
    let releaseFirst!: () => void;
    syncSlots
      .mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)))
      .mockResolvedValue(undefined);

    const first = resyncDiscoverySlots({ questionId: 'q01' });
    const second = resyncDiscoverySlots({ questionId: 'q02' });
    await vi.waitFor(() => expect(syncSlots).toHaveBeenCalledTimes(1));

    // The second has not read or registered anything while the first syncs.
    expect(prismaMock.appQuestionSet.findFirst).toHaveBeenCalledTimes(1);
    prismaMock.appQuestionSet.findFirst.mockResolvedValue({
      ...ONBOARDING_SET,
      questions: [...ONBOARDING_SET.questions, { slug: 'q03', text: 'Third?' }],
    });
    releaseFirst();

    await expect(first).resolves.toEqual({ status: 'synced' });
    await expect(second).resolves.toEqual({ status: 'synced' });
    expect(syncSlots).toHaveBeenCalledTimes(2);
    expect(getRegisteredModule('onboarding')?.slotDefinitions).toHaveLength(3);
  });

  it('a failed re-sync does not stall the ones queued behind it', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);
    syncSlots.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue(undefined);

    const first = resyncDiscoverySlots({ questionId: 'q01' });
    const second = resyncDiscoverySlots({ questionId: 'q02' });

    await expect(first).resolves.toEqual({ status: 'failed', message: 'deadlock' });
    await expect(second).resolves.toEqual({ status: 'synced' });
  });

  it('reports a sync that throws', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);
    syncSlots.mockRejectedValue(new Error('deadlock'));

    await expect(resyncDiscoverySlots({ questionId: 'q01' })).resolves.toEqual({
      status: 'failed',
      message: 'deadlock',
    });
  });

  it('reports a sync that throws something other than an Error with a message of its own', async () => {
    prismaMock.appQuestionSet.findFirst.mockResolvedValue(ONBOARDING_SET);
    syncSlots.mockRejectedValue('deadlock');

    await expect(resyncDiscoverySlots({ questionId: 'q01' })).resolves.toEqual({
      status: 'failed',
      message: 'the slot sync failed',
    });
  });

  it('logs reads that throw something other than an Error as strings', async () => {
    getStructure.mockRejectedValue('names gone');
    prismaMock.appQuestionSet.findFirst.mockRejectedValue('questions gone');
    listSlots.mockRejectedValue('slots gone');

    await expect(registerJourneyModules()).resolves.toBe('none');

    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.stringContaining('module names could not be read'),
      { error: 'names gone' }
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('declaring the slots as last synced'),
      { error: 'questions gone' }
    );
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('could not be read either'),
      { error: 'slots gone' }
    );
  });

  it('reports, never throws, when the questions cannot be read, and syncs nothing', async () => {
    prismaMock.appQuestionSet.findFirst.mockRejectedValue(new Error('connection lost'));
    listSlots.mockResolvedValue([row('discovery_q01', 'First?')]);

    await expect(resyncDiscoverySlots({ questionId: 'q01' })).resolves.toEqual({
      status: 'failed',
      message: 'the discovery questions could not be read',
    });
    expect(syncSlots).not.toHaveBeenCalled();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('slots did not follow'),
      expect.objectContaining({ questionId: 'q01' })
    );
  });
});

describe('which questions a person is asked', () => {
  const questions = [question('q01', 1, 100), question('q02', 2, 40), question('q03', 3, 100)];

  it('asks every question, with the slot each is filed under, when the Core Set is off', async () => {
    getQuestions.mockResolvedValue(set(questions));
    storedConfig({ coreSetOnly: false });

    const asked = await getDiscoverySet();

    expect(asked.coreOnly).toBe(false);
    expect(asked.questions.map((q) => [q.id, q.slotSlug, q.core])).toEqual([
      ['q01', 'discovery_q01', true],
      ['q02', 'discovery_q02', false],
      ['q03', 'discovery_q03', true],
    ]);
    expect(getConfigForm).toHaveBeenCalledWith('onboarding');
  });

  it('asks only the fully weighted questions when the Core Set is on, keeping their numbers', async () => {
    getQuestions.mockResolvedValue(set(questions));
    storedConfig({ coreSetOnly: true });

    const asked = await getDiscoverySet();

    expect(asked.coreOnly).toBe(true);
    expect(asked.questions.map((q) => [q.id, q.number])).toEqual([
      ['q01', 1],
      ['q03', 3],
    ]);
  });

  it('asks every question, and says why, when the Core Set is on but nothing is fully weighted', async () => {
    getQuestions.mockResolvedValue(set([question('q01', 1, 90), question('q02', 2, 40)]));
    storedConfig({ coreSetOnly: true });

    const asked = await getDiscoverySet();

    expect(asked.questions.map((q) => q.id)).toEqual(['q01', 'q02']);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('no question is fully weighted')
    );
  });

  it('asks every question when the module has never saved its config', async () => {
    getQuestions.mockResolvedValue(set(questions));
    storedConfig({});

    const asked = await getDiscoverySet();

    expect(asked.coreOnly).toBe(false);
    expect(asked.questions).toHaveLength(3);
  });

  it('asks every question, and says why, when the stored config is not one it can read', async () => {
    getQuestions.mockResolvedValue(set(questions));
    storedConfig({ coreSetOnly: 'yes' });

    const asked = await getDiscoverySet();

    expect(asked.questions).toHaveLength(3);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('stored module config is invalid'),
      expect.objectContaining({ moduleSlug: 'onboarding' })
    );
  });

  it('asks every question, and says why, when the module config cannot be read', async () => {
    getQuestions.mockResolvedValue(set(questions));
    getConfigForm.mockRejectedValue(new Error('Module "onboarding" not found'));

    const asked = await getDiscoverySet();

    expect(asked.coreOnly).toBe(false);
    expect(asked.questions).toHaveLength(3);
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.stringContaining('could not be read'),
      expect.objectContaining({ moduleSlug: 'onboarding' })
    );
  });

  it('carries the preamble and pacing through', async () => {
    getQuestions.mockResolvedValue(set(questions));

    const asked = await getDiscoverySet();

    expect(asked.preamble.text).toBe('Not to be rushed.');
    expect(asked.pacing.allowPartialCompletion).toBe(true);
  });
});
