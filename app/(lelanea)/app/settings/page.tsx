import type { Metadata } from 'next';

import { SettingsView } from '@/components/app/views/settings-view';
import { View } from '@/components/app/views/view';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings holds no session data, so it does not guard.
 *
 * That is the distinction the layout's own note draws and it is worth stating
 * at the page rather than only there: a layout is not re-rendered when the
 * router moves between siblings, so its session check gates ENTRY to the shell
 * and nothing else. A page that reads nothing about the reader is correctly
 * covered by it. `account/page.tsx` reads three facts about them and therefore
 * asks for the session itself.
 */
export default function ShellSettingsPage() {
  return (
    <View
      eyebrow="settings"
      title="How she speaks to you"
      lede="Filters over her voice, not replacements for it."
      note="Adjustable here, or mid-conversation — “that was too much, be plainer with me” works as a sentence."
    >
      <SettingsView />
    </View>
  );
}
