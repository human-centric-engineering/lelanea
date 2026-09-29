/**
 * Relevance/maturity gating (f-policies t-2). Two units: the pure `deriveCurrentStageRegion`
 * (current position from node states + graph), and `isRoleAllowedAtStage` (the fail-open gate over
 * enabled relevance_gating policies). Mocks the policy query + the journey-context assembler; keeps
 * the real `relevanceGatingPayloadSchema` and the real derivation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { UserNodeState } from '@prisma/client';
import type { GraphStore } from '@/lib/framework/facilitation/engine/graph-store';
import type { MapNode } from '@/lib/framework/facilitation/map/schema';

vi.mock('@/lib/framework/facilitation/policies/policy-queries', () => ({
  listEnabledFacilitationPolicies: vi.fn(),
}));
vi.mock('@/lib/framework/guidance/assemble', () => ({ assembleJourneyContext: vi.fn() }));

import {
  deriveCurrentStageRegion,
  isRoleAllowedAtStage,
} from '@/lib/framework/facilitation/policies/gating';
import { listEnabledFacilitationPolicies } from '@/lib/framework/facilitation/policies/policy-queries';
import { assembleJourneyContext } from '@/lib/framework/guidance/assemble';

const nodeState = (over: Partial<UserNodeState>): UserNodeState => ({
  id: 'ns',
  orgId: null,
  journeyId: 'j1',
  nodeKey: 'n1',
  status: 'active',
  timesCompleted: 0,
  progress: null,
  firstEnteredAt: null,
  lastActiveAt: null,
  completedAt: null,
  ...over,
});

/** A minimal GraphStore stub — the derivation only calls `.node()`. */
const graphWith = (nodes: Record<string, Partial<MapNode>>): GraphStore =>
  ({ node: (k: string) => nodes[k] as MapNode | undefined }) as unknown as GraphStore;

describe('deriveCurrentStageRegion', () => {
  const graph = graphWith({
    n1: { stage: 's1', region: 'r1' },
    n2: { stage: 's2', region: 'r2' },
    n3: { stage: 's3' },
  });

  it('returns {} when no node is reached (all available/unvisited)', () => {
    const states = [nodeState({ nodeKey: 'n1', status: 'available' })];
    expect(deriveCurrentStageRegion(states, graph)).toEqual({});
  });

  it('maps the active node to its authored stage/region', () => {
    const states = [nodeState({ nodeKey: 'n1', status: 'active', lastActiveAt: new Date() })];
    expect(deriveCurrentStageRegion(states, graph)).toEqual({ stage: 's1', region: 'r1' });
  });

  it('prefers the active node over a more-recently-touched visited node', () => {
    const states = [
      nodeState({ nodeKey: 'n1', status: 'active', lastActiveAt: new Date('2026-01-01') }),
      nodeState({ nodeKey: 'n2', status: 'visited', lastActiveAt: new Date('2026-06-01') }),
    ];
    expect(deriveCurrentStageRegion(states, graph)).toEqual({ stage: 's1', region: 'r1' });
  });

  it('among reached nodes of equal rank, the most-recently-active wins', () => {
    const states = [
      nodeState({ nodeKey: 'n1', status: 'visited', lastActiveAt: new Date('2026-01-01') }),
      nodeState({ nodeKey: 'n2', status: 'completed', lastActiveAt: new Date('2026-06-01') }),
    ];
    expect(deriveCurrentStageRegion(states, graph)).toEqual({ stage: 's2', region: 'r2' });
  });

  it('yields undefined stage/region when the current node is missing from the graph', () => {
    const states = [nodeState({ nodeKey: 'ghost', status: 'active', lastActiveAt: new Date() })];
    expect(deriveCurrentStageRegion(states, graph)).toEqual({
      stage: undefined,
      region: undefined,
    });
  });
});

const policy = (payload: unknown) => ({ id: 'fp-1', kind: 'relevance_gating', payload });
const contextAt = (stage: string, region?: string) => ({
  nodeStates: [nodeState({ nodeKey: 'n1', status: 'active', lastActiveAt: new Date() })],
  availabilityInput: { graph: graphWith({ n1: { stage, region } }) },
});

beforeEach(() => vi.clearAllMocks());

describe('isRoleAllowedAtStage', () => {
  it('fails open (allows) when no relevance_gating policies exist — no assembly', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([]);
    expect(await isRoleAllowedAtStage('u1', 'onboarding')).toBe(true);
    expect(assembleJourneyContext).not.toHaveBeenCalled();
  });

  it('fails open when the user has not started the policy graph (assembly null)', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([
      policy({ graphSlug: 'g1', match: { stage: 's1' }, allowedRoles: ['onboarding'] }),
    ] as never);
    vi.mocked(assembleJourneyContext).mockResolvedValue(null);
    expect(await isRoleAllowedAtStage('u1', 'synopsis')).toBe(true);
  });

  it('allows a role listed in an applicable policy', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([
      policy({ graphSlug: 'g1', match: { stage: 's1' }, allowedRoles: ['onboarding', 'state'] }),
    ] as never);
    vi.mocked(assembleJourneyContext).mockResolvedValue(contextAt('s1') as never);
    expect(await isRoleAllowedAtStage('u1', 'state')).toBe(true);
  });

  it('denies a role omitted by an applicable policy', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([
      policy({ graphSlug: 'g1', match: { stage: 's1' }, allowedRoles: ['onboarding'] }),
    ] as never);
    vi.mocked(assembleJourneyContext).mockResolvedValue(contextAt('s1') as never);
    expect(await isRoleAllowedAtStage('u1', 'synopsis')).toBe(false);
  });

  it('does not apply when the user is at a different stage (allows)', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([
      policy({ graphSlug: 'g1', match: { stage: 's1' }, allowedRoles: ['onboarding'] }),
    ] as never);
    vi.mocked(assembleJourneyContext).mockResolvedValue(contextAt('s2') as never);
    expect(await isRoleAllowedAtStage('u1', 'synopsis')).toBe(true);
  });

  it('an empty match gates the whole graph (denies an unlisted role)', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([
      policy({ graphSlug: 'g1', match: {}, allowedRoles: ['onboarding'] }),
    ] as never);
    vi.mocked(assembleJourneyContext).mockResolvedValue(contextAt('anything') as never);
    expect(await isRoleAllowedAtStage('u1', 'synopsis')).toBe(false);
  });

  it('skips a malformed stored payload rather than crashing (allows if it was the only policy)', async () => {
    vi.mocked(listEnabledFacilitationPolicies).mockResolvedValue([
      policy({ graphSlug: 'g1' }), // missing allowedRoles → safeParse fails
    ] as never);
    expect(await isRoleAllowedAtStage('u1', 'synopsis')).toBe(true);
    expect(assembleJourneyContext).not.toHaveBeenCalled(); // never grouped → never assembled
  });
});
