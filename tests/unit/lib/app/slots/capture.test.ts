/**
 * Capture: a retried turn cannot write the same slot twice (f-slots t-72; §8.1).
 *
 * ## The assertion that fails when the behaviour is wrong (`fp6`)
 *
 * The defect is not "two rows exist" — it is "one turn, run twice, produced two
 * readings of one thing said once". So the load-bearing case runs the SAME turn
 * id through the capability twice and asserts the framework's `execute` was
 * called once. Revert `GuardedFillSlotCapability.execute` to a bare
 * `super.execute` and that case fails; nothing else in this file does, which is
 * the point — the rest is the guard staying out of the way.
 *
 * Every absence here is asserted over a non-empty population: the first call's
 * write is asserted before the second call's absence, so "nothing was written"
 * cannot pass against a capability that wrote nothing either time.
 *
 * ## What is faked, and what is not
 *
 * The framework's `FillSlotCapability.execute` is spied rather than run — this
 * file is about the wrapper, and running the real one would drag the value
 * engine, the masking policy and the typed-value extractor into a test about a
 * unique index. `.context/app/slots.md` and the framework's own tests cover
 * those. The Prisma client is a small stateful fake of the two tables the guard
 * touches, with `@@unique([turnId, slotSlug])` enforced as a real constraint so
 * a create that should be refused is refused (`B9`).
 *
 * @see lib/app/slots/capture.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface TurnRow {
  id: string;
  userId: string;
  turnId: string;
}
interface SlotWriteRow {
  turnId: string;
  slotSlug: string;
  version: number;
  minted: boolean;
}

const world = {
  turns: [] as TurnRow[],
  slotWrites: [] as SlotWriteRow[],
};

/** P2002 as Prisma raises it, so the guard's catch sees what it will see live. */
class UniqueViolation extends Error {
  readonly code = 'P2002';
}

const prismaFake = {
  appTurn: {
    findUnique: vi.fn(
      async ({
        where,
        select,
      }: {
        where: { userId_turnId: { userId: string; turnId: string } };
        select: { slotWrites: { where: { slotSlug: string } } };
      }) => {
        const turn = world.turns.find(
          (row) =>
            row.userId === where.userId_turnId.userId && row.turnId === where.userId_turnId.turnId
        );
        if (!turn) return null;
        return {
          id: turn.id,
          slotWrites: world.slotWrites
            .filter(
              (row) => row.turnId === turn.id && row.slotSlug === select.slotWrites.where.slotSlug
            )
            .map((row) => ({ version: row.version, minted: row.minted })),
        };
      }
    ),
    create: vi.fn(),
  },
  appTurnSlotWrite: {
    create: vi.fn(async ({ data }: { data: SlotWriteRow }) => {
      const clash = world.slotWrites.some(
        (row) => row.turnId === data.turnId && row.slotSlug === data.slotSlug
      );
      if (clash) throw new UniqueViolation('Unique constraint failed');
      world.slotWrites.push(data);
      return data;
    }),
  },
};

vi.mock('@/lib/db/client', () => ({ prisma: prismaFake }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { FillSlotCapability } = await import('@/lib/framework/data-slots/capabilities/fill-slot');
const { GuardedFillSlotCapability, turnIdFrom } = await import('@/lib/app/slots/capture');
const { logger } = await import('@/lib/logging');

const USER = 'user-1';
const TURN = 'turn-abc';
const TURN_ROW_ID = 'app-turn-row-1';

/** What the framework would return for a successful targeted write at version N. */
function wrote(version: number, minted = false) {
  return { success: true as const, data: { slotSlug: 'primary_goal', version, minted } };
}

/**
 * The same, as the framework ACTUALLY returns it — carrying `skipFollowup`.
 *
 * The distinction is the point of the `answering()` cases below: every
 * `framework.mockResolvedValue` in this file hands back the real shape, so a
 * wrapper that stopped stripping the flag fails rather than passing against a
 * fake that never had it.
 */
function wroteSilently(version: number, minted = false) {
  return { ...wrote(version, minted), skipFollowup: true };
}

const ARGS = {
  slotSlug: 'primary_goal',
  value: 'Wants to leave the job by spring',
  confidence: 9,
  reasoningNote: 'They said it plainly, unprompted.',
  sourceType: 'unprompted',
} as never;

/** A context as the dispatcher builds it for one of her turns. */
function context(overrides: Record<string, unknown> = {}) {
  return {
    userId: USER,
    agentId: 'agent-hers',
    conversationId: 'conv-1',
    customConfig: null,
    costLogMetadata: { turnId: TURN, seat: 'facilitator' },
    ...overrides,
  } as never;
}

let framework: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  world.turns = [{ id: TURN_ROW_ID, userId: USER, turnId: TURN }];
  world.slotWrites = [];
  framework = vi.spyOn(FillSlotCapability.prototype, 'execute').mockResolvedValue(wroteSilently(1));
});

