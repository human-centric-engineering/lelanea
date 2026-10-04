/**
 * A person's leanings, read and written (f-leanings t-135), and the ones a
 * turn applies (t-136).
 *
 * Over a small stateful fake: the overlay set's bounds, and a slot-value table
 * that the mocked `appendSlotValue` appends to the way Daybreak's engine does
 * (a new version, the old head stamped superseded). What matters here is which
 * version the reader takes, so the history is real rather than a stubbed
 * return.
 *
 * @see lib/app/voice/leanings-store.ts
 */

import { Prisma } from '@prisma/client';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { readVoiceOverlaysFile } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { LEANING_REASONING_NOTES, type LeaningBounds } from '@/lib/app/voice/leanings';

interface ValueRow {
  userId: string;
  slotSlug: string;
  version: number;
  value: string;
  valueJson: unknown;
  sourceType: string;
  reasoningNote: string;
  provenance: unknown;
  supersededAt: Date | null;
}

interface World {
  /** The set's stored `leanings`, as the column would hold them. */
  bounds: unknown;
  seeded: boolean;
  values: ValueRow[];
  appendFailures: number;
  /** The running turn row on the facilitator seat, or no row. */
  running: { register?: unknown; registerSource?: unknown; leanings: unknown } | null;
  runningFails: boolean;
  /** Why the register is what it is, when decided outside a claim. */
  registerSource: 'module' | 'safety' | 'fallback' | 'asked';
}

const world = vi.hoisted((): World => ({
  bounds: null,
  seeded: true,
  values: [],
  appendFailures: 0,
  running: null,
  runningFails: false,
  registerSource: 'module',
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appVoiceOverlaySet: {
      findFirst: vi.fn(async () => (world.seeded ? { leanings: world.bounds } : null)),
    },
    appTurn: {
      findFirst: vi.fn(async () => {
        if (world.runningFails) throw new Error('turn row unreadable');
        return world.running;
      }),
    },
    slotValue: {
      findMany: vi.fn(
        async ({ where }: { where: { userId: string; slotSlug: { in: string[] } } }) =>
          world.values
            .filter(
              (row) => row.userId === where.userId && where.slotSlug.in.includes(row.slotSlug)
            )
            .sort((a, b) => a.slotSlug.localeCompare(b.slotSlug) || b.version - a.version)
      ),
    },
  },
}));

const appendSlotValue = vi.hoisted(() =>
  vi.fn(async (input: Omit<ValueRow, 'version' | 'supersededAt'>): Promise<ValueRow> => {
    if (world.appendFailures > 0) {
      world.appendFailures -= 1;
      throw new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      });
    }
    const mine = world.values.filter(
      (row) => row.userId === input.userId && row.slotSlug === input.slotSlug
    );
    for (const row of mine) row.supersededAt ??= new Date();
    const row: ValueRow = { ...input, version: mine.length + 1, supersededAt: null };
    world.values.push(row);
    return row;
  })
);
vi.mock('@/lib/framework/data-slots', () => ({ appendSlotValue }));
vi.mock('@/lib/app/content/voice-overlay-store', async () =>
  (await import('@/tests/helpers/app/content-stores')).fakeVoiceOverlayStore()
);
const resolveRegister = vi.hoisted(() =>
  vi.fn(async () => ({
    register: world.registerSource === 'module' ? 'teaching' : 'guiding',
    source: world.registerSource,
    moduleSlug: null,
  }))
);
vi.mock('@/lib/app/voice/register-store', () => ({
  hasRegister: (seat: string) => seat === 'facilitator',
  resolveRegister,
}));
const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logging', () => ({ logger }));

const { getLeanings, setLeaning, resolveLeanings, readLeaningInputs, promptStampFor } =
  await import('@/lib/app/voice/leanings-store');
const { fakeVoiceOverlayStore } = await import('@/tests/helpers/app/content-stores');

const ME = 'user-me';
const SOMEONE_ELSE = 'user-else';
const drafted = (): LeaningBounds => readVoiceOverlaysFile().leanings!;

