/**
 * Reading and writing a person's discovery answers (f-onboarding t-104).
 *
 * The framework is mocked over two small stateful fakes: the person's slot
 * values, appended and superseded as `appendSlotValue` does, and the
 * onboarding node's `progress`, merged shallowly as `recordNodeProgress`
 * does. So "a reload resumes at the right question" is proved through the
 * real key scheme and the real readers: whatever this writes is what the next
 * `getDiscoveryState` reads. That the framework accepts the writes on a real
 * database is `npm run smoke:app-onboarding`.
 *
 * @see lib/app/onboarding/discovery-store.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Row {
  slotSlug: string;
  value: string;
  version: number;
  supersededAt: Date | null;
  provenance: unknown;
}

const mocks = vi.hoisted(() => ({
  getDiscoverySet: vi.fn(),
  getSlotHeads: vi.fn(),
  appendSlotValue: vi.fn(),
  getJourney: vi.fn(),
  getNodeStates: vi.fn(),
  recordNodeProgress: vi.fn(),
  invalidateContext: vi.fn(),
}));
vi.mock('@/lib/app/onboarding/discovery-slots', () => ({
  getDiscoverySet: mocks.getDiscoverySet,
}));
vi.mock('@/lib/framework/data-slots', () => ({
  SLOT_SOURCE_TYPE: { direct: 'direct' },
  getSlotHeads: mocks.getSlotHeads,
  appendSlotValue: mocks.appendSlotValue,
}));
vi.mock('@/lib/framework/facilitation/journey/queries', () => ({
  getJourney: mocks.getJourney,
  getNodeStates: mocks.getNodeStates,
}));
vi.mock('@/lib/framework/facilitation/journey/progress', () => ({
  recordNodeProgress: mocks.recordNodeProgress,
}));
vi.mock('@/lib/orchestration/chat/context-builder', () => ({
  invalidateContext: mocks.invalidateContext,
}));

import { JOURNEY_MAP_SLUG, ONBOARDING_NODE_KEY } from '@/lib/app/journey/map-definition';
import {
  answerDiscoveryQuestion,
  getDiscoveryState,
  leaveDiscovery,
  skipDiscoveryQuestion,
} from '@/lib/app/onboarding/discovery-store';

const USER = 'user_1';

function question(id: string, number: number, core: boolean, branches = false) {
  return {
    id,
    number,
    text: `Question ${id}?`,
    inputType: 'long_text' as const,
    ...(branches && { conditionalFollowUp: { ifYes: 'Describe it.', ifNo: 'Imagine it.' } }),
    weight: core ? 100 : 50,
    revision: 1,
    slotSlug: `discovery_${id}`,
    core,
  };
}

const ALL = [
  question('q01', 1, false),
  question('q02', 2, true),
  question('q03', 3, false),
  question('q04', 4, true, true),
];

function setOf(questions: typeof ALL, coreOnly = false) {
  return {
    moduleSlug: 'onboarding',
    preamble: { style: 'italic', text: 'Take your time.' },
    pacing: { rushDiscouraged: true, allowPartialCompletion: true, note: 'Resumable.' },
    coreOnly,
    questions,
  };
}

let rows: Row[];
let node: { nodeKey: string; progress: Record<string, unknown> | null } | null;

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  node = { nodeKey: ONBOARDING_NODE_KEY, progress: null };
  mocks.getDiscoverySet.mockResolvedValue(setOf(ALL));
  mocks.getSlotHeads.mockImplementation((userId: string, options?: { slotSlugs?: string[] }) =>
    Promise.resolve(
      rows.filter(
        (r) =>
          userId === USER &&
          r.supersededAt === null &&
          (!options?.slotSlugs?.length || options.slotSlugs.includes(r.slotSlug))
      )
    )
  );
  mocks.appendSlotValue.mockImplementation(
    (input: { slotSlug: string; value: string; provenance: unknown }) => {
      const head = rows.find((r) => r.slotSlug === input.slotSlug && r.supersededAt === null);
      if (head) head.supersededAt = new Date();
      const row = {
        slotSlug: input.slotSlug,
        value: input.value,
        version: head ? head.version + 1 : 1,
        supersededAt: null,
        provenance: input.provenance,
      };
      rows.push(row);
      return Promise.resolve(row);
    }
  );
  mocks.getJourney.mockResolvedValue({
    id: 'journey_1',
    userId: USER,
    graphSlug: JOURNEY_MAP_SLUG,
  });
  mocks.getNodeStates.mockImplementation(() => Promise.resolve(node ? [node] : []));
  mocks.recordNodeProgress.mockImplementation(
    (_viewer: unknown, _key: unknown, _nodeKey: string, patch: Record<string, unknown>) => {
      if (!node) return Promise.resolve({ ok: false, rejection: { code: 'node_not_entered' } });
      node.progress = { ...(node.progress ?? {}), ...patch };
      return Promise.resolve({ ok: true, nodeState: node });
    }
  );
});

describe('answerDiscoveryQuestion', () => {
  it('writes the answer as the slot value, with onboarding provenance, as the person', async () => {
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'My ego is loud.' })
    ).resolves.toEqual({ outcome: 'written', version: 1 });

    expect(mocks.appendSlotValue).toHaveBeenCalledWith({
      userId: USER,
      slotSlug: 'discovery_q01',
      value: 'My ego is loud.',
      valueJson: 'My ego is loud.',
      confidence: 10,
      sourceType: 'direct',
      reasoningNote: expect.stringContaining('q01'),
      provenance: { moduleSlug: 'onboarding', nodeKey: ONBOARDING_NODE_KEY },
    });
  });

  it('appends a version on a revision and never overwrites', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'First.' });
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Second.' });

    expect(rows.map((r) => [r.value, r.version, r.supersededAt === null])).toEqual([
      ['First.', 1, false],
      ['Second.', 2, true],
    ]);
    const state = await getDiscoveryState(USER);
    expect(state?.answers.q01).toEqual({ words: 'Second.' });
  });

  it('writes nothing when the answer is what is already there', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Same.' });
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Same.' })
    ).resolves.toEqual({ outcome: 'unchanged', version: 1 });
    expect(mocks.appendSlotValue).toHaveBeenCalledTimes(1);
  });

  it('drops the person’s cached facilitation block on both seats, so the next turn reads the new words (t-105)', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'New words.' });

    expect(mocks.invalidateContext).toHaveBeenCalledWith('facilitation', 'facilitator', {
      userId: USER,
    });
    expect(mocks.invalidateContext).toHaveBeenCalledWith('facilitation', 'onboarding', {
      userId: USER,
    });
  });

  it('leaves the cache alone when nothing was written', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Same.' });
    mocks.invalidateContext.mockClear();

    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Same.' });

    expect(mocks.invalidateContext).not.toHaveBeenCalled();
  });

  it('writes the branch into the value, and reads it back', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[3], { words: 'On walks.', branch: 'yes' });
    expect(rows[0]?.value).toBe('Yes. On walks.');
    expect((await getDiscoveryState(USER))?.answers.q04).toEqual({
      words: 'On walks.',
      branch: 'yes',
    });
  });

  it('retries once when a racing save took the version', async () => {
    mocks.appendSlotValue.mockRejectedValueOnce(
      Object.assign(new Error('unique'), { code: 'P2002' })
    );
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Raced.' })
    ).resolves.toEqual({ outcome: 'written', version: 1 });
    expect(mocks.appendSlotValue).toHaveBeenCalledTimes(2);
  });

  it('writes nothing on the retry when the racing save wrote the same words', async () => {
    mocks.appendSlotValue.mockImplementationOnce(async (input) => {
      // The winner lands first, then this save hits the unique backstop.
      await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: input.value });
      throw Object.assign(new Error('unique'), { code: 'P2002' });
    });
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Twice.' })
    ).resolves.toEqual({ outcome: 'unchanged', version: 1 });
    expect(rows.map((r) => [r.value, r.version])).toEqual([['Twice.', 1]]);
  });

  it('throws when the retry loses the race too', async () => {
    const unique = () => Object.assign(new Error('unique'), { code: 'P2002' });
    mocks.appendSlotValue.mockRejectedValueOnce(unique()).mockRejectedValueOnce(unique());
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Raced.' })
    ).rejects.toThrow('unique');
    expect(mocks.appendSlotValue).toHaveBeenCalledTimes(2);
  });

  it('throws any other failure, so the person hears their words did not land', async () => {
    mocks.appendSlotValue.mockRejectedValueOnce(new Error('db down'));
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Lost?' })
    ).rejects.toThrow('db down');
    expect(mocks.appendSlotValue).toHaveBeenCalledTimes(1);
  });
});

describe('getDiscoveryState: resuming from server state alone', () => {
  it('starts a new person at the first question, not yet started', async () => {
    const state = await getDiscoveryState(USER);
    expect(state?.position).toEqual({ next: 'q01', skipped: [], finished: false });
    expect(state?.started).toBe(false);
    expect(state?.answers).toEqual({});
  });

  it('resumes after a sitting at the first question neither answered nor skipped', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' });
    await skipDiscoveryQuestion(USER, 'q03');
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[1], { words: 'Two.' });

    // A reload, or a week away: everything is read again.
    const state = await getDiscoveryState(USER);
    expect(state?.position).toEqual({ next: 'q04', skipped: ['q03'], finished: false });
    expect(state?.started).toBe(true);
  });

  it('follows the Core Set switch: the same answers, a different set, a different place', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' });
    expect((await getDiscoveryState(USER))?.position.next).toBe('q02');

    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[1], { words: 'Two.' });
    // All questions: q03 is next.
    expect((await getDiscoveryState(USER))?.position.next).toBe('q03');

    // Switched on: q03 is not core, so the next core question is q04.
    mocks.getDiscoverySet.mockResolvedValue(setOf([ALL[1], ALL[3]], true));
    const coreOnly = await getDiscoveryState(USER);
    expect(coreOnly?.position.next).toBe('q04');
    // The answer outside the set is not shown as one of this set's.
    expect(Object.keys(coreOnly?.answers ?? {})).toEqual(['q02']);

    // Switched off again: back to q03, and q01's answer is still there.
    mocks.getDiscoverySet.mockResolvedValue(setOf(ALL));
    const all = await getDiscoveryState(USER);
    expect(all?.position.next).toBe('q03');
    expect(all?.answers.q01).toEqual({ words: 'One.' });
  });

  it('reads only the set’s own slots', async () => {
    await getDiscoveryState(USER);
    expect(mocks.getSlotHeads).toHaveBeenCalledWith(USER, {
      slotSlugs: ['discovery_q01', 'discovery_q02', 'discovery_q03', 'discovery_q04'],
    });
  });

  it('is finished when every question is answered or skipped', async () => {
    for (const q of [ALL[0], ALL[1]]) {
      await answerDiscoveryQuestion(USER, setOf(ALL), q, { words: 'x' });
    }
    await skipDiscoveryQuestion(USER, 'q03');
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[3], { words: 'x', branch: 'no' });
    expect((await getDiscoveryState(USER))?.position).toEqual({
      next: null,
      skipped: ['q03'],
      finished: true,
    });
  });

  it('reads answers with no journey yet, and nothing skipped', async () => {
    mocks.getJourney.mockResolvedValue(null);
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' });
    expect((await getDiscoveryState(USER))?.position.next).toBe('q02');
  });

  it('gives the slot version of each current answer', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' });
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One, again.' });
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[1], { words: 'Two.' });
    expect((await getDiscoveryState(USER))?.versions).toEqual({ q01: 2, q02: 1 });
  });

  it('uses a set the caller already read, rather than reading it again', async () => {
    const state = await getDiscoveryState(USER, setOf([ALL[1]]));
    expect(mocks.getDiscoverySet).not.toHaveBeenCalled();
    expect(state?.position.next).toBe('q02');
  });

  it('stays started after the Core Set takes the answered questions out of the set', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' });
    await skipDiscoveryQuestion(USER, 'q03');

    // Neither q01 nor q03 is core: switched on, the set has no trace of them.
    mocks.getDiscoverySet.mockResolvedValue(setOf([ALL[1], ALL[3]], true));
    const state = await getDiscoveryState(USER);
    expect(state?.answers).toEqual({});
    expect(state?.position.skipped).toEqual([]);
    expect(state?.started).toBe(true);
  });

  it('answers null, not a fresh start, when it cannot read', async () => {
    mocks.getSlotHeads.mockRejectedValue(new Error('db down'));
    await expect(getDiscoveryState(USER)).resolves.toBeNull();
  });
});

describe('skipDiscoveryQuestion and leaveDiscovery', () => {
  it('records a skip on the onboarding node of the person’s own journey', async () => {
    await expect(skipDiscoveryQuestion(USER, 'q03')).resolves.toBe('recorded');
    expect(mocks.recordNodeProgress).toHaveBeenCalledWith(
      { userId: USER },
      { userId: USER, graphSlug: JOURNEY_MAP_SLUG },
      ONBOARDING_NODE_KEY,
      { 'discovery_skipped_at:q03': expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) }
    );
    expect(mocks.appendSlotValue).not.toHaveBeenCalled();
  });

  it('answers failed, without throwing, when there is no node to record on', async () => {
    node = null;
    await expect(skipDiscoveryQuestion(USER, 'q03')).resolves.toBe('failed');
    await expect(leaveDiscovery(USER)).resolves.toBe('failed');
  });

  it('marks the first sitting started on the first answer, and keeps that time', async () => {
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' });
    const first = node?.progress?.discovery_started_at;
    expect(first).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));

    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[1], { words: 'Two.' });
    await skipDiscoveryQuestion(USER, 'q03');
    await leaveDiscovery(USER);
    expect(node?.progress?.discovery_started_at).toBe(first);
  });

  it('marks the first sitting started on a skip', async () => {
    await skipDiscoveryQuestion(USER, 'q03');
    expect(node?.progress).toEqual({
      'discovery_skipped_at:q03': expect.any(String),
      discovery_started_at: expect.any(String),
    });
  });

  it('does not mark started for an answer that wrote nothing', async () => {
    rows.push({
      slotSlug: 'discovery_q01',
      value: 'Same.',
      version: 1,
      supersededAt: null,
      provenance: {},
    });
    await answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'Same.' });
    expect(mocks.recordNodeProgress).not.toHaveBeenCalled();
  });

  it('still saves the answer when the started mark cannot be recorded', async () => {
    mocks.getJourney.mockRejectedValue(new Error('journey down'));
    await expect(
      answerDiscoveryQuestion(USER, setOf(ALL), ALL[0], { words: 'One.' })
    ).resolves.toEqual({ outcome: 'written', version: 1 });
    expect(rows).toHaveLength(1);
  });

  it('marks the first sitting over, once', async () => {
    await expect(leaveDiscovery(USER)).resolves.toBe('recorded');
    expect((await getDiscoveryState(USER))?.started).toBe(true);
    const first = node?.progress?.discovery_started_at;

    await expect(leaveDiscovery(USER)).resolves.toBe('recorded');
    expect(mocks.recordNodeProgress).toHaveBeenCalledTimes(1);
    expect(node?.progress?.discovery_started_at).toBe(first);
  });
});
