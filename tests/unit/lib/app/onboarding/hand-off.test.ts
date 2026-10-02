/**
 * `beginJourney` — the hand-off from onboarding into Values (§3.9, t-106).
 *
 * The engine is a small stateful fake: an `enter` upserts the node to active
 * and logs an event, a `complete` moves an active node to completed and logs
 * one, and anything else is refused with no write, as `applyEvent` does. So
 * "repeating it writes nothing" is observed on the fake's event log rather
 * than read off call counts. That the real engine accepts both transitions on
 * the real published map is `npm run smoke:app-onboarding`.
 *
 * @see lib/app/onboarding/hand-off.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface NodeState {
  nodeKey: string;
  status: string;
}

const engine = vi.hoisted(() => ({
  states: [] as { nodeKey: string; status: string }[],
  events: [] as { nodeKey: string; kind: string }[],
  /** Node keys the engine refuses to enter (a module that is not live). */
  notLive: new Set<string>(),
}));

const mocks = vi.hoisted(() => ({
  getDiscoveryState: vi.fn(),
  ensureJourneyStarted: vi.fn(),
  getJourney: vi.fn(),
  applyJourneyTransition: vi.fn(),
}));

vi.mock('@/lib/app/onboarding/discovery-store', () => ({
  getDiscoveryState: mocks.getDiscoveryState,
}));
vi.mock('@/lib/app/journey/start', () => ({
  ensureJourneyStarted: mocks.ensureJourneyStarted,
}));
vi.mock('@/lib/framework/facilitation/journey/queries', () => ({
  getJourney: mocks.getJourney,
  getNodeStates: vi.fn(async () => engine.states.map((s) => ({ ...s }))),
}));
vi.mock('@/lib/framework/guidance/guidance', () => ({
  applyJourneyTransition: mocks.applyJourneyTransition,
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { beginJourney } from '@/lib/app/onboarding/hand-off';
import { handedOffFrom } from '@/lib/app/onboarding/hand-off-state';
import { JOURNEY_MAP_SLUG } from '@/lib/app/journey/map-definition';

const USER = 'user_1';

/** The engine's two transitions, faithful to `applyEvent`'s refusals. */
async function transition(
  _viewer: unknown,
  _key: unknown,
  move: { nodeKey: string; kind: 'enter' | 'complete' }
) {
  const row = engine.states.find((s) => s.nodeKey === move.nodeKey);
  if (move.kind === 'enter') {
    if (engine.notLive.has(move.nodeKey)) {
      return { ok: false, rejection: { code: 'not_available', message: 'not live' } };
    }
    if (row) row.status = 'active';
    else engine.states.push({ nodeKey: move.nodeKey, status: 'active' });
  } else {
    if (row?.status !== 'active') {
      return { ok: false, rejection: { code: 'not_active', message: 'not active' } };
    }
    row.status = 'completed';
  }
  engine.events.push({ nodeKey: move.nodeKey, kind: move.kind });
  return { ok: true, nodeState: {}, event: {} };
}

function finished(done: boolean) {
  return {
    position: { next: done ? null : 'q2', skipped: done ? ['q2'] : [], finished: done },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  engine.states = [{ nodeKey: 'onboarding', status: 'active' }];
  engine.events = [];
  engine.notLive = new Set();
  mocks.getDiscoveryState.mockResolvedValue(finished(true));
  mocks.ensureJourneyStarted.mockResolvedValue('already');
  mocks.getJourney.mockResolvedValue({ id: 'journey_1' });
  mocks.applyJourneyTransition.mockImplementation(transition);
});

describe('beginJourney', () => {
  it('enters Values and completes onboarding, as the person, on the published map', async () => {
    await expect(beginJourney(USER)).resolves.toBe('begun');

    expect(engine.states).toEqual([
      { nodeKey: 'onboarding', status: 'completed' },
      { nodeKey: 'values', status: 'active' },
    ]);
    expect(engine.events).toEqual([
      { nodeKey: 'values', kind: 'enter' },
      { nodeKey: 'onboarding', kind: 'complete' },
    ]);
    const [viewer, key] = mocks.applyJourneyTransition.mock.calls[0] ?? [];
    expect(viewer).toEqual({ userId: USER });
    expect(key).toEqual({ userId: USER, graphSlug: JOURNEY_MAP_SLUG });
  });

  it('writes nothing new when it is repeated', async () => {
    await beginJourney(USER);
    const after = engine.events.length;

    await expect(beginJourney(USER)).resolves.toBe('already');
    await expect(beginJourney(USER)).resolves.toBe('already');

    expect(after).toBe(2);
    expect(engine.events).toHaveLength(after);
  });

  it('refuses before anything is written while a question is still ahead', async () => {
    mocks.getDiscoveryState.mockResolvedValue(finished(false));

    await expect(beginJourney(USER)).resolves.toBe('not_finished');
    expect(engine.events).toEqual([]);
  });

  it('allows skipped questions: finished means answered or skipped', async () => {
    mocks.getDiscoveryState.mockResolvedValue({
      position: { next: null, skipped: ['q1', 'q4'], finished: true },
    });

    await expect(beginJourney(USER)).resolves.toBe('begun');
  });

  it('leaves onboarding active when Values is not live, so nothing is left half-done', async () => {
    engine.notLive.add('values');

    await expect(beginJourney(USER)).resolves.toBe('unavailable');
    expect(engine.states).toEqual([{ nodeKey: 'onboarding', status: 'active' }]);
    expect(engine.events).toEqual([]);
  });

  it('finishes a hand-off left half-done, without entering Values again', async () => {
    engine.states.push({ nodeKey: 'values', status: 'active' });

    await expect(beginJourney(USER)).resolves.toBe('begun');
    expect(engine.events).toEqual([{ nodeKey: 'onboarding', kind: 'complete' }]);
  });

  it('never starts a journey: with none, it refuses and writes nothing (t-106 review round 3)', async () => {
    // Starting one belongs to passing the gate. Starting one here would let a
    // person who never acknowledged it in through the API.
    mocks.getJourney.mockResolvedValue(null);

    await expect(beginJourney(USER)).resolves.toBe('unavailable');
    expect(mocks.applyJourneyTransition).not.toHaveBeenCalled();
    expect(mocks.ensureJourneyStarted).not.toHaveBeenCalled();
  });

  it('answers unavailable when the journey vanishes before Values is entered', async () => {
    mocks.applyJourneyTransition.mockResolvedValueOnce(null);

    await expect(beginJourney(USER)).resolves.toBe('unavailable');
    expect(engine.states).toEqual([{ nodeKey: 'onboarding', status: 'active' }]);
  });

  it('answers unavailable when onboarding cannot be completed for another reason', async () => {
    mocks.applyJourneyTransition
      .mockImplementationOnce(transition)
      .mockResolvedValueOnce({ ok: false, rejection: { code: 'unknown_node', message: 'gone' } });

    await expect(beginJourney(USER)).resolves.toBe('unavailable');
  });

  it('counts a racing press that completed onboarding first as done, not a failure', async () => {
    engine.states.push({ nodeKey: 'values', status: 'active' });
    mocks.applyJourneyTransition.mockResolvedValueOnce({
      ok: false,
      rejection: { code: 'not_active', message: 'not active' },
    });

    // Nothing written by this call: it reads as already, and offers nothing more.
    await expect(beginJourney(USER)).resolves.toBe('already');
  });

  it('answers failed, never throws, when a read fails', async () => {
    mocks.getDiscoveryState.mockResolvedValue(null);
    await expect(beginJourney(USER)).resolves.toBe('failed');

    mocks.getDiscoveryState.mockRejectedValue(new Error('db down'));
    await expect(beginJourney(USER)).resolves.toBe('failed');
  });
});

describe('handedOffFrom', () => {
  const states = (...rows: [string, string][]): NodeState[] =>
    rows.map(([nodeKey, status]) => ({ nodeKey, status }));

  it('is false while onboarding is active, whatever else is entered', () => {
    expect(handedOffFrom(states(['onboarding', 'active']))).toBe(false);
    expect(handedOffFrom(states(['onboarding', 'active'], ['values', 'active']))).toBe(false);
  });

  it('is false with onboarding completed but Values never entered', () => {
    expect(handedOffFrom(states(['onboarding', 'completed']))).toBe(false);
  });

  it('is true once Values is entered and onboarding is no longer active', () => {
    expect(handedOffFrom(states(['onboarding', 'completed'], ['values', 'active']))).toBe(true);
    expect(handedOffFrom(states(['values', 'active']))).toBe(true);
  });
});
