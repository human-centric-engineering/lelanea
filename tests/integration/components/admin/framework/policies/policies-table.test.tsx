// @vitest-environment happy-dom

/**
 * Integration test — PoliciesTable (f-admin-surfaces t-2).
 *
 * The policy admin list over the shipped CRUD API: renders every policy with its kind,
 * compact summary and enable toggle; the enable Switch fires `PATCH { enabled }`; delete
 * is a two-step confirm firing `DELETE`; the kind filter narrows the pre-fetched set; and
 * "New policy" opens the create dialog. Writes are mocked (`apiClient`) — happy-dom has no
 * network and the server owns validation.
 *
 * @see components/admin/framework/policies/policies-table.tsx
 */

import type { FacilitationPolicyView } from '@/lib/framework/facilitation/policies/view';
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

import { PoliciesTable } from '@/components/admin/framework/policies/policies-table';
import { apiClient } from '@/lib/api/client';

function makePolicy(over: Partial<FacilitationPolicyView> = {}): FacilitationPolicyView {
  return {
    id: 'pol-1',
    kind: 'auto_approval',
    enabled: true,
    payload: { autoApprove: 'none' },
    createdBy: 'user_admin',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    ...over,
  };
}

const POLICIES: FacilitationPolicyView[] = [
  makePolicy({ id: 'pol-1', kind: 'auto_approval', payload: { autoApprove: 'low_risk' } }),
  makePolicy({
    id: 'pol-2',
    kind: 'relevance_gating',
    enabled: false,
    payload: {
      graphSlug: 'onboarding',
      match: {},
      allowedRoles: ['onboarding', 'path'],
    },
  }),
];

