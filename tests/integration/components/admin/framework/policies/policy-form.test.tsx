// @vitest-environment happy-dom

/**
 * Integration test — PolicyFormDialog (f-admin-surfaces t-2).
 *
 * The create / edit form over the shipped CRUD API. Its job is to render the right
 * controls per selected `kind` and assemble that kind's nested payload — so there is one
 * create assertion per kind (the four discriminated-union members in `kinds.ts`), plus
 * edit mode (kind read-only, `PATCH { payload, enabled }`) and server field errors
 * surfaced from the response. The client shape is a convenience; the server re-validates,
 * so these assert the POST/PATCH body the server receives, not client-side validity.
 *
 * @see components/admin/framework/policies/policy-form.tsx
 */

import type { FacilitationPolicyView } from '@/lib/framework/facilitation/policies/view';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import { PolicyFormDialog } from '@/components/admin/framework/policies/policy-form';
import { apiClient, APIClientError } from '@/lib/api/client';

const POLICIES_URL = '/api/v1/admin/framework/facilitation/policies';

/** Render a fresh create dialog (kind defaults to the first vocabulary member). */
function renderCreate() {
  const onSaved = vi.fn();
  render(<PolicyFormDialog open onOpenChange={vi.fn()} policy={null} onSaved={onSaved} />);
  return { onSaved };
}

/** Pick `option` from the Radix combobox with accessible `name`. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
  option: RegExp
) {
  await user.click(screen.getByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('PolicyFormDialog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates an auto_approval policy with the selected payload', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({});
    renderCreate();

    await selectOption(user, /^auto-approve$/i, /^none$/i);
    await user.click(screen.getByRole('button', { name: /create policy/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(POLICIES_URL, {
        body: { kind: 'auto_approval', payload: { autoApprove: 'none' }, enabled: true },
      });
    });
  });

  it('creates a relevance_gating policy with a match object and role array', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({});
    renderCreate();

    await selectOption(user, /^kind$/i, /^relevance_gating$/i);
    await user.type(screen.getByLabelText(/^map slug$/i), 'onboarding-journey');
    await user.click(screen.getByRole('checkbox', { name: 'onboarding' }));
    await user.click(screen.getByRole('checkbox', { name: 'path' }));
    await user.click(screen.getByRole('button', { name: /create policy/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(POLICIES_URL, {
        body: {
          kind: 'relevance_gating',
          payload: {
            graphSlug: 'onboarding-journey',
            match: {},
            allowedRoles: ['onboarding', 'path'],
          },
          enabled: true,
        },
      });
    });
  });

  it('creates a guard_minimum policy omitting unset guard floors', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({});
    renderCreate();

    await selectOption(user, /^kind$/i, /^guard_minimum$/i);
    await selectOption(user, /^facilitation role$/i, /^facilitator$/i);
    await selectOption(user, /^input guard minimum$/i, /^block$/i);
    await user.click(screen.getByRole('button', { name: /create policy/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(POLICIES_URL, {
        body: {
          kind: 'guard_minimum',
          payload: {
            scope: { type: 'facilitation_role', id: 'facilitator' },
            minimums: { input: 'block' },
          },
          enabled: true,
        },
      });
    });
  });

  it('creates an escalation policy with the nested scope and signal', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockResolvedValue({});
    renderCreate();

    await selectOption(user, /^kind$/i, /^escalation$/i);
    await selectOption(user, /^facilitation role$/i, /^facilitator$/i);
    await selectOption(user, /^guard$/i, /^output$/i);
    await selectOption(user, /^minimum outcome$/i, /^blocked$/i);
    await selectOption(user, /^priority$/i, /^high$/i);
    await user.click(screen.getByRole('button', { name: /create policy/i }));

    await waitFor(() => {
      expect(apiClient.post).toHaveBeenCalledWith(POLICIES_URL, {
        body: {
          kind: 'escalation',
          payload: {
            scope: { type: 'facilitation_role', id: 'facilitator' },
            signal: { guard: 'output', outcome: 'blocked' },
            priority: 'high',
          },
          enabled: true,
        },
      });
    });
  });

  it('edits a policy: kind is read-only and PATCH sends payload + enabled', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue({});
    const policy: FacilitationPolicyView = {
      id: 'pol-9',
      kind: 'escalation',
      enabled: true,
      payload: {
        scope: { type: 'facilitation_role', id: 'facilitator' },
        signal: { guard: 'output', outcome: 'blocked' },
        priority: 'low',
      },
      createdBy: 'user_admin',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    render(<PolicyFormDialog open onOpenChange={vi.fn()} policy={policy} onSaved={vi.fn()} />);

    // Kind is immutable in edit mode → shown as text, not a combobox.
    expect(screen.queryByRole('combobox', { name: /^kind$/i })).not.toBeInTheDocument();
    // Change the priority, keep the rest hydrated from the payload.
    await selectOption(user, /^priority$/i, /^high$/i);
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith(`${POLICIES_URL}/pol-9`, {
        body: {
          payload: {
            scope: { type: 'facilitation_role', id: 'facilitator' },
            signal: { guard: 'output', outcome: 'blocked' },
            priority: 'high',
          },
          enabled: true,
        },
      });
    });
  });

  it("surfaces the server's field errors on save failure", async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('Invalid facilitation policy', 'VALIDATION_ERROR', 400, {
        payload: ['autoApprove: Required'],
      })
    );
    renderCreate();

    await selectOption(user, /^auto-approve$/i, /^none$/i);
    await user.click(screen.getByRole('button', { name: /create policy/i }));

    expect(await screen.findByText('autoApprove: Required')).toBeInTheDocument();
  });

  it('keeps a refused save inside the open dialog, and clears it when the kind changes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    vi.mocked(apiClient.post).mockRejectedValue(new APIClientError('Refused', 'X', 500));
    render(<PolicyFormDialog open onOpenChange={onOpenChange} policy={null} onSaved={vi.fn()} />);

    await selectOption(user, /^auto-approve$/i, /^none$/i);
    await user.click(screen.getByRole('button', { name: /create policy/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refused');
    expect(onOpenChange).not.toHaveBeenCalled();

    await selectOption(user, /^kind$/i, /^relevance_gating$/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('closes on Cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<PolicyFormDialog open onOpenChange={onOpenChange} policy={null} onSaved={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('locks Cancel and the save button while a save is in flight', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.post).mockReturnValue(new Promise(() => {}));
    renderCreate();

    await selectOption(user, /^auto-approve$/i, /^none$/i);
    await user.click(screen.getByRole('button', { name: /create policy/i }));

    expect(await screen.findByRole('button', { name: /saving/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDisabled();
  });
});
