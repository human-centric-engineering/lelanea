// @vitest-environment happy-dom

/**
 * Integration test — WorkflowsTab (f-ops-views t-4b).
 *
 * The module's event→workflow binding surface: the stitched read table (won't-fire-yet /
 * inactive / disabled flags, degraded "unknown workflow" row), the bind flow (roster fetched
 * on demand → pick workflow + event type + optional JSON template → POST), enable/disable
 * (PATCH), and two-step unbind (DELETE) — plus the null-degrade and server field errors.
 *
 * @see components/admin/framework/module-detail/workflows-tab.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { ModuleWorkflowBindingListItem } from '@/lib/framework/modules/view';

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return {
    ...actual,
    apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  };
});

import { WorkflowsTab } from '@/components/admin/framework/module-detail/workflows-tab';
import { apiClient, APIClientError } from '@/lib/api/client';

function binding(over: Partial<ModuleWorkflowBindingListItem> = {}): ModuleWorkflowBindingListItem {
  return {
    id: 'b1',
    workflowId: 'wf-1',
    eventType: 'module.entered',
    enabled: true,
    inputTemplate: null,
    version: '"v1"',
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    workflow: {
      id: 'wf-1',
      name: 'Welcome Flow',
      slug: 'welcome-flow',
      isActive: true,
      hasPublishedVersion: true,
    },
    ...over,
  };
}

const ROSTER = [{ id: 'wf-1', name: 'Welcome Flow', slug: 'welcome-flow' }];
const WF_URL = '/api/v1/admin/framework/modules/reading/workflows';

function renderTab(props: Partial<Parameters<typeof WorkflowsTab>[0]> = {}) {
  return render(<WorkflowsTab slug="reading" bindings={[binding()]} {...props} />);
}

describe('WorkflowsTab', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a binding with its workflow and event', () => {
    renderTab();
    expect(screen.getByText('Welcome Flow')).toBeInTheDocument();
    expect(screen.getByText('module.entered')).toBeInTheDocument();
  });

  it("flags won't-fire-yet, disabled, and degrades a removed workflow", () => {
    renderTab({
      bindings: [
        binding({
          id: 'b1',
          enabled: false,
          workflow: {
            id: 'wf-1',
            name: 'Draft Flow',
            slug: 'draft',
            isActive: true,
            hasPublishedVersion: false,
          },
        }),
        binding({ id: 'b2', workflow: null }),
      ],
    });
    expect(screen.getByText(/won.t fire yet/i)).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText(/unknown workflow/i)).toBeInTheDocument();
  });

  it('shows the empty state and a bind button', () => {
    renderTab({ bindings: [] });
    expect(screen.getByText(/no workflows are bound yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /bind workflow/i })).toBeInTheDocument();
  });

  it('binds an event to a workflow (roster fetched on demand, isTemplate=false → POST)', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue(ROSTER);
    vi.mocked(apiClient.post).mockResolvedValue(undefined);

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));

    const wfCombo = await screen.findByRole('combobox', { name: /workflow/i });
    await waitFor(() => expect(wfCombo).toBeEnabled());
    await user.click(wfCombo);
    await user.click(await screen.findByRole('option', { name: /welcome flow/i }));

    await user.type(screen.getByLabelText(/event type/i), 'module.completed');
    await user.click(screen.getByRole('button', { name: /^bind$/i }));

    expect(apiClient.get).toHaveBeenCalledWith(
      '/api/v1/admin/orchestration/workflows?isActive=true&isTemplate=false&limit=100'
    );
    expect(apiClient.post).toHaveBeenCalledWith(WF_URL, {
      body: { workflowId: 'wf-1', eventType: 'module.completed', enabled: true },
    });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('parses and sends a JSON input template', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue(ROSTER);
    vi.mocked(apiClient.post).mockResolvedValue(undefined);

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    const wfCombo = await screen.findByRole('combobox', { name: /workflow/i });
    await waitFor(() => expect(wfCombo).toBeEnabled());
    await user.click(wfCombo);
    await user.click(await screen.findByRole('option', { name: /welcome flow/i }));
    await user.type(screen.getByLabelText(/event type/i), 'module.entered');
    fireEvent.change(screen.getByLabelText(/input template/i), {
      target: { value: '{"greeting":"hi"}' },
    });
    await user.click(screen.getByRole('button', { name: /^bind$/i }));

    expect(apiClient.post).toHaveBeenCalledWith(WF_URL, {
      body: {
        workflowId: 'wf-1',
        eventType: 'module.entered',
        enabled: true,
        inputTemplate: { greeting: 'hi' },
      },
    });
  });

  it('blocks an invalid JSON template without calling the API', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue(ROSTER);

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    const wfCombo = await screen.findByRole('combobox', { name: /workflow/i });
    await waitFor(() => expect(wfCombo).toBeEnabled());
    await user.click(wfCombo);
    await user.click(await screen.findByRole('option', { name: /welcome flow/i }));
    await user.type(screen.getByLabelText(/event type/i), 'module.entered');
    fireEvent.change(screen.getByLabelText(/input template/i), { target: { value: 'not json' } });
    await user.click(screen.getByRole('button', { name: /^bind$/i }));

    expect(screen.getByText(/input template: invalid json/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('blocks a bind with no workflow or event', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue(ROSTER);

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /workflow/i })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: /^bind$/i }));

    expect(screen.getByText(/choose a workflow and enter an event type/i)).toBeInTheDocument();
    expect(apiClient.post).not.toHaveBeenCalled();
  });

  it('surfaces the server field error on a failed bind', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue(ROSTER);
    vi.mocked(apiClient.post).mockRejectedValue(
      new APIClientError('bad', 'VALIDATION_ERROR', 422, {
        eventType: ['already bound to that workflow'],
      })
    );

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    const wfCombo = await screen.findByRole('combobox', { name: /workflow/i });
    await waitFor(() => expect(wfCombo).toBeEnabled());
    await user.click(wfCombo);
    await user.click(await screen.findByRole('option', { name: /welcome flow/i }));
    await user.type(screen.getByLabelText(/event type/i), 'module.entered');
    await user.click(screen.getByRole('button', { name: /^bind$/i }));

    expect(await screen.findByText(/already bound to that workflow/i)).toBeInTheDocument();
  });

  it('toggles a binding enabled → disabled', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.patch).mockResolvedValue(undefined);

    renderTab({ bindings: [binding({ id: 'b9', enabled: true })] });
    await user.click(screen.getByRole('button', { name: /disable/i }));

    expect(apiClient.patch).toHaveBeenCalledWith(`${WF_URL}/b9`, { body: { enabled: false } });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('unbinds through a two-step confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.delete).mockResolvedValue(undefined);

    renderTab({ bindings: [binding({ id: 'b9' })] });
    await user.click(screen.getByRole('button', { name: /^unbind$/i }));
    expect(apiClient.delete).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /confirm/i }));

    expect(apiClient.delete).toHaveBeenCalledWith(`${WF_URL}/b9`);
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("locks other rows' actions while a confirm is open (no concurrent mutations)", async () => {
    const user = userEvent.setup();
    renderTab({
      bindings: [
        binding({ id: 'a', eventType: 'module.entered' }),
        binding({ id: 'b', eventType: 'module.completed' }),
      ],
    });

    // Open the unbind confirm on the first row.
    const unbindButtons = screen.getAllByRole('button', { name: /^unbind$/i });
    await user.click(unbindButtons[0]);

    // The other row's Disable action is now locked (can't start a concurrent mutation).
    expect(screen.getByRole('button', { name: /disable/i })).toBeDisabled();
  });

  it('shows a roster load error', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockRejectedValue(new APIClientError('boom', 'ERR', 500));

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));

    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
  });

  it('shows a "couldn\'t load bindings" state when the fetch failed', () => {
    renderTab({ bindings: null });
    expect(screen.getByText(/current bindings couldn.t be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/no workflows are bound yet/i)).not.toBeInTheDocument();
  });

  it('flags a truncated roster (first 100 shown)', async () => {
    const user = userEvent.setup();
    const bigRoster = Array.from({ length: 100 }, (_, i) => ({
      id: `w${i}`,
      name: `Flow ${i}`,
      slug: `flow-${i}`,
    }));
    vi.mocked(apiClient.get).mockResolvedValue(bigRoster);

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));

    expect(await screen.findByText(/showing the first 100 workflows/i)).toBeInTheDocument();
  });

  it('refetches a fresh roster when the bind form reopens, so a failed load recovers', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockRejectedValueOnce(new APIClientError('boom', 'ERR', 500));

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    expect(await screen.findByText(/boom/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    vi.mocked(apiClient.get).mockResolvedValueOnce(ROSTER);
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /workflow/i })).toBeEnabled());

    expect(screen.queryByText(/boom/i)).not.toBeInTheDocument();
    expect(apiClient.get).toHaveBeenCalledTimes(2);
  });

  it('threads a debounced ?q= search into the roster fetch', async () => {
    const user = userEvent.setup();
    vi.mocked(apiClient.get).mockResolvedValue(ROSTER);

    renderTab({ bindings: [] });
    await user.click(screen.getByRole('button', { name: /bind workflow/i }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: /workflow/i })).toBeEnabled());

    await user.type(screen.getByRole('searchbox', { name: /search workflows/i }), 'welc');

    await waitFor(() =>
      expect(apiClient.get).toHaveBeenCalledWith(
        '/api/v1/admin/orchestration/workflows?isActive=true&isTemplate=false&limit=100&q=welc'
      )
    );
  });
});
