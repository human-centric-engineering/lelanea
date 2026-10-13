/**
 * `submit_proposal` (f-governance-plus t-2) — the emergence authoring capability. Mocks the agent
 * lookup + the proposal service; asserts the agent slug resolves into `agent:<slug>` authorship, the
 * end user is the audit actor, the structured success shape, the unknown-agent guard, and that a
 * pipeline ValidationError/NotFoundError surfaces as a structured capability error (not a throw).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: { aiAgent: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/framework/facilitation/emergence/proposal-service', () => ({
  submitStructureChangeProposal: vi.fn(),
}));

import { SubmitProposalCapability } from '@/lib/framework/facilitation/emergence/capabilities/submit-proposal';
import { emergenceCapabilities } from '@/lib/framework/facilitation/emergence/capabilities';
import { prisma } from '@/lib/db/client';
import { submitStructureChangeProposal } from '@/lib/framework/facilitation/emergence/proposal-service';
import { NotFoundError, ValidationError } from '@/lib/api/errors';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const cap = new SubmitProposalCapability();
const ctx = (userId: string | null): CapabilityContext => ({ userId, agentId: 'agent-1' });
const args = {
  subjectType: 'map' as const,
  subjectId: 'onboarding-map',
  proposedDefinition: { nodes: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aiAgent.findUnique).mockResolvedValue({ slug: 'facilitator' } as never);
  vi.mocked(submitStructureChangeProposal).mockResolvedValue({
    id: 'scp-1',
    status: 'pending',
    subjectType: 'map',
    subjectId: 'onboarding-map',
  } as never);
});

describe('slug + metadata', () => {
  it('exposes the framework tool identity and does not process PII', () => {
    expect(cap.slug).toBe('submit_proposal');
    expect(cap.functionDefinition.name).toBe('submit_proposal');
    expect(cap.processesPii).toBe(false);
    expect(cap.functionDefinition.parameters).toMatchObject({
      required: ['subjectType', 'subjectId', 'proposedDefinition'],
    });
  });

  it('is registered in the emergence capability set (boot wiring)', () => {
    expect(emergenceCapabilities.some((c) => c.slug === 'submit_proposal')).toBe(true);
  });

  it('rejects a call that omits proposedDefinition (the required contract is enforced)', () => {
    // A z.unknown() field would otherwise be optional — validate() must fail when it is absent.
    expect(() => cap.validate({ subjectType: 'map', subjectId: 'g' })).toThrow();
    // A present-but-falsy definition (e.g. null / empty object) is allowed — the pipeline judges shape.
    expect(
      cap.validate({ subjectType: 'map', subjectId: 'g', proposedDefinition: {} })
    ).toMatchObject({ subjectType: 'map' });
  });

  it('keeps the opaque proposedDefinition out of the provenance trace', () => {
    const redacted = cap.redactProvenance(
      { subjectType: 'map', subjectId: 'g', proposedDefinition: { huge: 'blob' } },
      {
        success: true,
        data: { proposalId: 'scp-1', status: 'pending', subjectType: 'map', subjectId: 'g' },
      }
    );
    expect(redacted.args).toEqual({
      subjectType: 'map',
      subjectId: 'g',
      proposedDefinition: '[omitted — stored on the proposal row]',
    });
    expect(redacted.resultPreview).toContain('scp-1');
  });
});

describe('execute', () => {
  it('authors as agent:<slug>, records the end user as the audit actor, returns the proposal', async () => {
    const result = await cap.execute(args, ctx('user-9'));

    expect(prisma.aiAgent.findUnique).toHaveBeenCalledWith({
      where: { id: 'agent-1' },
      select: { slug: true },
    });
    expect(submitStructureChangeProposal).toHaveBeenCalledWith({
      subjectType: 'map',
      subjectId: 'onboarding-map',
      proposedDefinition: { nodes: [] },
      createdBy: 'agent:facilitator',
      actorUserId: 'user-9',
    });
    expect(result).toEqual({
      success: true,
      data: {
        proposalId: 'scp-1',
        status: 'pending',
        subjectType: 'map',
        subjectId: 'onboarding-map',
      },
    });
  });

  it('threads a null user (system run) as the audit actor', async () => {
    await cap.execute(args, ctx(null));
    expect(submitStructureChangeProposal).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: null, createdBy: 'agent:facilitator' })
    );
  });

  it('refuses an anonymous embed visitor before resolving the agent — no proposal written', async () => {
    const result = await cap.execute(args, ctx('embed_visitor1'));
    expect(result).toMatchObject({ success: false, error: { code: 'anonymous_visitor' } });
    expect(prisma.aiAgent.findUnique).not.toHaveBeenCalled();
    expect(submitStructureChangeProposal).not.toHaveBeenCalled();
  });

  it('errors (no_agent) when the calling agent cannot be resolved — no proposal written', async () => {
    vi.mocked(prisma.aiAgent.findUnique).mockResolvedValue(null);
    const result = await cap.execute(args, ctx('user-9'));
    expect(result).toMatchObject({ success: false, error: { code: 'no_agent' } });
    expect(submitStructureChangeProposal).not.toHaveBeenCalled();
  });

  it('surfaces a pipeline ValidationError as a structured invalid_proposal error (not a throw)', async () => {
    vi.mocked(submitStructureChangeProposal).mockRejectedValue(
      new ValidationError('bad definition')
    );
    const result = await cap.execute(args, ctx('user-9'));
    expect(result).toMatchObject({
      success: false,
      error: { code: 'invalid_proposal', message: 'bad definition' },
    });
  });

  it('surfaces an unknown target as a structured subject_not_found error', async () => {
    vi.mocked(submitStructureChangeProposal).mockRejectedValue(
      new NotFoundError('map "nope" not found')
    );
    const result = await cap.execute(args, ctx('user-9'));
    expect(result).toMatchObject({ success: false, error: { code: 'subject_not_found' } });
  });

  it('lets an unexpected error propagate (dispatcher normalises it)', async () => {
    vi.mocked(submitStructureChangeProposal).mockRejectedValue(new Error('db exploded'));
    await expect(cap.execute(args, ctx('user-9'))).rejects.toThrow('db exploded');
  });
});