function ours(userId: string, slotSlug: string, stop: number, version: number): ValueRow {
  return {
    userId,
    slotSlug,
    version,
    value: 'x',
    valueJson: stop,
    sourceType: 'user_confirmed',
    reasoningNote: LEANING_REASONING_NOTES.settings,
    provenance: {},
    supersededAt: null,
  };
}

const dialOf = async (userId: string, key: string) =>
  (await getLeanings(userId)).dials.find((dial) => dial.key === key)!;

beforeEach(() => {
  vi.clearAllMocks();
  world.bounds = drafted();
  world.seeded = true;
  world.values = [];
  world.appendFailures = 0;
  world.running = null;
  world.runningFails = false;
  world.registerSource = 'module';
  fakeVoiceOverlayStore().reset();
});

describe('reading', () => {
  it('starts every dial at rest, with the drafted bounds', async () => {
    const view = await getLeanings(ME);

    expect(view.configured).toBe(true);
    expect(view.dials).toHaveLength(11);
    expect(view.dials.every((dial) => dial.position === 0 && dial.stored === 0)).toBe(true);
    expect(view.dials.find((dial) => dial.key === 'questions')).toMatchObject({
      min: -2,
      max: 1,
      locked: false,
      suggest: true,
    });
  });

  it('takes the newest version the person wrote, skipping a newer one in any other shape', async () => {
    world.values = [
      { ...ours(ME, 'leaning_length', 2, 1), supersededAt: new Date() },
      // The head: what a fill_slot write would leave. Same slug, a stop, but
      // the AI's own sentence and source type.
      {
        ...ours(ME, 'leaning_length', -2, 2),
        sourceType: 'inferred',
        reasoningNote: 'They seem to like long answers.',
      },
    ];

    const dial = await dialOf(ME, 'length');

    // Taking the head would read -2; the person set 2.
    expect(dial.stored).toBe(2);
    expect(dial.position).toBe(2);
  });

  it('never reads another person’s setting', async () => {
    world.values = [ours(SOMEONE_ELSE, 'leaning_length', 2, 1)];

    expect((await dialOf(ME, 'length')).stored).toBe(0);
    expect((await dialOf(SOMEONE_ELSE, 'length')).stored).toBe(2);
  });

  it('clamps on read and leaves what was stored, so loosening the bound gives it back', async () => {
    world.values = [ours(ME, 'leaning_questions', 2, 1)];

    expect(await dialOf(ME, 'questions')).toMatchObject({ stored: 2, position: 1 });

    const loosened = drafted();
    world.bounds = {
      ...loosened,
      dials: { ...loosened.dials, questions: { min: -2, max: 2, suggest: true } },
    };
    expect(await dialOf(ME, 'questions')).toMatchObject({ stored: 2, position: 2 });
  });

  it('turns suggestions off for every dial when the set says so', async () => {
    world.bounds = { ...drafted(), suggest: false };

    expect((await getLeanings(ME)).dials.every((dial) => !dial.suggest)).toBe(true);
  });

  it.each([
    ['not seeded', () => (world.seeded = false)],
    ['bounds that fail their schema', () => (world.bounds = { suggest: true, dials: {} })],
  ])('locks every dial at rest when the bounds are %s', async (_label, breakIt) => {
    world.values = [ours(ME, 'leaning_length', 2, 1)];
    breakIt();

    const view = await getLeanings(ME);

    expect(view.configured).toBe(false);
    expect(view.dials.every((dial) => dial.locked && dial.position === 0)).toBe(true);
  });
});