describe('the turn id', () => {
  it('is read out of the cost-attribution carrier the turn seam fills', () => {
    expect(turnIdFrom(context())).toBe(TURN);
  });

  it.each([
    ['absent', undefined],
    ['carrying no turn id', { seat: 'facilitator' }],
    ['carrying a non-string', { turnId: 7 }],
    ['carrying an empty string', { turnId: '' }],
  ])('is null when the carrier is %s, rather than throwing', (_label, costLogMetadata) => {
    expect(turnIdFrom(context({ costLogMetadata }))).toBeNull();
  });
});

describe('a turn that writes a slot', () => {
  it('writes it, and records that it did', async () => {
    const capability = new GuardedFillSlotCapability();

    const result = await capability.execute(ARGS, context());

    expect(result).toEqual(wrote(1));
    expect(framework).toHaveBeenCalledTimes(1);
    expect(world.slotWrites).toEqual([
      { turnId: TURN_ROW_ID, slotSlug: 'primary_goal', version: 1, minted: false },
    ]);
  });

  it('records a mint as a mint, so a suppressed retry answers with the same shape', async () => {
    framework.mockResolvedValue(wroteSilently(1, true));
    const capability = new GuardedFillSlotCapability();

    await capability.execute(ARGS, context());

    expect(world.slotWrites[0]).toMatchObject({ minted: true });
  });
});

describe('she still speaks after she has recorded', () => {
  it("drops the framework's `skipFollowup`, so the turn does not end on a tool call", async () => {
    // Found on a real turn, not reasoned about: her instruction tells her to
    // record before she answers, the pinned model obliges with a first pass
    // carrying nothing but tool calls, and with the follow-up skipped that pass
    // IS the turn — she records what the person confided and replies with an
    // empty string. The population is non-empty: the framework really does set
    // the flag, which `wroteSilently` carries.
    expect(wroteSilently(1)).toHaveProperty('skipFollowup', true);

    const result = await new GuardedFillSlotCapability().execute(ARGS, context());

    expect(result).not.toHaveProperty('skipFollowup');
    expect(result).toEqual(wrote(1));
  });

  it('drops it from a refusal too — a pass ending on one is just as silent', async () => {
    // The framework does not set the flag on an error today, so this is
    // belt-and-braces rather than a live path. It is here because the reason
    // for stripping is "the pass ended on a fill_slot result", which says
    // nothing about whether that result was a success — exempting refusals
    // would leave the same silence behind a rarer door.
    framework.mockResolvedValue({
      success: false,
      error: { code: 'slot_inactive', message: 'retired' },
      skipFollowup: true,
    });

    const result = await new GuardedFillSlotCapability().execute(ARGS, context());

    expect(result).not.toHaveProperty('skipFollowup');
    expect(result).toMatchObject({ error: { code: 'slot_inactive' } });
  });

  it('drops it on an unguarded dispatch too, so every path behaves alike', async () => {
    const result = await new GuardedFillSlotCapability().execute(
      ARGS,
      context({ costLogMetadata: undefined })
    );

    expect(result).not.toHaveProperty('skipFollowup');
  });
});

