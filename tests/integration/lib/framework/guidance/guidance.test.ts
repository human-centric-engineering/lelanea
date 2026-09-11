/**
 * Guidance orchestration (f-guidance t-1; f-overlays t-2). Mocks the assembler, the engine, the
 * timeline read, and the f-overlays advisory-related enrichment; asserts `loadGuidance` composes
 * assemble → computeAvailability → rankMoves → related-enrichment (F9: availability is computed
 * independently, before and unaffected by the advisory overlay), the null-passthrough, the focus
 * suggestion, and the synopsis path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/framework/guidance/assemble', () => ({ assembleJourneyContext: vi.fn() }));
vi.mock('@/lib/framework/facilitation/engine/availability', () => ({
  computeAvailability: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/engine/apply-event', () => ({ applyEvent: vi.fn() }));
vi.mock('@/lib/framework/facilitation/journey/queries', () => ({ getJourneyTimeline: vi.fn() }));
vi.mock('@/lib/framework/facilitation/map/version-service', () => ({
  getPublishedMapVersion: vi.fn(),
}));
vi.mock('@/lib/framework/facilitation/overlays/related', () => ({
  enrichMovesWithRelated: vi.fn(),
}));
vi.mock('@/lib/framework/engagement/module-completion', () => ({
  maybeEmitModuleCompleted: vi.fn(),
}));

// The access seam is WRAPPED, not replaced: both predicates keep their real bodies, so
// the behavioural cases below exercise the genuine grant, while the spies record which
// one the write path consulted. That is the only way to pin #242 — `canWrite` and
// `canRead` are value-identical until Sunrise #367 lands, so no input distinguishes
// them, and the regression this guards (swapping back to `canRead`) only becomes
// observable on the day reads widen and silently take writes with them.
const accessSpies = vi.hoisted(() => ({ canRead: vi.fn(), canWrite: vi.fn() }));
vi.mock('@/lib/framework/shared/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/framework/shared/access')>();
  accessSpies.canRead.mockImplementation(actual.canRead);
  accessSpies.canWrite.mockImplementation(actual.canWrite);
  return { ...actual, canRead: accessSpies.canRead, canWrite: accessSpies.canWrite };
});

import {
  loadGuidance,
  loadFocusSuggestion,
  loadProgressSynopsis,
  applyJourneyTransition,
} from '@/lib/framework/guidance/guidance';
import { assembleJourneyContext } from '@/lib/framework/guidance/assemble';
import { computeAvailability } from '@/lib/framework/facilitation/engine/availability';
import { applyEvent } from '@/lib/framework/facilitation/engine/apply-event';
import { getJourneyTimeline } from '@/lib/framework/facilitation/journey/queries';
import { getPublishedMapVersion } from '@/lib/framework/facilitation/map/version-service';
import { enrichMovesWithRelated } from '@/lib/framework/facilitation/overlays/related';
import { maybeEmitModuleCompleted } from '@/lib/framework/engagement/module-completion';
import { ForbiddenError } from '@/lib/api/errors';

const viewer = { userId: 'user-1' };
const key = { userId: 'user-1', graphSlug: 'onboarding' };

const availabilityInput = {
  graph: { neighbours: () => [] },
  now: new Date('2026-07-05T12:00:00Z'),
};
const context = {
  journey: { id: 'journey-1' },
  nodeStates: [{ nodeKey: 'a', status: 'completed' }],
  slotHeads: [],
  now: { instant: new Date('2026-07-05T12:00:00Z'), timeZone: 'UTC' },
  availabilityInput,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assembleJourneyContext).mockResolvedValue(context);
  vi.mocked(computeAvailability).mockReturnValue({
    perNode: new Map(),
    validMoves: ['next'],
    firsts: ['next'],
  });
  vi.mocked(getJourneyTimeline).mockResolvedValue([] as never);
  vi.mocked(getPublishedMapVersion).mockResolvedValue(2);
  // Default: identity enrichment (no embeddings surfaced) so the non-overlay assertions hold.
  vi.mocked(enrichMovesWithRelated).mockImplementation(async (_slug, _v, moves) => [...moves]);
});

describe('loadGuidance', () => {
  it('composes assemble → computeAvailability → rankMoves', async () => {
    const guidance = await loadGuidance(viewer, key);
    expect(guidance).not.toBeNull();
    expect(computeAvailability).toHaveBeenCalledWith(availabilityInput);
    expect(guidance!.moves.map((m) => m.nodeKey)).toEqual(['next']); // ranked from validMoves
    expect(guidance!.moves[0].reasons.map((r) => r.code)).toContain('first_arrival');
  });

  it('returns null when there is nothing to guide', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);
    expect(await loadGuidance(viewer, key)).toBeNull();
    expect(computeAvailability).not.toHaveBeenCalled();
  });

  it('fills the advisory `related` slot from the overlay, keyed on the published version', async () => {
    vi.mocked(enrichMovesWithRelated).mockImplementation(async (_slug, _v, moves) =>
      moves.map((m) => ({ ...m, related: ['related-node'] }))
    );
    const guidance = await loadGuidance(viewer, key);
    expect(getPublishedMapVersion).toHaveBeenCalledWith('onboarding');
    expect(enrichMovesWithRelated).toHaveBeenCalledWith('onboarding', 2, expect.any(Array));
    expect(guidance!.moves[0].related).toEqual(['related-node']);
  });

  it('F9: availability is computed independently and is unaffected by the related overlay', async () => {
    // Even a destructive overlay (drops every move) must NOT change `availability` — eligibility is
    // the engine's alone. loadGuidance computes availability before enrichment and returns it as-is.
    vi.mocked(enrichMovesWithRelated).mockResolvedValue([]);
    const guidance = await loadGuidance(viewer, key);
    expect(guidance!.availability).toEqual({
      perNode: new Map(),
      validMoves: ['next'],
      firsts: ['next'],
    });
    // Enrichment ran after availability, over the ranked eligible set.
    const rankedArg = vi.mocked(enrichMovesWithRelated).mock.calls[0][2];
    expect(rankedArg.map((m) => m.nodeKey)).toEqual(['next']);
  });

  it('skips enrichment when there is no published version (moves keep empty related)', async () => {
    vi.mocked(getPublishedMapVersion).mockResolvedValue(null);
    const guidance = await loadGuidance(viewer, key);
    expect(enrichMovesWithRelated).not.toHaveBeenCalled();
    expect(guidance!.moves[0].related).toEqual([]);
  });
});

describe('loadFocusSuggestion', () => {
  it('derives a linger/move recommendation from the ranked moves', async () => {
    const s = await loadFocusSuggestion(viewer, key);
    expect(s).not.toBeNull();
    expect(['linger', 'move']).toContain(s!.recommendation);
  });

  it('is null when nothing to guide', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);
    expect(await loadFocusSuggestion(viewer, key)).toBeNull();
  });
});

describe('loadProgressSynopsis', () => {
  it('reads the timeline (desc) and digests the node states', async () => {
    const s = await loadProgressSynopsis(viewer, key);
    expect(getJourneyTimeline).toHaveBeenCalledWith(
      viewer,
      { journeyId: 'journey-1', subject: 'user-1' },
      { order: 'desc' },
      undefined
    );
    expect(s).toMatchObject({ totalTracked: 1, completed: 1, milestones: ['a'] });
  });

  it('is null when the journey has not started', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);
    expect(await loadProgressSynopsis(viewer, key)).toBeNull();
    expect(getJourneyTimeline).not.toHaveBeenCalled();
  });
});

describe('applyJourneyTransition', () => {
  it('assembles the context and calls applyEvent with the resolved transition', async () => {
    vi.mocked(applyEvent).mockResolvedValue({ ok: true, nodeState: {}, event: {} } as never);
    await applyJourneyTransition(viewer, key, { nodeKey: 'intro', kind: 'enter' });
    expect(applyEvent).toHaveBeenCalledWith({
      ...availabilityInput,
      transition: { userId: 'user-1', journeyId: 'journey-1', nodeKey: 'intro', kind: 'enter' },
    });
  });

  it('returns null (no write) when the journey has not started', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);
    expect(
      await applyJourneyTransition(viewer, key, { nodeKey: 'n', kind: 'complete' })
    ).toBeNull();
    expect(applyEvent).not.toHaveBeenCalled();
  });

  // A context whose graph resolves `nodeKey` to the given node — the module.completed
  // detection reads `graph.node(nodeKey).moduleSlug` after a committed `complete`.
  function contextWithNode(node: { moduleSlug?: string } | undefined) {
    return {
      ...(context as object),
      availabilityInput: { ...availabilityInput, graph: { node: () => node } },
    } as never;
  }

  it('checks module.completed after a committed complete of a module node', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(
      contextWithNode({ moduleSlug: 'onboarding' })
    );
    vi.mocked(applyEvent).mockResolvedValue({ ok: true, nodeState: {}, event: {} } as never);

    await applyJourneyTransition(viewer, key, { nodeKey: 'deep', kind: 'complete' });

    expect(maybeEmitModuleCompleted).toHaveBeenCalledWith({
      userId: 'user-1',
      moduleSlug: 'onboarding',
      journeyId: 'journey-1',
      graph: expect.anything(),
    });
  });

  it('does NOT check module.completed when the completed node is not a module node', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(contextWithNode({})); // no moduleSlug
    vi.mocked(applyEvent).mockResolvedValue({ ok: true, nodeState: {}, event: {} } as never);

    await applyJourneyTransition(viewer, key, { nodeKey: 'stage-1', kind: 'complete' });

    expect(maybeEmitModuleCompleted).not.toHaveBeenCalled();
  });

  it('does NOT check module.completed when the engine refused the complete', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(
      contextWithNode({ moduleSlug: 'onboarding' })
    );
    vi.mocked(applyEvent).mockResolvedValue({
      ok: false,
      rejection: { code: 'not_active' },
    } as never);

    await applyJourneyTransition(viewer, key, { nodeKey: 'deep', kind: 'complete' });

    expect(maybeEmitModuleCompleted).not.toHaveBeenCalled();
  });

  it('does NOT check module.completed on an enter (only completes finish a module)', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(
      contextWithNode({ moduleSlug: 'onboarding' })
    );
    vi.mocked(applyEvent).mockResolvedValue({ ok: true, nodeState: {}, event: {} } as never);

    await applyJourneyTransition(viewer, key, { nodeKey: 'deep', kind: 'enter' });

    expect(maybeEmitModuleCompleted).not.toHaveBeenCalled();
  });
});

describe('applyJourneyTransition — the write guard (#242)', () => {
  const OTHER = 'user-2';

  it('guards on canWrite, and does so BEFORE assembling anything', async () => {
    await expect(
      applyJourneyTransition(
        { userId: 'user-1' },
        { userId: OTHER, graphSlug: 'onboarding' },
        {
          nodeKey: 'a',
          kind: 'enter',
        }
      )
    ).rejects.toBeInstanceOf(ForbiddenError);

    // The point of placing the guard ahead of the assembler: a viewer who may not
    // write triggers NO reads at all. Six of them sit behind `assembleJourneyContext`
    // (published graph, journey, node states, slot heads, `now`, module list).
    expect(assembleJourneyContext).not.toHaveBeenCalled();
    expect(applyEvent).not.toHaveBeenCalled();
  });

  it('consults canWrite — the pinned grant — and never the widening canRead', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);

    await applyJourneyTransition({ userId: 'user-1' }, key, { nodeKey: 'a', kind: 'enter' });

    expect(accessSpies.canWrite).toHaveBeenCalledWith({ userId: 'user-1' }, 'user-1', undefined);
    // `canWrite` composes `canRead` inside `access.ts`, but that is a module-INTERNAL
    // call and does not route through this mocked export — which is what makes the
    // second line sharp: the export being untouched means the write path never reached
    // for it. Swap `canWrite` for `canRead` in `guidance.ts` and both lines fail.
    expect(accessSpies.canWrite).toHaveBeenCalledOnce();
    expect(accessSpies.canRead).not.toHaveBeenCalled();
  });

  it('passes the caller scope to the guard, so a narrowing #367 can refuse the write', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);

    await applyJourneyTransition(
      { userId: 'user-1' },
      key,
      { nodeKey: 'a', kind: 'enter' },
      { ownership: 'team' }
    );

    expect(accessSpies.canWrite).toHaveBeenCalledWith({ userId: 'user-1' }, 'user-1', {
      ownership: 'team',
    });
  });

  it('still admits the admin-support override, which is a write credential by design', async () => {
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);

    await expect(
      applyJourneyTransition(
        { userId: 'user-1', isAdminSupport: true },
        { userId: OTHER, graphSlug: 'onboarding' },
        { nodeKey: 'a', kind: 'enter' }
      )
    ).resolves.toBeNull();

    expect(assembleJourneyContext).toHaveBeenCalled();
  });
});