describe('writing', () => {
  it('writes a new version in the reader’s shape, and keeps the old one', async () => {
    const first = await setLeaning({ userId: ME, key: 'length', stop: 1, via: 'settings' });
    const second = await setLeaning({ userId: ME, key: 'length', stop: 2, via: 'settings' });

    expect(first).toMatchObject({ outcome: 'written', version: 1 });
    expect(second).toMatchObject({ outcome: 'written', version: 2 });
    const history = world.values.filter((row) => row.slotSlug === 'leaning_length');
    expect(history.map((row) => [row.version, row.valueJson, row.supersededAt === null])).toEqual([
      [1, 1, false],
      [2, 2, true],
    ]);
    expect(history[1]).toMatchObject({
      userId: ME,
      value: 'Strongly toward Concise and spare',
      sourceType: 'user_confirmed',
      reasoningNote: LEANING_REASONING_NOTES.settings,
      provenance: {},
    });
    expect((await dialOf(ME, 'length')).stored).toBe(2);
  });

  it('writes the asked-for sentence when the person asked in conversation', async () => {
    await setLeaning({
      userId: ME,
      key: 'pace',
      stop: -1,
      via: 'asked',
      provenance: { conversationId: 'conv-1' },
    });

    expect(world.values[0]).toMatchObject({
      reasoningNote: LEANING_REASONING_NOTES.asked,
      provenance: { conversationId: 'conv-1' },
    });
    expect((await dialOf(ME, 'pace')).stored).toBe(-1);
  });

  it('writes nothing when the stop is the one already set', async () => {
    await setLeaning({ userId: ME, key: 'length', stop: 1, via: 'settings' });
    const again = await setLeaning({ userId: ME, key: 'length', stop: 1, via: 'settings' });

    expect(again).toMatchObject({ outcome: 'unchanged', version: 1 });
    expect(appendSlotValue).toHaveBeenCalledTimes(1);
  });

  it('reports the version it read, not a newer head somebody else wrote', async () => {
    world.values = [
      { ...ours(ME, 'leaning_length', 1, 1), supersededAt: new Date() },
      { ...ours(ME, 'leaning_length', -2, 2), reasoningNote: 'They seem to like long answers.' },
    ];

    const again = await setLeaning({ userId: ME, key: 'length', stop: 1, via: 'settings' });

    expect(again).toMatchObject({ outcome: 'unchanged', version: 1 });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('writes nothing for rest when nothing was ever set', async () => {
    const result = await setLeaning({ userId: ME, key: 'length', stop: 0, via: 'settings' });

    expect(result).toMatchObject({ outcome: 'unchanged', version: null });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('clamps a stop beyond the bounds before storing it', async () => {
    const result = await setLeaning({ userId: ME, key: 'questions', stop: 2, via: 'settings' });

    expect(result.dial).toMatchObject({ stored: 1, position: 1 });
    expect(world.values[0].valueJson).toBe(1);
  });

  it('refuses a locked dial and writes nothing', async () => {
    const bounds = drafted();
    world.bounds = {
      ...bounds,
      dials: { ...bounds.dials, pace: { min: 0, max: 0, suggest: false } },
    };

    await expect(
      setLeaning({ userId: ME, key: 'pace', stop: 1, via: 'settings' })
    ).rejects.toMatchObject({ details: { reason: 'leaning_locked' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('refuses when the bounds can’t be read, rather than guessing them', async () => {
    world.seeded = false;

    await expect(
      setLeaning({ userId: ME, key: 'pace', stop: 1, via: 'settings' })
    ).rejects.toMatchObject({ details: { reason: 'leanings_unavailable' } });
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('retries once when a concurrent write took the version', async () => {
    world.appendFailures = 1;

    const result = await setLeaning({ userId: ME, key: 'length', stop: 1, via: 'settings' });

    expect(result.outcome).toBe('written');
    expect(appendSlotValue).toHaveBeenCalledTimes(2);
  });
});

describe('the leanings a turn applies (t-136)', () => {
  it('applies the person’s own settings, clamped to today’s bounds, on the facilitator seat', async () => {
    world.values = [ours(ME, 'leaning_length', 2, 1), ours(ME, 'leaning_warmth', 2, 1)];

    // The drafted bounds stop warm ↔ cool at 1.
    await expect(resolveLeanings(ME, 'facilitator', 'module')).resolves.toEqual({
      applied: [
        { key: 'length', stop: 2 },
        { key: 'warmth', stop: 1 },
      ],
      held: [],
    });
  });

  it('holds the hard poles under a crisis, and names them', async () => {
    world.values = [ours(ME, 'leaning_length', 2, 1), ours(ME, 'leaning_warmth', 2, 1)];

    await expect(resolveLeanings(ME, 'facilitator', 'safety')).resolves.toEqual({
      applied: [{ key: 'length', stop: 2 }],
      held: ['warmth'],
    });
  });

  it('is none on a seat with no register, or for nobody, and reads nothing', async () => {
    world.values = [ours(ME, 'leaning_length', 2, 1)];

    await expect(resolveLeanings(ME, 'onboarding', 'module')).resolves.toBeNull();
    await expect(resolveLeanings('', 'facilitator', 'module')).resolves.toBeNull();
    expect(fakeVoiceOverlayStore().getVoiceOverlays).not.toHaveBeenCalled();
  });

  it('applies nothing, loudly, when the rows can’t be read', async () => {
    world.values = [ours(ME, 'leaning_length', 2, 1)];
    fakeVoiceOverlayStore().empty();

    await expect(resolveLeanings(ME, 'facilitator', 'module')).resolves.toEqual({
      applied: [],
      held: [],
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/readLeaningInputs/),
      expect.any(Object)
    );
  });

  it('does not read the overlays when every dial is at rest', async () => {
    const inputs = await readLeaningInputs(ME, 'facilitator');

    expect(inputs?.content.overlays).toEqual([]);
    expect(fakeVoiceOverlayStore().getVoiceOverlays).not.toHaveBeenCalled();
    await expect(resolveLeanings(ME, 'facilitator', 'module')).resolves.toEqual({
      applied: [],
      held: [],
    });
  });

  describe('for the prompt', () => {
    it('reads back the register and leanings the running turn was claimed with, as one', async () => {
      const stamp = { applied: [{ key: 'pace', stop: 1 }], held: [] };
      world.running = { register: 'teaching', registerSource: 'module', leanings: stamp };
      world.values = [ours(ME, 'leaning_length', 2, 1)];

      await expect(promptStampFor(ME, 'facilitator')).resolves.toEqual({
        register: 'teaching',
        leanings: stamp,
      });
      expect(resolveRegister).not.toHaveBeenCalled();
      expect(fakeVoiceOverlayStore().getVoiceOverlays).not.toHaveBeenCalled();
    });

    it.each([
      ['no running turn', null, false],
      ['an unreadable row', null, true],
    ] as const)(
      'decides both from one reading of the register with %s',
      async (_case, running, fails) => {
        world.running = running;
        world.runningFails = fails;
        world.registerSource = 'safety';
        world.values = [ours(ME, 'leaning_length', -1, 1), ours(ME, 'leaning_pace', -2, 1)];

        await expect(promptStampFor(ME, 'facilitator')).resolves.toEqual({
          register: 'guiding',
          leanings: { applied: [{ key: 'length', stop: -1 }], held: ['pace'] },
        });
        // One decision: the leanings are held against the register they are composed under.
        expect(resolveRegister).toHaveBeenCalledTimes(1);
      }
    );

    it('keeps a claim’s register from before leanings, and holds against its source', async () => {
      world.running = { register: 'guiding', registerSource: 'safety', leanings: null };
      // Were it read again, the register would say teaching, from the module.
      world.registerSource = 'module';
      world.values = [ours(ME, 'leaning_pace', -2, 1)];

      await expect(promptStampFor(ME, 'facilitator')).resolves.toEqual({
        register: 'guiding',
        leanings: { applied: [], held: ['pace'] },
      });
      expect(resolveRegister).not.toHaveBeenCalled();
    });

    it('does not trust leanings stamped beside a register it cannot read, and decides both', async () => {
      // Stamped under the module, with a hard pole applied; the register is unreadable.
      world.running = {
        register: 'stern',
        registerSource: 'module',
        leanings: { applied: [{ key: 'pace', stop: -2 }], held: [] },
      };
      world.registerSource = 'safety';
      world.values = [ours(ME, 'leaning_pace', -2, 1)];

      await expect(promptStampFor(ME, 'facilitator')).resolves.toEqual({
        register: 'guiding',
        leanings: { applied: [], held: ['pace'] },
      });
    });

    it('is nothing on a seat with no register', async () => {
      await expect(promptStampFor(ME, 'onboarding')).resolves.toEqual({
        register: null,
        leanings: null,
      });
    });
  });
});