describe('the same turn run again — the defect §8.1 names', () => {
  it('writes the slot once, not once per attempt', async () => {
    const capability = new GuardedFillSlotCapability();

    // Attempt 1: the tool succeeds, then the turn fails somewhere after it and
    // is settled `failed`. The same id is claimed again and the model, given
    // the same words, reaches the same reading.
    const first = await capability.execute(ARGS, context());
    expect(first).toEqual(wrote(1));
    expect(world.slotWrites).toHaveLength(1);

    framework.mockClear();
    // Attempt 2 would append version 2 if it reached the framework.
    framework.mockResolvedValue(wroteSilently(2));

    const second = await capability.execute(ARGS, context());

    // The write never happened...
    expect(framework).not.toHaveBeenCalled();
    expect(world.slotWrites).toHaveLength(1);
    // ...and the model is told the reading IS recorded, at the version that
    // actually exists — not an error, and not version 2.
    //
    // No `skipFollowup`, exactly as a real write carries none: a suppressed
    // write has to leave the turn in the state a real one does, or the retry
    // would be the one attempt that came back with no words.
    expect(second).toEqual(wrote(1));
    expect(second).not.toHaveProperty('skipFollowup');
  });

  it('still writes a DIFFERENT slot, so the guard is per slot and not per turn', async () => {
    const capability = new GuardedFillSlotCapability();
    await capability.execute(ARGS, context());
    framework.mockClear();
    framework.mockResolvedValue({
      success: true,
      data: { slotSlug: 'work_strain', version: 1, minted: false },
      skipFollowup: true,
    });

    await capability.execute({ ...(ARGS as object), slotSlug: 'work_strain' } as never, context());

    expect(framework).toHaveBeenCalledTimes(1);
    expect(world.slotWrites.map((row) => row.slotSlug)).toEqual(['primary_goal', 'work_strain']);
  });

  it('is bounded to one person: the same id from somebody else is a different turn', async () => {
    const capability = new GuardedFillSlotCapability();
    await capability.execute(ARGS, context());
    expect(world.slotWrites).toHaveLength(1);
    framework.mockClear();

    // Same turn id string, a different person — turn ids are unique per person,
    // never globally (`app_turn`'s `@@unique([userId, turnId])`).
    world.turns.push({ id: 'app-turn-row-2', userId: 'user-2', turnId: TURN });
    await capability.execute(ARGS, context({ userId: 'user-2' }));

    expect(framework).toHaveBeenCalledTimes(1);
    expect(world.slotWrites).toHaveLength(2);
  });
});

describe('a dispatch the guard cannot place', () => {
  it('runs unguarded when there is no turn id — a workflow step, or the general chat route', async () => {
    const capability = new GuardedFillSlotCapability();

    await capability.execute(ARGS, context({ costLogMetadata: undefined }));
    await capability.execute(ARGS, context({ costLogMetadata: undefined }));

    // Twice, deliberately: with no turn there is no "second attempt" to detect,
    // and refusing would break every path the turn seam never reaches.
    expect(framework).toHaveBeenCalledTimes(2);
    expect(world.slotWrites).toHaveLength(0);
  });

  it('runs unguarded when the turn id matches no turn record', async () => {
    world.turns = [];
    const capability = new GuardedFillSlotCapability();

    await capability.execute(ARGS, context());

    expect(framework).toHaveBeenCalledTimes(1);
  });
});

describe('when the framework refuses or fails', () => {
  it('records nothing, so the retry is free to try again', async () => {
    framework.mockResolvedValue({
      success: false,
      error: { code: 'slot_inactive', message: 'retired' },
    });
    const capability = new GuardedFillSlotCapability();

    const result = await capability.execute(ARGS, context());

    expect(result).toMatchObject({ success: false });
    expect(world.slotWrites).toHaveLength(0);
  });

  it('lets a refusal through unchanged rather than dressing it as a success', async () => {
    framework.mockResolvedValue({
      success: false,
      error: { code: 'slot_not_permitted', message: 'outside scope' },
    });

    const result = await new GuardedFillSlotCapability().execute(ARGS, context());

    expect(result).toMatchObject({ error: { code: 'slot_not_permitted' } });
  });
});

describe('when the guard row cannot be written', () => {
  it('never fails the turn — the profile is right and only the guard is lost', async () => {
    prismaFake.appTurnSlotWrite.create.mockRejectedValueOnce(new Error('pool is gone'));
    const capability = new GuardedFillSlotCapability();

    const result = await capability.execute(ARGS, context());

    expect(result).toEqual(wrote(1));
    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not collapse two calls for one slug inside ONE attempt', async () => {
    // Both calls are in flight before either is recorded, so both write and the
    // framework versions them. That is a model calling a tool twice, not a
    // retried turn — see the module docblock's "deliberately NOT guarded".
    const capability = new GuardedFillSlotCapability();
    framework.mockResolvedValueOnce(wroteSilently(1)).mockResolvedValueOnce(wroteSilently(2));

    const [first, second] = await Promise.all([
      capability.execute(ARGS, context()),
      capability.execute(ARGS, context()),
    ]);

    expect(framework).toHaveBeenCalledTimes(2);
    expect([first, second]).toEqual([wrote(1), wrote(2)]);
    // One guard row: the loser's create hit the unique index and was logged,
    // not thrown. The turn is still settled correctly.
    expect(world.slotWrites).toHaveLength(1);
    expect(logger.warn).toHaveBeenCalled();
  });
});