describe('PoliciesTable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a row per policy with kind and summary', () => {
    render(<PoliciesTable initialPolicies={POLICIES} />);
    expect(screen.getByText('auto_approval')).toBeInTheDocument();
    expect(screen.getByText('relevance_gating')).toBeInTheDocument();
    expect(screen.getByText(/auto-approve: low_risk/)).toBeInTheDocument();
    expect(screen.getByText(/onboarding → onboarding, path/)).toBeInTheDocument();
  });

  it('renders an empty state when there are no policies', () => {
    render(<PoliciesTable initialPolicies={[]} />);
    expect(
      screen.getByText('No governance policies yet. Create one to start.')
    ).toBeInTheDocument();
  });

  it('summarises guard_minimum and escalation payloads', () => {
    render(
      <PoliciesTable
        initialPolicies={[
          makePolicy({
            id: 'gm',
            kind: 'guard_minimum',
            payload: {
              scope: { type: 'facilitation_role', id: 'facilitator' },
              minimums: { input: 'block', citation: 'log_only' },
            },
          }),
          makePolicy({
            id: 'esc',
            kind: 'escalation',
            payload: {
              scope: { type: 'facilitation_role', id: 'path' },
              signal: { guard: 'output', outcome: 'blocked' },
              priority: 'high',
            },
          }),
        ]}
      />
    );
    expect(screen.getByText(/facilitator · input: block, citation: log_only/)).toBeInTheDocument();
    expect(screen.getByText(/path · output\/blocked · high/)).toBeInTheDocument();
  });

  it('summarises defensively when payload leaves are missing or non-string', () => {
    render(
      <PoliciesTable
        initialPolicies={[
          // A numeric leaf exercises disp's number branch.
          makePolicy({ id: 'aa', kind: 'auto_approval', payload: { autoApprove: 5 } }),
          // Missing graphSlug + non-array roles → both fall back to the em-dash.
          makePolicy({ id: 'rg', kind: 'relevance_gating', payload: { allowedRoles: 'oops' } }),
          // Empty minimums → the "no minimums" arm; null payload → the {} fallback.
          makePolicy({ id: 'gm', kind: 'guard_minimum', payload: { minimums: {} } }),
          makePolicy({ id: 'esc', kind: 'escalation', payload: null }),
        ]}
      />
    );
    expect(screen.getByText(/auto-approve: 5/)).toBeInTheDocument();
    expect(screen.getByText(/— → —/)).toBeInTheDocument();
    expect(screen.getByText(/— · no minimums/)).toBeInTheDocument();
    expect(screen.getByText(/— · —\/— · —/)).toBeInTheDocument();
  });

  it('shows a per-kind empty state when the filter matches no rows', async () => {
    const user = userEvent.setup();
    render(
      <PoliciesTable initialPolicies={[makePolicy({ id: 'pol-1', kind: 'auto_approval' })]} />
    );

    await user.click(screen.getByRole('combobox', { name: /kind/i }));
    await user.click(await screen.findByRole('option', { name: /escalation/i }));

    expect(await screen.findByText('No policies of this kind.')).toBeInTheDocument();
  });

  it('opens the edit dialog seeded from the row', async () => {
    const user = userEvent.setup();
    render(<PoliciesTable initialPolicies={POLICIES} />);

    const row = screen.getByText('auto_approval').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /edit/i }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /edit policy/i })).toBeInTheDocument();
  });

  it('surfaces an error when a toggle fails', async () => {
    const user = userEvent.setup();
    const { APIClientError } = await import('@/lib/api/client');
    vi.mocked(apiClient.patch).mockRejectedValue(new APIClientError('Update blew up', 'X', 500));
    render(<PoliciesTable initialPolicies={POLICIES} />);

    await user.click(screen.getByRole('switch', { name: /toggle auto_approval policy/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Failed to update the policy: Update blew up'
    );
  });

  it('cancels a delete confirm without calling DELETE', async () => {
    const user = userEvent.setup();
    render(<PoliciesTable initialPolicies={POLICIES} />);

    const row = screen.getByText('auto_approval').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /^delete$/i }));
    await user.click(within(row).getByRole('button', { name: /^cancel$/i }));

    expect(apiClient.delete).not.toHaveBeenCalled();
    // Back to the row action buttons.
    expect(within(row).getByRole('button', { name: /edit/i })).toBeInTheDocument();
  });

  it('toggles a policy enabled via PATCH { enabled }', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({});
    render(<PoliciesTable initialPolicies={POLICIES} />);

    // pol-1 is enabled → toggling sends enabled:false.
    const toggle = screen.getByRole('switch', { name: /toggle auto_approval policy/i });
    await user.click(toggle);

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(
        '/api/v1/admin/framework/facilitation/policies/pol-1',
        { body: { enabled: false } }
      );
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('deletes a policy behind a two-step confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockResolvedValue({});
    render(<PoliciesTable initialPolicies={POLICIES} />);

    const row = screen.getByText('auto_approval').closest('tr') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /^delete$/i }));
    // Confirm step.
    await user.click(within(row).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(apiClient.delete).toHaveBeenCalledWith(
        '/api/v1/admin/framework/facilitation/policies/pol-1'
      );
    });
  });

  it('filters the list by kind', async () => {
    const user = userEvent.setup();
    render(<PoliciesTable initialPolicies={POLICIES} />);

    await user.click(screen.getByRole('combobox', { name: /kind/i }));
    await user.click(await screen.findByRole('option', { name: /relevance_gating/i }));

    // Scope to the table — the filter combobox also shows the selected kind's label.
    const table = screen.getByRole('table');
    await waitFor(() => {
      expect(within(table).queryByText('auto_approval')).not.toBeInTheDocument();
    });
    expect(within(table).getByText('relevance_gating')).toBeInTheDocument();
  });

  it('opens the create dialog from "New policy"', async () => {
    const user = userEvent.setup();
    render(<PoliciesTable initialPolicies={POLICIES} />);

    await user.click(screen.getByRole('button', { name: /new policy/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /new policy/i })).toBeInTheDocument();
  });
});
