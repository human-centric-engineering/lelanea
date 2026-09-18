// @vitest-environment happy-dom

/**
 * /admin/app/agent — what the page fetches and hands to the panel (§08 t-53).
 *
 * Through the API (settings and the first page of the budget list), and a
 * failed load is passed down as a flag rather than an empty list the table
 * would present as "no accounts".
 *
 * @see app/admin/app/agent/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

vi.mock('@/components/app/admin/agent-settings', () => ({
  AgentSettingsPanel: (props: Record<string, unknown>) => (
    <div data-testid="panel" data-props={JSON.stringify(props)} />
  ),
}));

import AgentSettingsPage from '@/app/admin/app/agent/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { AGENT_SETTINGS_ENDPOINT, USER_BUDGETS_ENDPOINT } from '@/lib/app/agent/endpoint';

const SETTINGS = {
  firstWordsDeadlineMs: 8000,
  turnDeadlineMs: 60000,
  defaultMonthlyCeilingUsd: 5,
  updatedAt: '2026-09-18T12:00:00.000Z',
};
const ROW = {
  userId: 'cmtu71ttv0000ch5n72hhqhtu',
  name: 'Ada',
  email: 'ada@example.com',
  role: 'USER',
  overrideUsd: null,
  effectiveCeilingUsd: 5,
};
const META = { page: 1, limit: 25, total: 1, totalPages: 1 };

function panelProps(): Record<string, unknown> {
  return JSON.parse(screen.getByTestId('panel').getAttribute('data-props') ?? '{}') as Record<
    string,
    unknown
  >;
}

/** Answer each endpoint the page asks for. */
function answer(settingsOk: boolean, listOk: boolean) {
  vi.mocked(serverFetch).mockImplementation(async (url: string) => {
    const ok = url === AGENT_SETTINGS_ENDPOINT ? settingsOk : listOk;
    return { ok, url } as Response;
  });
  vi.mocked(parseApiResponse).mockImplementation((async (response: Response) =>
    response.url === AGENT_SETTINGS_ENDPOINT
      ? { success: true, data: { settings: SETTINGS } }
      : { success: true, data: [ROW], meta: META }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgentSettingsPage', () => {
  it('reads both through the API and hands them to the panel', async () => {
    answer(true, true);
    render(await AgentSettingsPage());

    expect(serverFetch).toHaveBeenCalledWith(AGENT_SETTINGS_ENDPOINT);
    expect(serverFetch).toHaveBeenCalledWith(`${USER_BUDGETS_ENDPOINT}?page=1&limit=25`);
    expect(panelProps()).toEqual({
      initialSettings: SETTINGS,
      initialUsers: [ROW],
      initialMeta: META,
      initialLoadFailed: false,
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(/Nothing enforces them yet/)).toBeInTheDocument();
  });

  it('says the settings did not load, and passes null rather than defaults', async () => {
    answer(false, true);
    render(await AgentSettingsPage());

    expect(screen.getByRole('alert')).toHaveTextContent(/settings did not load/);
    expect(panelProps().initialSettings).toBeNull();
  });

  it('flags a failed list instead of passing an empty one as the answer', async () => {
    answer(true, false);
    render(await AgentSettingsPage());

    expect(panelProps()).toMatchObject({ initialUsers: [], initialLoadFailed: true });
  });

  it('treats a thrown fetch as a failed load, for both', async () => {
    vi.mocked(serverFetch).mockRejectedValue(new Error('down'));
    render(await AgentSettingsPage());

    expect(panelProps()).toMatchObject({
      initialSettings: null,
      initialUsers: [],
      initialLoadFailed: true,
    });
  });

  it('treats an error envelope as a failed load, for both', async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'boom' },
    } as never);
    render(await AgentSettingsPage());

    expect(panelProps()).toMatchObject({ initialSettings: null, initialLoadFailed: true });
  });

  it('derives paging from the rows when the list carries no meta', async () => {
    vi.mocked(serverFetch).mockImplementation(
      async (url: string) => ({ ok: true, url }) as Response
    );
    vi.mocked(parseApiResponse).mockImplementation((async (response: Response) =>
      response.url === AGENT_SETTINGS_ENDPOINT
        ? { success: true, data: { settings: SETTINGS } }
        : { success: true, data: [ROW] }) as never);
    render(await AgentSettingsPage());

    expect(panelProps().initialMeta).toEqual({ page: 1, limit: 25, total: 1, totalPages: 1 });
  });
});
