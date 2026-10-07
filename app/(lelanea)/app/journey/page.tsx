import type { Metadata } from 'next';

import { JOURNEY_LEDE, JourneyTimeline } from '@/components/app/journey/journey-timeline';
import { View } from '@/components/app/views/view';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';
import { getJourneyRecord } from '@/lib/app/journey-record/record';
import { journeyRecordQuerySchema, type JourneyRecordQuery } from '@/lib/app/journey-record/query';
import { getJourneyMap } from '@/lib/app/journey/map';
import { moduleLabel, whatIsNext } from '@/lib/app/journey/next';
import { logger } from '@/lib/logging';

/**
 * The tab carries the nav item's own words, so browser history can tell seven
 * destinations apart. Every page under `/app` does the same; the layout's
 * `%s` template does the rest.
 */
export const metadata: Metadata = { title: 'Your journey' };

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The page's search and filters, from its URL. A link with a value the route
 * would refuse lands on the whole record rather than an error page: the URL
 * is the person's, and a stale bookmark should still open.
 */
function readQuery(params: SearchParams): JourneyRecordQuery {
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const parsed = journeyRecordQuerySchema.safeParse({
    q: first('q'),
    module: first('module'),
    outcome: first('outcome'),
    kind: first('kind'),
  });
  // Drafts always: a waiting draft is shown at its session's stop.
  return parsed.success ? { ...parsed.data, drafts: true } : { drafts: true };
}

/**
 * The journey record: what each session was about, what the person wrote
 * themselves, and what is waiting for them to keep (f-journey-record t-148;
 * §3.16).
 *
 * ## It reads on the server, once
 *
 * The record and the map are read here, directly through the functions their
 * routes wrap (`GET /api/v1/app/journey-record`, `…/journey/map`), and handed
 * to the timeline whole. The record read is enriched with the notes its
 * entries list, so no stop fetches anything of its own. The search and filters
 * live in the URL, so narrowing re-renders this page, and every change the
 * timeline makes ends in `router.refresh()`, which re-reads it.
 *
 * Unlike the notes panel, nothing outside this page writes to the record while
 * it is open: drafts are written when a session closes, which is a new arrival,
 * not a turn on screen. So a server read is the only reader, and there is no
 * second copy to disagree with it.
 *
 * ## It guards its own session
 *
 * As `notes/page.tsx` and `account/page.tsx` do, and for the same reason: the
 * layout's check is not re-run when the router moves between sibling views,
 * and this page reads the person's own words.
 */
export default async function JourneyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getServerSession();
  if (!session) clearInvalidSession('/app/journey');

  const query = readQuery(await searchParams);
  const record = await getJourneyRecord(session.user.id, query);

  // The map decorates the record (module names, the signpost). Without it the
  // record still reads, with module slugs for names and no signpost.
  const map = await getJourneyMap(session.user.id).catch((error: unknown) => {
    logger.warn('Journey map unreadable on the journey view', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  const moduleLabels = Object.fromEntries(
    (map?.modules ?? []).map((module) => [module.slug, moduleLabel(module)])
  );

  return (
    <View column eyebrow="your journey" title="Where you have been" lede={JOURNEY_LEDE}>
      <JourneyTimeline
        record={record}
        query={query}
        next={whatIsNext(map)}
        moduleLabels={moduleLabels}
      />
    </View>
  );
}
