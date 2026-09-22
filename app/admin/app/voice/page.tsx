import type { Metadata } from 'next';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { VoiceComparisonBoard } from '@/components/app/admin/voice-comparison';
import { GoldenSetDialog } from '@/components/app/admin/golden-set-dialog';
import { getGoldenSetAdminView } from '@/lib/app/voice/golden-set-admin';
import { VOICE_COMPARISON_ENDPOINT, VOICE_PREFLIGHT_ENDPOINT } from '@/lib/app/voice/endpoint';
import type { VoicePreflight } from '@/lib/app/voice/preflight';
import type { VoiceComparisonSummary } from '@/lib/app/voice/comparison-admin';

export const metadata: Metadata = {
  title: 'Voice',
  description: 'The assembled voice against a plain model, over the same fixed questions',
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
 * What a run would use and roughly cost.
 *
 * Null on any failure rather than thrown. The comparisons are the page; the
 * estimate is a line above the button, and taking the page down because a model
 * had no published rate would trade the whole surface for a nicety.
 */
async function getPreflight(): Promise<VoicePreflight | null> {
  try {
    const response = await serverFetch(VOICE_PREFLIGHT_ENDPOINT);
    if (!response.ok) return null;

    const parsed = await parseApiResponse<VoicePreflight>(response);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * No change to the voice ships without being read against the previous one (§05 t-28).
 *
 * A voice fingerprint is tuned by editing prose, and prose edits have no
 * compiler: a clause changed in the core to fix one awkward reply can quietly
 * make three others worse, with nothing failing and nothing logged. This page is
 * where that becomes visible — the same fixed questions through the assembled
 * prompt and through a model carrying no fingerprint, side by side.
 *
 * `/admin/**` is the `admin` surface (`lib/app/surface.ts`), which the brand
 * theme deliberately does not reach — so this page keeps Sunrise's admin chrome
 * and carries no Lelañea styling of its own.
 */
export default async function VoiceComparisonPage() {
  const [{ comparisons, loadError }, preflight] = await Promise.all([
    getComparisons(),
    getPreflight(),
  ]);

  return (
    <div className="space-y-8">
      {/* The title, why the page exists, and the one link out of it. The set
          itself is a dialog rather than a section: an arriving admin is here to
          run the test, and the questions are what they check before or after —
          not something to scroll past on the way to the button. */}
      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4 border-b pb-6">
        <div className="max-w-2xl space-y-2">
          <h2 className="text-lg font-semibold tracking-tight">Voice</h2>
          <p className="text-sm leading-relaxed">
            The voice is tuned by editing prose, and prose has no compiler: an edit that fixes one
            reply can quietly spoil three others.
          </p>
          <p className="text-muted-foreground text-sm leading-relaxed">
            Running the voice test asks a fixed set of questions twice — once through the agent with
            the voice prompt applied, once through a plain model given no voice instructions. The
            second column is the control: without it you can see that an answer came back, but not
            whether the voice prompt caused any of it. Every run is kept, so a later one can be read
            against this one instead of replacing it.
          </p>
        </div>
        <div className="shrink-0">
          <GoldenSetDialog goldenSet={await getGoldenSetAdminView()} />
        </div>
      </header>

      {loadError && (
        <p role="alert" className="text-destructive text-sm">
          The comparisons did not load. Reload the page — if it keeps failing, the comparisons
          endpoint is the thing to check, not the board.
        </p>
      )}

      <VoiceComparisonBoard
        initialComparisons={comparisons}
        initialLoadFailed={loadError}
        preflight={preflight}
      />
    </div>
  );
}
