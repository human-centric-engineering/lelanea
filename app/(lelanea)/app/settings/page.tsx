import type { Metadata } from 'next';

import { SettingsView } from '@/components/app/views/settings-view';
import { View } from '@/components/app/views/view';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';
import { getLeanings } from '@/lib/app/voice/leanings-store';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings asks for the session itself, because it now reads the person's
 * leanings (f-leanings t-135).
 *
 * The layout's session check gates ENTRY to the shell, not each view: a layout
 * is not re-rendered when the router moves between siblings. While this page
 * read nothing about the reader it was rightly covered by that check; now it
 * renders their own settings, so it guards where it reads, as
 * `account/page.tsx` does.
 *
 * The read is the store's, not a fetch of the API: the page is on the server
 * already, and `GET /api/v1/app/leanings` serves the same view to anything else.
 */
export default async function ShellSettingsPage() {
  const session = await getServerSession();

  if (!session) {
    clearInvalidSession('/app/settings');
  }

  const leanings = await getLeanings(session.user.id);

  return (
    <View
      eyebrow="settings"
      title="How the replies speak to you"
      lede="Filters over Lelañea Fulton’s voice, not replacements for it."
      // Settings only, until a conversation can change a leaning (t-137); the
      // prototype's "or mid-conversation" comes back with it.
      note="Adjustable here, at any time."
    >
      <SettingsView leanings={leanings} />
    </View>
  );
}
