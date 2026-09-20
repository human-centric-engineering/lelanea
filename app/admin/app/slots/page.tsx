import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { SlotDefinitionsPanel } from '@/components/app/admin/slot-definitions';
import { SLOT_DEFINITIONS_ENDPOINT } from '@/lib/app/slots/endpoint';
import type { SlotTaxonomyAdminView } from '@/lib/app/slots/definitions-admin';

export const metadata: Metadata = {
  title: 'What she asks about',
  description: 'The slots the app tries to learn about a person, and every past version of each',
};

async function getView(): Promise<SlotTaxonomyAdminView | null> {
  try {
    const response = await serverFetch(SLOT_DEFINITIONS_ENDPOINT);
    if (!response.ok) return null;
    const parsed = await parseApiResponse<SlotTaxonomyAdminView>(response);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The slot taxonomy, edited (f-slots t-71).
 *
 * Through the API rather than straight to Prisma — the platform's convention for
 * an admin page, and the API-first rule. `/admin/**` is the `admin` surface, so
 * this keeps Sunrise's admin chrome.
 *
 * A failed load renders an alert naming the endpoint rather than the panel: the
 * panel's own empty state means "not seeded yet", and showing that for a failed
 * fetch would tell an operator to re-run a seed that has already run.
 */
export default async function SlotDefinitionsPage() {
  const view = await getView();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">What she asks about</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">
          Every slot here is something the app is trying to learn about a person — the wording is
          what the capture agent is actually given, so it reads as an instruction to her rather than
          as a label. Changing it takes effect on the next thing she writes; it does not change
          anything already learned.
        </p>
        <p className="text-muted-foreground mt-2 max-w-3xl text-sm">
          <strong>A slug is permanent and nothing here is ever deleted.</strong> Retiring a slot
          stops it being asked about and leaves every answer already given readable, under the
          wording it was captured under. Renaming is adding one and retiring the other. Every change
          is a new version with its own history, and is recorded in the audit log.
        </p>
      </div>

      {view === null ? (
        <p role="alert" className="text-destructive text-sm">
          The taxonomy did not load. Reload the page — if it keeps failing, the endpoint{' '}
          <code>{SLOT_DEFINITIONS_ENDPOINT}</code> is the thing to check.
        </p>
      ) : (
        <SlotDefinitionsPanel initialView={view} />
      )}
    </div>
  );
}
