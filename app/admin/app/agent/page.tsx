import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { AgentSettingsPanel } from '@/components/app/admin/agent-settings';
import { AGENT_SETTINGS_ENDPOINT, USER_BUDGETS_ENDPOINT } from '@/lib/app/agent/endpoint';
import { USER_BUDGET_PAGE_SIZE } from '@/lib/validations/app-agent-settings';
import { parsePaginationMeta } from '@/lib/validations/common';
import type { AgentSettings, UserBudgetRow } from '@/lib/app/agent/settings';
import type { PaginationMeta } from '@/types/api';

export const metadata: Metadata = {
  title: 'Deadlines & budgets',
  description: 'How long she may take to answer, and what each person may spend a month',
};

const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: USER_BUDGET_PAGE_SIZE,
  total: 0,
  totalPages: 0,
};

async function getSettings(): Promise<AgentSettings | null> {
  try {
    const response = await serverFetch(AGENT_SETTINGS_ENDPOINT);
    if (!response.ok) return null;
    const parsed = await parseApiResponse<{ settings: AgentSettings }>(response);
    return parsed.success ? parsed.data.settings : null;
  } catch {
    return null;
  }
}

async function getFirstPage(): Promise<{
  users: UserBudgetRow[];
  meta: PaginationMeta;
  loadError: boolean;
}> {
  try {
    const response = await serverFetch(
      `${USER_BUDGETS_ENDPOINT}?page=1&limit=${USER_BUDGET_PAGE_SIZE}`
    );
    if (!response.ok) return { users: [], meta: EMPTY_META, loadError: true };
    const parsed = await parseApiResponse<UserBudgetRow[]>(response);
    if (!parsed.success) return { users: [], meta: EMPTY_META, loadError: true };
    return {
      users: parsed.data,
      meta: parsePaginationMeta(parsed.meta) ?? {
        ...EMPTY_META,
        total: parsed.data.length,
        totalPages: 1,
      },
      loadError: false,
    };
  } catch {
    return { users: [], meta: EMPTY_META, loadError: true };
  }
}

/**
 * The agent's deadlines and the monthly spending limits (§08 t-53).
 *
 * Through the API rather than straight to Prisma — the platform's convention for
 * an admin page, and the API-first rule: a page that queried the database
 * directly would be the one caller that proved nothing about the routes.
 *
 * `/admin/**` is the `admin` surface, which the brand theme does not reach, so
 * this keeps Sunrise's admin chrome.
 */
export default async function AgentSettingsPage() {
  const [settings, { users, meta, loadError }] = await Promise.all([getSettings(), getFirstPage()]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Deadlines &amp; budgets</h2>
        <p className="text-muted-foreground text-sm">
          How long she may take to answer, and what each person may spend on the model in a month.
          These are stored here so they can change as real use shows what they should be.{' '}
          <strong>Nothing enforces them yet</strong> — the deadlines take effect when honest failure
          lands, and the limits when the safety and budget features do.
        </p>
      </div>

      {settings === null && (
        <p role="alert" className="text-destructive text-sm">
          The settings did not load. Reload the page — if it keeps failing, the settings endpoint is
          the thing to check.
        </p>
      )}

      <AgentSettingsPanel
        initialSettings={settings}
        initialUsers={users}
        initialMeta={meta}
        initialLoadFailed={loadError}
      />
    </div>
  );
}
