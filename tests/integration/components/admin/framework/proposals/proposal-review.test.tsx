// @vitest-environment happy-dom

/**
 * Integration test — ProposalReview (f-admin-surfaces t-3).
 *
 * The proposal detail + decision surface over the shipped approve/reject API: renders the
 * metadata + a JSON view of the proposed definition; a pending proposal shows approve /
 * reject, approve fires `POST …/approve` and reject fires `POST …/reject { reason }` (reason
 * required); a decided proposal hides the actions and shows its outcome; server errors
 * surface in the dialog. Writes are mocked (`apiClient`) — happy-dom has no network and the
 * server owns the state transition + conflict checks.
 *
 * @see components/admin/framework/proposals/proposal-review.tsx
 */

import type { StructureChangeProposalView } from '@/lib/framework/facilitation/emergence/view';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import { ProposalReview } from '@/components/admin/framework/proposals/proposal-review';
import { apiClient } from '@/lib/api/client';

function makeProposal(
  over: Partial<StructureChangeProposalView> = {}
): StructureChangeProposalView {
  return {
    id: 'scp-1',
    subjectType: 'map',
    subjectId: 'onboarding',
    baseVersion: 3,
    proposedDefinition: { nodes: [{ key: 'start' }], edges: [] },
    status: 'pending',
    riskClass: 'unclassified',
    createdBy: 'agent:onboarding',
    reviewedBy: null,
    rejectionReason: null,
    publishedVersionId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...over,
  };
}

describe('ProposalReview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the metadata and the proposed-definition JSON', () => {
    render(<ProposalReview proposal={makeProposal()} />);

    expect(screen.getByText('map:onboarding')).toBeInTheDocument();
    expect(screen.getByText('agent:onboarding')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
    // The proposed definition is rendered as JSON (a stable key is visible).
    expect(screen.getByText(/"key": "start"/)).toBeInTheDocument();
  });

  it('shows "no published version" when baseVersion is null', () => {
    render(<ProposalReview proposal={makeProposal({ baseVersion: null })} />);
    expect(screen.getByText('— (no published version)')).toBeInTheDocument();
  });

  it('approves via POST /approve and refreshes', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({});
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    // Confirm in the dialog.
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & publish/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/framework/facilitation/proposals/scp-1/approve'
      );
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('rejects via POST /reject with the required reason', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({});
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('alertdialog');
    // Reason empty → the confirm button is disabled.
    const confirm = within(dialog).getByRole('button', { name: /^reject$/i });
    expect(confirm).toBeDisabled();

    await user.type(within(dialog).getByRole('textbox'), 'Conflicts with the current map');
    await user.click(confirm);

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(
        '/api/v1/admin/framework/facilitation/proposals/scp-1/reject',
        { body: { reason: 'Conflicts with the current map' } }
      );
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('cancels the approve dialog without calling the API', async () => {
    const user = userEvent.setup();
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('cancels the reject dialog without calling the API', async () => {
    const user = userEvent.setup();
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /^cancel$/i }));

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('falls back to a default message when a non-Error is thrown', async () => {
    const user = userEvent.setup();
    // A rejection that isn't an API error has no words of its own to show.
    vi.mocked(apiClient.post).mockRejectedValue('kaboom');
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & publish/i }));

    expect(await screen.findByText('Failed to record the decision')).toBeInTheDocument();
  });

  it('falls back to a default message when reject throws a non-Error', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockRejectedValue('kaboom');
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByRole('textbox'), 'nope');
    await user.click(within(dialog).getByRole('button', { name: /^reject$/i }));

    expect(await screen.findByText('Failed to record the decision')).toBeInTheDocument();
  });

  it('surfaces the server error when approve fails (stale decision)', async () => {
    const user = userEvent.setup();
    const { APIClientError } = await import('@/lib/api/client');
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Proposal "scp-1" has already been decided', 'VALIDATION_ERROR', 400)
    );
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & publish/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/already been decided/i);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(nav.refresh).not.toHaveBeenCalled();
  });

  it("keeps the service's instruction when the error carries details", async () => {
    const user = userEvent.setup();
    const { APIClientError } = await import('@/lib/api/client');
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError(
        'The map changed since this proposal was made — please re-propose',
        'VALIDATION_ERROR',
        400,
        { baseVersion: ['Proposed against version 3, but it is now at 4'] }
      )
    );
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & publish/i }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/please re-propose/);
  });

  it('locks the dialog while a decision is in flight', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockReturnValue(new Promise(() => {}));
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & publish/i }));

    expect(within(dialog).getByRole('button', { name: /cancel/i })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('clears a refused decision when the dialog is reopened', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockRejectedValue('kaboom');
    render(<ProposalReview proposal={makeProposal()} />);

    await user.click(screen.getByRole('button', { name: /approve & publish/i }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /approve & publish/i }));
    await within(dialog).findByRole('alert');
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }));

    await user.click(screen.getByRole('button', { name: /^reject$/i }));
    const next = await screen.findByRole('alertdialog');
    expect(within(next).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides the actions and shows the outcome for a decided proposal', () => {
    render(
      <ProposalReview
        proposal={makeProposal({
          status: 'rejected',
          reviewedBy: 'user_admin',
          rejectionReason: 'Out of scope',
        })}
      />
    );

    expect(screen.queryByRole('button', { name: /approve & publish/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^reject$/i })).not.toBeInTheDocument();
    expect(screen.getByText('Out of scope')).toBeInTheDocument();
    expect(screen.getByText('user_admin')).toBeInTheDocument();
  });

  it('shows the published version id for a published proposal', () => {
    render(
      <ProposalReview
        proposal={makeProposal({ status: 'published', publishedVersionId: 'ver-42' })}
      />
    );
    expect(screen.getByText('ver-42')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve & publish/i })).not.toBeInTheDocument();
  });
});
