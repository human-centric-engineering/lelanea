// @vitest-environment happy-dom
/**
 * The agent settings admin surface (§08 t-53).
 *
 * What a person looking at it would notice going wrong: an invalid pair sent
 * anyway, seconds sent as milliseconds (or the reverse), a row not updating
 * after its limit is set, a cleared limit that set zero instead of deleting, and
 * rows on the default showing a stale figure after the default moves.
 *
 * @see components/app/admin/agent-settings.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentSettingsPanel, checkSettings } from '@/components/app/admin/agent-settings';
import {
  AGENT_SETTINGS_ENDPOINT,
  USER_BUDGETS_ENDPOINT,
  userBudgetEndpoint,
} from '@/lib/app/agent/endpoint';
import type { UserBudgetRow } from '@/lib/app/agent/settings';

const SETTINGS = {
  firstWordsDeadlineMs: 8000,
  turnDeadlineMs: 60000,
  defaultMonthlyCeilingUsd: 5,
  updatedAt: '2026-09-18T12:00:00.000Z',
};

const ADA: UserBudgetRow = {
  userId: 'cmtu71ttv0000ch5n72hhqhtu',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'USER',
  overrideUsd: null,
  effectiveCeilingUsd: 5,
};

const META = { page: 1, limit: 25, total: 1, totalPages: 1 };

const fetchMock = vi.fn();

function ok(data: unknown, meta?: unknown) {
  return new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function renderPanel(users: UserBudgetRow[] = [ADA], loadFailed = false) {
  return render(
    <AgentSettingsPanel
      initialSettings={SETTINGS}
      initialUsers={users}
      initialMeta={META}
      initialLoadFailed={loadFailed}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('checkSettings — the browser’s copy of the three refusals', () => {
  it('passes the ruled defaults', () => {
    expect(checkSettings(8000, 60000, 5)).toBeNull();
  });

  it('refuses a non-positive deadline, an inverted pair and a negative ceiling', () => {
    expect(checkSettings(0, 60000, 5)).toMatch(/longer than zero/);
    expect(checkSettings(60000, 60000, 5)).toMatch(/shorter than the whole turn/);
    expect(checkSettings(8000, 60000, -1)).toMatch(/negative/);
    expect(checkSettings(null, 60000, 5)).toMatch(/needs a number/);
  });
});

describe('the settings form', () => {
  it('shows the stored values in seconds and dollars', () => {
    renderPanel();
    expect(screen.getByLabelText('First words within (s)')).toHaveValue(8);
    expect(screen.getByLabelText('Whole turn within (s)')).toHaveValue(60);
    expect(screen.getByLabelText('Monthly limit ($)')).toHaveValue(5);
  });

  it('refuses an inverted pair without sending anything', async () => {
    const user = userEvent.setup();
    renderPanel();

    const firstWords = screen.getByLabelText('First words within (s)');
    await user.clear(firstWords);
    await user.type(firstWords, '90');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(screen.getByRole('alert')).toHaveTextContent(/shorter than the whole turn/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends milliseconds, then re-reads the list so default rows show the new default', async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === AGENT_SETTINGS_ENDPOINT && init?.method === 'PUT') {
        return ok({
          settings: { ...SETTINGS, firstWordsDeadlineMs: 7500, defaultMonthlyCeilingUsd: 2 },
        });
      }
      if (url.startsWith(USER_BUDGETS_ENDPOINT)) {
        return ok([{ ...ADA, effectiveCeilingUsd: 2 }], META);
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    renderPanel();

    const firstWords = screen.getByLabelText('First words within (s)');
    await user.clear(firstWords);
    await user.type(firstWords, '7.5');
    const ceiling = screen.getByLabelText('Monthly limit ($)');
    await user.clear(ceiling);
    await user.type(ceiling, '2');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Saved.'));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === AGENT_SETTINGS_ENDPOINT)!;
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      firstWordsDeadlineMs: 7500,
      turnDeadlineMs: 60000,
      defaultMonthlyCeilingUsd: 2,
    });

    await waitFor(() => expect(screen.getByText('$2.00')).toBeInTheDocument());
  });

  it('shows the route’s field message when the server refuses', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request body',
            details: {
              errors: [{ path: 'turnDeadlineMs', message: 'Too long, says the server.' }],
            },
          },
        }),
        { status: 400, headers: { 'content-type': 'application/json' } }
      )
    );
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Too long, says the server.')
    );
  });
});

describe('a person’s own limit', () => {
  it('sets it and updates the row from the response', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      ok({ budget: { ...ADA, overrideUsd: 12.5, effectiveCeilingUsd: 12.5 } })
    );
    renderPanel();

    const row = screen.getByText('ada@example.com').closest('tr')!;
    await user.type(within(row).getByLabelText('Monthly limit for Ada'), '12.5');
    await user.click(within(row).getByRole('button', { name: 'Set' }));

    await waitFor(() => expect(within(row).getByText('$12.50')).toBeInTheDocument());
    expect(within(row).getByText('own')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(userBudgetEndpoint(ADA.userId));
    expect((init as RequestInit).method).toBe('PUT');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ monthlyCeilingUsd: 12.5 });
  });

  it('clears it with a DELETE — never a PUT of zero', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok({ budget: ADA, cleared: true }));
    renderPanel([{ ...ADA, overrideUsd: 12.5, effectiveCeilingUsd: 12.5 }]);

    const row = screen.getByText('ada@example.com').closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(within(row).getByText('default')).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(userBudgetEndpoint(ADA.userId));
    expect((init as RequestInit).method).toBe('DELETE');
    expect((init as RequestInit).body).toBeUndefined();
  });

  it('refuses a negative limit without sending', async () => {
    const user = userEvent.setup();
    renderPanel();
    const row = screen.getByText('ada@example.com').closest('tr')!;
    await user.type(within(row).getByLabelText('Monthly limit for Ada'), '-3');
    await user.click(within(row).getByRole('button', { name: 'Set' }));
    expect(within(row).getByRole('alert')).toHaveTextContent(/negative/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the list', () => {
  it('does not claim "no accounts" when the load failed', () => {
    renderPanel([], true);
    expect(screen.getByRole('alert')).toHaveTextContent(/did not load/);
    expect(screen.queryByText('No accounts match.')).not.toBeInTheDocument();
  });

  it('asks the one list endpoint for the filtered view', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(ok([], { ...META, total: 0, totalPages: 0 }));
    renderPanel();

    await user.click(screen.getByLabelText('Only people with their own limit'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url] = fetchMock.mock.calls.at(-1)!;
    expect(String(url)).toContain(`${USER_BUDGETS_ENDPOINT}?`);
    expect(String(url)).toContain('overriddenOnly=true');
    await waitFor(() => expect(screen.getByText(/Nobody has their own limit/)).toBeInTheDocument());
  });
});
