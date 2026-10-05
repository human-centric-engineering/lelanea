/**
 * `set_leaning` (f-leanings t-137): one of the person's own lasting leanings,
 * moved a stop when they ask or say yes to a suggestion, from the facilitator
 * seat only.
 *
 * Over the real store and the same small stateful fake as
 * `leanings-store.test.ts`: the overlay set's bounds, and a slot-value table
 * the mocked `appendSlotValue` appends to. So "the next turn's leanings include
 * the change" is read back through the claim's own path
 * (`readLeaningInputs` → `leaningsFrom`), not asserted on a stubbed return.
 *
 * @see lib/app/voice/leaning-capability.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { readVoiceOverlaysFile } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { LEANING_REASONING_NOTES, type LeaningBounds } from '@/lib/app/voice/leanings';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

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
  /** The overlay set's stored `leanings`, as the column would hold them. */
  bounds: unknown;
  values: ValueRow[];
  appendFails: boolean;
  /** The person's turn before this one, and the tool calls its reply's trace kept. */
  previous: null | { status: string; assistantMessageId: string | null };
  previousCalls: unknown[];
}

const world = vi.hoisted((): World => ({
  bounds: null,
  values: [],
  appendFails: false,
  previous: null,
  previousCalls: [],
}));

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appVoiceOverlaySet: { findFirst: vi.fn(async () => ({ leanings: world.bounds })) },
    appTurn: { findFirst: vi.fn(async () => world.previous) },
    aiMessage: {
      findFirst: vi.fn(async () => ({ provenance: { capabilityCalls: world.previousCalls } })),
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
    if (world.appendFails) throw new Error('database down');
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
vi.mock('@/lib/app/voice/register-store', () => ({
  hasRegister: (seat: string) => seat === 'facilitator',
  resolveRegister: vi.fn(),
}));
// The constant only: the contributor's own imports are not under test here.
vi.mock('@/lib/app/voice/context-contributor', () => ({
  FACILITATION_CONTEXT_TYPE: 'facilitation',
}));
const invalidateContext = vi.hoisted(() => vi.fn());
vi.mock('@/lib/orchestration/chat/context-builder', () => ({ invalidateContext }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { SetLeaningCapability } = await import('@/lib/app/voice/leaning-capability');
const { leaningsFrom, readLeaningInputs } = await import('@/lib/app/voice/leanings-store');
const { fakeVoiceOverlayStore } = await import('@/tests/helpers/app/content-stores');
const { prisma } = await import('@/lib/db/client');

const tool = new SetLeaningCapability();
const ME = 'user-me';
const drafted = (): LeaningBounds => readVoiceOverlaysFile().leanings!;

const onSeat = (seat: string, userId: string | null = ME): CapabilityContext => ({
  userId,
  agentId: 'agent-1',
  conversationId: 'conv-1',
  costLogMetadata: { turnId: 't1', seat },
});

/** A stored setting, in the writer's shape. */
function set(slotSlug: string, stop: number, userId = ME): void {
  world.values.push({
    userId,
    slotSlug,
    version: world.values.filter((r) => r.userId === userId && r.slotSlug === slotSlug).length + 1,
    value: 'x',
    valueJson: stop,
    sourceType: 'user_confirmed',
    reasoningNote: LEANING_REASONING_NOTES.settings,
    provenance: {},
    supersededAt: null,
  });
}

/** Tighten one dial's bounds. */
function bound(key: keyof LeaningBounds['dials'], dial: Partial<LeaningBounds['dials']['length']>) {
  const bounds = drafted();
  world.bounds = {
    ...bounds,
    dials: { ...bounds.dials, [key]: { ...bounds.dials[key], ...dial } },
  };
}

const call = (args: Record<string, unknown>, context = onSeat('facilitator')) =>
  tool.execute(tool.validate(args), context);

/** The person's previous turn completed, and its reply proposed these. */
function previouslyProposed(...changes: { leaning: string; from: number; to: number }[]): void {
  world.previous = { status: 'completed', assistantMessageId: 'msg-prev' };
  world.previousCalls = changes.map((change) => ({
    slug: 'set_leaning',
    success: true,
    arguments: {},
    resultPreview: JSON.stringify({ success: true, data: { ...change, how: 'proposed' } }),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  world.bounds = drafted();
  world.values = [];
  world.appendFails = false;
  world.previous = null;
  world.previousCalls = [];
  fakeVoiceOverlayStore().reset();
});

describe('set_leaning: moving a dial', () => {
  it('steps one stop toward the pole asked for, as a new version the person wrote', async () => {
    const result = await call({ leaning: 'length', toward: 'Concise and spare', how: 'asked' });

    expect(result).toEqual({
      success: true,
      data: { leaning: 'length', from: 0, to: 1, how: 'asked' },
    });
    expect(appendSlotValue).toHaveBeenCalledTimes(1);
    expect(appendSlotValue.mock.calls[0][0]).toMatchObject({
      userId: ME,
      slotSlug: 'leaning_length',
      valueJson: 1,
      sourceType: 'user_confirmed',
      reasoningNote: LEANING_REASONING_NOTES.asked,
      provenance: { conversationId: 'conv-1' },
    });
  });

  it('steps from where the dial already is', async () => {
    set('leaning_length', 1);

    const result = await call({ leaning: 'length', toward: 'Concise and spare', how: 'asked' });

    expect(result.data).toEqual({ leaning: 'length', from: 1, to: 2, how: 'asked' });
  });

  it('puts a dial back to rest', async () => {
    set('leaning_directness', -2);

    const result = await call({ leaning: 'directness', toward: 'rest', how: 'asked' });

    expect(result.data).toEqual({ leaning: 'directness', from: -2, to: 0, how: 'asked' });
    expect(world.values.at(-1)).toMatchObject({ slotSlug: 'leaning_directness', valueJson: 0 });
  });
});

describe('set_leaning: a proposal, then a yes', () => {
  it('records a proposal by answering it, and changes nothing', async () => {
    const result = await call({ leaning: 'length', toward: 'Concise and spare', how: 'proposed' });

    expect(result).toMatchObject({
      success: true,
      data: { leaning: 'length', from: 0, to: 1, how: 'proposed' },
    });
    expect(appendSlotValue).not.toHaveBeenCalled();
    // Dropped, so the next turn's block names the proposal as awaiting an answer.
    expect(invalidateContext).toHaveBeenCalledWith('facilitation', 'facilitator', { userId: ME });
  });

  it('tells the AI, at the moment it proposes, to ask and change nothing', async () => {
    const result = await call({ leaning: 'length', toward: 'Concise and spare', how: 'proposed' });

    expect(result.data).toMatchObject({ next: expect.stringContaining('Nothing has changed.') });
    // The account reads the change alone.
    const { leaningChangeFromResult } = await import('@/lib/app/voice/leaning-change');
    expect(leaningChangeFromResult(result)).toEqual({
      leaning: 'length',
      from: 0,
      to: 1,
      how: 'proposed',
    });
  });

  it('refuses to propose what would move nothing', async () => {
    set('leaning_questions', 1);

    const result = await call({ leaning: 'questions', toward: 'Guidance-led', how: 'proposed' });

    expect(result.error?.code).toBe('nothing_to_propose');
  });

  it('moves the dial on a yes to the proposal the previous turn made, and records it as agreed', async () => {
    previouslyProposed({ leaning: 'imagery', from: 0, to: 1 });

    const result = await call({ leaning: 'imagery', toward: 'Literal', how: 'agreed' });

    expect(result.data).toEqual({ leaning: 'imagery', from: 0, to: 1, how: 'agreed' });
    expect(world.values.at(-1)?.reasoningNote).toBe(LEANING_REASONING_NOTES.agreed);
    // The previous turn is looked for as the person's, on the seat, and never this one.
    expect(vi.mocked(prisma.appTurn.findFirst)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: ME,
          seat: 'facilitator',
          status: { not: 'running' },
          turnId: { not: 't1' },
        },
        orderBy: { startedAt: 'desc' },
      })
    );
  });

  it.each([
    ['nothing was proposed', () => undefined],
    [
      'the proposal was for another leaning',
      () => previouslyProposed({ leaning: 'length', from: 0, to: 1 }),
    ],
    [
      'the proposal was the other way',
      () => previouslyProposed({ leaning: 'imagery', from: 0, to: -1 }),
    ],
    [
      'the previous turn did not complete',
      () => {
        previouslyProposed({ leaning: 'imagery', from: 0, to: 1 });
        world.previous = { status: 'failed', assistantMessageId: 'msg-prev' };
      },
    ],
  ])('refuses "agreed" when %s, and writes nothing', async (_case, arrange) => {
    arrange();

    const result = await call({ leaning: 'imagery', toward: 'Literal', how: 'agreed' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('no_proposal');
    expect(result.error?.message).toMatch(/call again now with how: asked/);
    expect(appendSlotValue).not.toHaveBeenCalled();
  });
});

describe('set_leaning: which way', () => {
  it('refuses a pole that is not the leaning’s own, naming the two that are', async () => {
    const result = await call({ leaning: 'length', toward: 'Literal', how: 'asked' });

    expect(result.error?.code).toBe('wrong_pole');
    expect(result.error?.message).toBe(
      '"Literal" is not a pole of length. Its poles are "Verbose and exploratory" and "Concise and spare".'
    );
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('moves toward the first pole named, the other way from the second', async () => {
    const result = await call({
      leaning: 'length',
      toward: 'Verbose and exploratory',
      how: 'asked',
    });

    expect(result.data).toMatchObject({ from: 0, to: -1 });
  });
});

describe('set_leaning: the bounds', () => {
  it('clamps to the bounds, and at the edge writes nothing and says nothing moved', async () => {
    // The drafted bounds stop `questions` one stop toward guidance-led.
    set('leaning_questions', 1);

    const result = await call({ leaning: 'questions', toward: 'Guidance-led', how: 'asked' });

    expect(result).toEqual({
      success: true,
      data: { leaning: 'questions', from: 1, to: 1, how: 'asked' },
    });
    expect(appendSlotValue).not.toHaveBeenCalled();
    expect(invalidateContext).not.toHaveBeenCalled();
  });

  it('steps from the applied stop when what is stored lies outside today’s bounds', async () => {
    // Stored 2 under a bound of 1: it applies as 1, so one step left is rest.
    set('leaning_questions', 2);

    const result = await call({ leaning: 'questions', toward: 'Question-led', how: 'asked' });

    expect(result.data).toEqual({ leaning: 'questions', from: 1, to: 0, how: 'asked' });
  });

  it('refuses a locked dial with a reason the AI can relay, and writes nothing', async () => {
    bound('devotion', { min: 0, max: 0 });

    const result = await call({ leaning: 'devotion', toward: 'Secular and plain', how: 'asked' });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('leaning_locked');
    expect(result.error?.message).toMatch(/cannot be moved/);
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('refuses to propose, or agree to, what the bounds rule out, but still takes the person’s own ask', async () => {
    bound('warmth', { suggest: false });
    previouslyProposed({ leaning: 'warmth', from: 0, to: -1 });

    const proposed = await call({
      leaning: 'warmth',
      toward: 'Empathetic and warm',
      how: 'proposed',
    });
    expect(proposed.error?.code).toBe('not_suggestable');
    const agreed = await call({ leaning: 'warmth', toward: 'Empathetic and warm', how: 'agreed' });
    expect(agreed.error?.code).toBe('not_suggestable');
    expect(appendSlotValue).not.toHaveBeenCalled();

    const asked = await call({ leaning: 'warmth', toward: 'Empathetic and warm', how: 'asked' });
    expect(asked.data).toMatchObject({ from: 0, to: -1 });
  });

  it('refuses everything when the bounds cannot be read, and says it is for now', async () => {
    world.bounds = { not: 'bounds' };

    const result = await call({ leaning: 'length', toward: 'Concise and spare', how: 'asked' });

    expect(result.error?.code).toBe('leanings_unavailable');
    expect(result.error?.message).toMatch(/just now/);
    expect(appendSlotValue).not.toHaveBeenCalled();
  });
});

describe('set_leaning: whose, and where', () => {
  it.each([
    ['the onboarding seat', onSeat('onboarding'), 'wrong_seat'],
    ['no turn at all', { userId: ME, agentId: 'agent-1' }, 'wrong_seat'],
    [
      'a seat with no turn id',
      { userId: ME, agentId: 'agent-1', costLogMetadata: { seat: 'facilitator' } },
      'wrong_seat',
    ],
    ['no person', onSeat('facilitator', null), 'no_person'],
  ] as const)('refuses from %s, and writes nothing', async (_case, context, code) => {
    const result = await call(
      { leaning: 'length', toward: 'Concise and spare', how: 'asked' },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(code);
    expect(appendSlotValue).not.toHaveBeenCalled();
  });

  it('writes only the caller’s own setting: no argument can name another person', async () => {
    // A model that tries to name someone else is refused at validation.
    expect(() =>
      tool.validate({
        leaning: 'length',
        toward: 'Concise and spare',
        how: 'asked',
        userId: 'user-else',
      })
    ).toThrow();
    expect(Object.keys(tool.functionDefinition.parameters.properties as object)).toEqual([
      'leaning',
      'toward',
      'how',
    ]);

    // And the write lands on the person the run is for, never anyone else.
    set('leaning_length', -2, 'user-else');
    await call(
      { leaning: 'length', toward: 'Concise and spare', how: 'asked' },
      onSeat('facilitator', ME)
    );

    expect(appendSlotValue).toHaveBeenCalledTimes(1);
    expect(appendSlotValue.mock.calls[0][0].userId).toBe(ME);
    expect(world.values.filter((row) => row.userId === 'user-else')).toHaveLength(1);
  });

  it('answers, rather than throwing, when the write fails', async () => {
    world.appendFails = true;

    const result = await call({ leaning: 'length', toward: 'Concise and spare', how: 'asked' });

    expect(result.error?.code).toBe('not_recorded');
  });
});

describe('set_leaning: the next reply', () => {
  it('drops the cached context, and the next turn’s leanings include the change', async () => {
    const before = leaningsFrom(await readLeaningInputs(ME, 'facilitator'), 'module');
    expect(before?.applied).toEqual([]);

    await call({ leaning: 'length', toward: 'Concise and spare', how: 'asked' });

    expect(invalidateContext).toHaveBeenCalledWith('facilitation', 'facilitator', { userId: ME });
    // What the turn seam stamps at the next claim.
    const after = leaningsFrom(await readLeaningInputs(ME, 'facilitator'), 'module');
    expect(after?.applied).toEqual([{ key: 'length', stop: 1 }]);
  });

  it('keeps its result small enough that the stored preview is the whole of it', () => {
    const result = {
      success: true as const,
      data: {
        leaning: 'encouragement' as const,
        from: -1 as const,
        to: -2 as const,
        how: 'agreed' as const,
      },
    };
    const { resultPreview } = tool.redactProvenance(
      { leaning: 'encouragement', toward: 'Encouraging', how: 'agreed' },
      result
    );

    expect(JSON.parse(resultPreview)).toEqual(result);
  });
});

describe('set_leaning: what the model is told', () => {
  it('says to propose first and change only on a yes, and never on inference', () => {
    const description = tool.functionDefinition.description;

    expect(description).toContain(
      'call it with how: proposed, which changes nothing and only records the proposal'
    );
    expect(description).toContain('Then wait.');
    expect(description).toContain(
      'Only if they say yes in their next message, call it again with how: agreed'
    );
    expect(description).toContain('Never change a leaning on your own inference.');
  });

  it('tells it apart from set_register: a lasting setting, not today’s lean', () => {
    const description = tool.functionDefinition.description;

    expect(description).toContain('This is not set_register');
    expect(description).toContain('today’s lean');
    expect(description).toContain('lasting');
  });
});
