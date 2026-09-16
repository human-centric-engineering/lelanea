import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { VoiceComparisonBoard } from '@/components/app/admin/voice-comparison';
import { VOICE_COMPARISON_ENDPOINT } from '@/lib/app/voice/endpoint';
import type { VoiceComparisonSummary } from '@/lib/app/voice/comparison-admin';

export const metadata: Metadata = {
  title: 'How she sounds',
  description: 'Her voice against a bare model, over the same fixed questions',
};

/**
 * The comparison list, server-rendered.
 *
 * Through the API rather than straight to Prisma, which is the platform's
 * convention for an admin page and is the API-first rule in `CLAUDE.md`: every
 * capability has to be reachable over HTTP, and a page that queried the database
 * directly would be the one caller that proved nothing about the route.
 *
 * A failed fetch renders the board empty rather than throwing, and passes the
 * flag down so it drops its empty-state CLAIM — "nothing has been run yet" under
 * an error banner is a statement the page has no basis for (`HB9`).
 */
async function getComparisons(): Promise<{
  comparisons: VoiceComparisonSummary[];
  loadError: boolean;
}> {
  try {
    const response = await serverFetch(VOICE_COMPARISON_ENDPOINT);
    if (!response.ok) return { comparisons: [], loadError: true };

    const parsed = await parseApiResponse<VoiceComparisonSummary[]>(response);
    if (!parsed.success) return { comparisons: [], loadError: true };

    return { comparisons: parsed.data, loadError: false };
  } catch {
    return { comparisons: [], loadError: true };
  }
}

/**
 * Nothing about how she sounds changes without her hearing it first (§05 t-28).
 *
 * A voice fingerprint is tuned by editing prose, and prose edits have no
 * compiler: a clause changed in her core to fix one awkward reply can quietly
 * make three others worse, with nothing failing and nothing logged. This page is
 * where that becomes audible — the same fixed questions through her assembled
 * prompt and through a model carrying no fingerprint, side by side.
 *
 * `/admin/**` is the `admin` surface (`lib/app/surface.ts`), which the brand
 * theme deliberately does not reach — so this page keeps Sunrise's admin chrome
 * and carries no Lelañea styling of its own.
 */
export default async function VoiceComparisonPage() {
  const { comparisons, loadError } = await getComparisons();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">How she sounds</h2>
        <p className="text-muted-foreground text-sm">
          A fixed set of questions, asked twice: once through her own assembled prompt, once through
          a model told nothing about her. Running only the first would tell you an answer came back;
          running both tells you whether her voice did anything. Each answer stays attached to the
          version of her core that produced it, so a change made next month can be read against this
          one rather than replacing it.
        </p>
      </div>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          The comparisons did not load. Reload the page — if it keeps failing, the comparisons
          endpoint is the thing to check, not the board.
        </p>
      )}

      <VoiceComparisonBoard initialComparisons={comparisons} initialLoadFailed={loadError} />
    </div>
  );
}
