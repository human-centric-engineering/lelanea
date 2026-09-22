import type { Metadata } from 'next';

import { UsagePanel } from '@/components/app/usage/usage-panel';
import { View } from '@/components/app/views/view';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';

/**
 * The tab carries the account menu's own words for this destination
 * (`ACCOUNT_MENU_LINKS`), which `shell-view-pages.test.ts` pins. "Billing" is
 * the owner's label for where this place is going, not a claim this page makes:
 * it says plainly that nothing is charged.
 */
export const metadata: Metadata = { title: 'Usage and billing' };

/**
 * What this month cost (f-budget t-94).
 *
 * ## It guards its own session
 *
 * `app/(lelanea)/app/layout.tsx` checks the session and the acknowledgement
 * gate, and a layout is **not** re-rendered when the router moves between
 * sibling pages inside it (`.context/app/shell.md`, "A view that reads about
 * the reader must guard itself"). This page reads one person's spend, so it
 * does what `notes/page.tsx` and `account/page.tsx` do and asks for the session
 * where it renders.
 *
 * ## The reading is the panel's
 *
 * A server component could fetch and hand the figures down. It is wrong here
 * for the same reason it is wrong on the notes page: the panel is where a
 * refresh would land, and rendering a server copy first would mean two readers
 * of one route disagreeing the moment a turn completes.
 *
 * ## What this page no longer says
 *
 * The placeholder it replaces said "Lelañea is not calling a model for you yet,
 * so there is nothing to meter" — untrue since §10 — and promised "a budget you
 * set", which belongs to the commercial phase and is not being built. Both are
 * gone rather than softened; a placeholder that has become false is worse than
 * one that is merely empty, because it is read as current.
 */
export default async function UsagePage() {
  const session = await getServerSession();
  if (!session) clearInvalidSession('/app/usage');

  return (
    <View
      column
      eyebrow="usage"
      title="What this month cost"
      lede="Every reply costs something to produce. This is what yours have come to, and what is left before Lelañea pauses until next month."
      note="Nothing is charged to you. The limit is ours, so the work stays sustainable while it is free."
    >
      <UsagePanel />
    </View>
  );
}
