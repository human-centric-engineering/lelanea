import type { Metadata } from 'next';

import { NotesPanel } from '@/components/app/notes/notes-panel';
import { View } from '@/components/app/views/view';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';

/** The tab carries the nav item's own words; the layout's `%s` template does the rest. */
export const metadata: Metadata = { title: 'Lelañea’s notes' };

/**
 * What Lelañea has written down about you (f-slots t-73).
 *
 * ## It guards its own session, and it is the reason the rule exists
 *
 * `app/(lelanea)/app/layout.tsx` checks the session and the acknowledgement
 * gate, and a layout is **not** re-rendered when the router moves between
 * sibling pages inside it — so those gate entry to the shell, not each view
 * (`.context/app/shell.md`, "A view that reads about the reader must guard
 * itself"). Nothing under `/app` reads anything more personal than this page
 * does, so it does what the account view does and asks for the session where it
 * renders.
 *
 * ## The reading itself is the panel's, not this page's
 *
 * A server component could fetch the notes and hand them down, which is the
 * shape `account/page.tsx` uses. It is wrong here: this surface re-reads itself
 * when a turn writes and again after a correction, so the fetch has to live
 * where those happen. Rendering a server copy first would mean two readers of
 * one route, disagreeing the moment the first note lands.
 */
export default async function NotesPage() {
  const session = await getServerSession();
  if (!session) clearInvalidSession('/app/notes');

  return (
    <View
      eyebrow="lelañea’s notes"
      title="What Lelañea has written down about you"
      lede="Everything Lelañea holds about you, where each of it came from, and how certain it is."
      note="These are Lelañea’s readings, not your words back. She can be wrong, and nothing here is fixed: correct one and both versions are kept, or ask Lelañea about it and take it up in the conversation."
    >
      <NotesPanel />
    </View>
  );
}
