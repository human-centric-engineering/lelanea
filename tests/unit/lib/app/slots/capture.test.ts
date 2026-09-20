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
  framework = vi
    .spyOn(FillSlotCapability.prototype, 'execute')
    .mockResolvedValue(wrote(1) as never);
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
    framework.mockResolvedValue(wrote(1, true) as never);
    const capability = new GuardedFillSlotCapability();

    await capability.execute(ARGS, context());

    expect(world.slotWrites[0]).toMatchObject({ minted: true });
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
    framework.mockResolvedValue(wrote(2) as never);

    const second = await capability.execute(ARGS, context());

    // The write never happened...
    expect(framework).not.toHaveBeenCalled();
    expect(world.slotWrites).toHaveLength(1);
    // ...and the model is told the reading IS recorded, at the version that
    // actually exists — not an error, and not version 2.
    //
    // `skipFollowup` is asserted, not tolerated: the framework sets it on a
    // real write so a silent tool does not cost a second model pass, and a
    // suppressed write that omitted it would make the retry MORE expensive
    // than the call it replaced.
    expect(second).toEqual({ ...wrote(1), skipFollowup: true });
  });

  it('still writes a DIFFERENT slot, so the guard is per slot and not per turn', async () => {
    const capability = new GuardedFillSlotCapability();
    await capability.execute(ARGS, context());
    framework.mockClear();
    framework.mockResolvedValue({
      success: true,
      data: { slotSlug: 'work_strain', version: 1, minted: false },
    } as never);

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
    } as never);
    const capability = new GuardedFillSlotCapability();

    const result = await capability.execute(ARGS, context());

    expect(result).toMatchObject({ success: false });
    expect(world.slotWrites).toHaveLength(0);
  });

  it('lets a refusal through unchanged rather than dressing it as a success', async () => {
    framework.mockResolvedValue({
      success: false,
      error: { code: 'slot_not_permitted', message: 'outside scope' },
    } as never);

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
    framework.mockResolvedValueOnce(wrote(1) as never).mockResolvedValueOnce(wrote(2) as never);

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
