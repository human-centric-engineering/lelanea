import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { CostOverview } from '@/components/app/admin/cost-view';
import { ADMIN_METERING_ENDPOINT } from '@/lib/app/agent/endpoint';
import { MAX_METER_GROUPS } from '@/lib/validations/app-metering';
import type {
  ConversationGroup,
  CostBreakdown,
  CostGroup,
  PersonGroup,
} from '@/lib/app/agent/cost-view';

export const metadata: Metadata = {
  title: 'Cost',
  description: 'Who and what is spending, this month',
};

/** One breakdown of this UTC month; null when it did not load, so the rest still stands. */
async function breakdown<G extends CostGroup>(
  by: string,
  limit?: number
): Promise<CostBreakdown<G> | null> {
  try {
    const response = await serverFetch(
      `${ADMIN_METERING_ENDPOINT}?by=${by}${limit ? `&limit=${limit}` : ''}`
    );
    if (!response.ok) return null;
    const parsed = await parseApiResponse<CostBreakdown<G>>(response);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * What this month cost, and who and what spent it (f-budget t-97).
 *
 * **Five reads, all lists, all at once** — by person, conversation, seat,
 * model and day. The API enriches each list in the same request (a person's
 * name and limit, a conversation's title and owner), so the page never fetches
 * per row; that is what the enrichment exists for. Each read fails on its own
 * and says so where its table would be, leaving the rest of the page standing.
 *
 * `/admin/**` is the `admin` surface, which the brand theme does not reach, and
 * the admin layout checks the role before this renders.
 */
export default async function CostAdminPage() {
  const [byUser, byConversation, bySeat, byModel, byDay] = await Promise.all([
    breakdown<PersonGroup>('user'),
    // As many as the API gives: the runaway flag measures against the median of
    // the conversations LISTED, and a list cut to the costliest 100 would make
    // the costliest typical (/code-review round 2).
    breakdown<ConversationGroup>('conversation', MAX_METER_GROUPS),
    breakdown('seat'),
    breakdown('model'),
    breakdown('day'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Cost</h2>
        <p className="text-muted-foreground text-sm">
          What this month has cost so far, in US dollars, and who and what spent it. Nothing is
          charged to anyone — this is what the work costs to run.
        </p>
      </div>
      <CostOverview
        byUser={byUser}
        byConversation={byConversation}
        bySeat={bySeat}
        byModel={byModel}
        byDay={byDay}
      />
    </div>
  );
}
