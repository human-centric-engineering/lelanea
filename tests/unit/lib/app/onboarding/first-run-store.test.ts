/**
 * Reading and recording the first-run beats on the onboarding node (t-103).
 *
 * The framework calls are mocked over a small stateful fake of one node's
 * `progress`, merged shallowly as `recordNodeProgress` merges it. So "after a
 * reload nothing is replayed" is proved through the real key scheme and the
 * real reader: a beat recorded here is a beat `pendingBeats` no longer
 * returns. That the framework accepts the write on a real entered node is
 * `npm run smoke:app-onboarding`.
 *
 * @see lib/app/onboarding/first-run-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getJourney: vi.fn(),
  getNodeStates: vi.fn(),
  recordNodeProgress: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/journey/queries', () => ({
  getJourney: mocks.getJourney,
  getNodeStates: mocks.getNodeStates,
}));
vi.mock('@/lib/framework/facilitation/journey/progress', () => ({
  recordNodeProgress: mocks.recordNodeProgress,
}));

import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import { FIRST_RUN_BEATS, pendingBeats } from '@/lib/app/onboarding/first-run';
import { getFirstRunProgress, recordFirstRunBeat } from '@/lib/app/onboarding/first-run-store';

const USER = 'user_1';
const JOURNEY = { id: 'journey_1', userId: USER, graphSlug: JOURNEY_MAP_SLUG, contextKey: '' };

/** One entered onboarding node, whose `progress` the fake merges into. */
let node: { nodeKey: string; progress: Record<string, unknown> | null };

beforeEach(() => {
  vi.clearAllMocks();
  node = { nodeKey: ONBOARDING_NODE_KEY, progress: null };
  mocks.getJourney.mockResolvedValue(JOURNEY);
  mocks.getNodeStates.mockImplementation(() =>
    Promise.resolve([{ nodeKey: 'tier:onboarding', progress: null }, node])
  );
  mocks.recordNodeProgress.mockImplementation(
    (_viewer: unknown, _key: unknown, _nodeKey: string, patch: Record<string, unknown>) => {
      node.progress = { ...(node.progress ?? {}), ...patch };
      return Promise.resolve({ ok: true, nodeState: node });
    }
  );
});

describe('recordFirstRunBeat', () => {
  it('records on the onboarding node of the person’s own journey, as them', async () => {
    await expect(recordFirstRunBeat(USER, 'initiation')).resolves.toBe('recorded');

    expect(mocks.recordNodeProgress).toHaveBeenCalledWith(
      { userId: USER },
      { userId: USER, graphSlug: JOURNEY_MAP_SLUG },
      ONBOARDING_NODE_KEY,
      { initiation_shown_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }
    );
  });

  it('leaves nothing to replay: each beat recorded is gone from what is pending', async () => {
    expect(pendingBeats((await getFirstRunProgress(USER))!)).toEqual(FIRST_RUN_BEATS);

    await recordFirstRunBeat(USER, 'initiation');
    await recordFirstRunBeat(USER, 'read:the_heart_behind_lelanea');

    // A reload reads the ledger again from scratch.
    expect(pendingBeats((await getFirstRunProgress(USER))!)).toEqual([
      'read:the_mission',
      'read:about_the_creator',
      'read:the_lineage_of_lelanea',
    ]);

    for (const beat of FIRST_RUN_BEATS.slice(2)) await recordFirstRunBeat(USER, beat);
    expect(pendingBeats((await getFirstRunProgress(USER))!)).toEqual([]);
  });

  it('records a beat once, keeping the time it was first recorded', async () => {
    await recordFirstRunBeat(USER, 'read:the_mission');
    const first = node.progress?.['read_offered_at:the_mission'];

    await expect(recordFirstRunBeat(USER, 'read:the_mission')).resolves.toBe('already');
    expect(mocks.recordNodeProgress).toHaveBeenCalledTimes(1);
    expect(node.progress?.['read_offered_at:the_mission']).toBe(first);
  });

  it('keeps what else the module has recorded on the node', async () => {
    node.progress = { discovery_started_at: 'earlier' };
    await recordFirstRunBeat(USER, 'initiation');
    expect(node.progress).toMatchObject({ discovery_started_at: 'earlier' });
  });

  it('answers failed, and does not start a journey, when the node was never entered', async () => {
    mocks.recordNodeProgress.mockResolvedValue({
      ok: false,
      rejection: { code: 'node_not_entered', message: 'enter the node first' },
    });
    await expect(recordFirstRunBeat(USER, 'initiation')).resolves.toBe('failed');
  });

  it('answers failed rather than throwing when the framework throws', async () => {
    mocks.recordNodeProgress.mockRejectedValue(new Error('db down'));
    await expect(recordFirstRunBeat(USER, 'initiation')).resolves.toBe('failed');
  });
});

describe('getFirstRunProgress', () => {
  it('is nothing recorded for someone with no journey yet', async () => {
    mocks.getJourney.mockResolvedValue(null);
    await expect(getFirstRunProgress(USER)).resolves.toEqual({
      initiationShown: false,
      readsOffered: [],
    });
    expect(mocks.getNodeStates).not.toHaveBeenCalled();
  });

  it('is nothing recorded when onboarding has no node state', async () => {
    mocks.getNodeStates.mockResolvedValue([]);
    await expect(getFirstRunProgress(USER)).resolves.toEqual({
      initiationShown: false,
      readsOffered: [],
    });
  });

  it('reads the person’s own journey, as them', async () => {
    await getFirstRunProgress(USER);
    expect(mocks.getJourney).toHaveBeenCalledWith(
      { userId: USER },
      { userId: USER, graphSlug: JOURNEY_MAP_SLUG }
    );
    expect(mocks.getNodeStates).toHaveBeenCalledWith(
      { userId: USER },
      { journeyId: JOURNEY.id, subject: USER }
    );
  });

  it('is unknown (null), not "nothing recorded", when the read fails', async () => {
    mocks.getNodeStates.mockRejectedValue(new Error('db down'));
    await expect(getFirstRunProgress(USER)).resolves.toBeNull();
  });
});
