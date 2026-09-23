import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { CrisisResourcesPanel } from '@/components/app/admin/crisis-resources';
import { CRISIS_RESOURCES_ENDPOINT } from '@/lib/app/safety/endpoint';
import type { CrisisAdminView } from '@/lib/app/safety/crisis-admin';

export const metadata: Metadata = {
  title: 'Crisis helplines',
  description: 'Who someone in danger is pointed to, by country, and whether it is signed off',
};

async function getView(): Promise<CrisisAdminView | null> {
  try {
    const response = await serverFetch(CRISIS_RESOURCES_ENDPOINT);
    if (!response.ok) return null;
    const parsed = await parseApiResponse<CrisisAdminView>(response);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The crisis resource, by region (f-safety t-63).
 *
 * Through the API rather than straight to Prisma — the platform's convention for
 * an admin page, and the API-first rule. `/admin/**` is the `admin` surface, so
 * this keeps Sunrise's admin chrome.
 */
export default async function CrisisResourcesPage() {
  const view = await getView();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Crisis helplines</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">
          What someone sees when what they write suggests they may be in danger: a few plain
          sentences, the helplines for their country, and an international directory. The country
          comes from their browser&rsquo;s language setting (en-GB → GB); anyone whose country is
          not listed here gets the directory and &ldquo;your local emergency number&rdquo;, never a
          guessed number.
        </p>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
          <strong>Every change goes back to draft</strong> until someone signs it off, and every
          change and sign-off is recorded in the audit log. Before signing off a region, check that
          each number still answers. <strong>What is stored here is the only copy.</strong> If it
          cannot be read when someone needs it, the turn fails and they are shown no helpline at
          all, so any warning on this page is urgent.
        </p>
      </div>

      {view === null ? (
        <p role="alert" className="text-destructive text-sm">
          The helplines did not load. Reload the page — if it keeps failing, the endpoint{' '}
          <code>{CRISIS_RESOURCES_ENDPOINT}</code> is the thing to check.
        </p>
      ) : (
        <CrisisResourcesPanel initialView={view} />
      )}
    </div>
  );
}
