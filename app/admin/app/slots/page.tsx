import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { SlotDefinitionsPanel } from '@/components/app/admin/slot-definitions';
import { SLOT_DEFINITIONS_ENDPOINT } from '@/lib/app/slots/endpoint';
import type { SlotTaxonomyAdminView } from '@/lib/app/slots/definitions-admin';

export const metadata: Metadata = {
  title: 'What the AI asks about',
  description:
    'The data slots the AI tries to fill in about a person, and every past version of each',
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
      {/*
        One line. An earlier version opened with two paragraphs restating the
        slug rule, the retirement rule and the versioning rule — all three of
        which the surface below already says at the point they apply, on the
        disabled slug field, on the Retire button and in the history view.
        Saying them here as well pushed the actual taxonomy off the screen.
      */}
      <div>
        <h2 className="text-lg font-semibold">What the AI asks about</h2>
        <p className="text-muted-foreground max-w-3xl text-sm">
          The data slots the AI tries to fill in about a person. Slugs are permanent and nothing
          here is deleted: retiring one stops it being asked about and leaves the answers already
          given readable.
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
