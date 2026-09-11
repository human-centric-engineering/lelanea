import type { Metadata } from 'next';

import { AccountView } from '@/components/app/views/account-view';
import { View } from '@/components/app/views/view';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';

export const metadata: Metadata = { title: 'Your account' };

/**
 * The month and year an account was opened — "March 2026".
 *
 * Formatted on the SERVER, with the locale named rather than left to the
 * runtime. `toLocaleDateString()` with no locale reads the environment's, which
 * is the server's during SSR and the reader's after hydration: the same date
 * renders two different strings and React warns and re-renders. Naming it means
 * the two agree, and `en-GB` matches the rest of the product's copy.
 */
function formatJoined(joinedAt: Date): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' }).format(joinedAt);
}

/**
 * The first view under `/app` that carries anything about the reader.
 *
 * ## Why it asks for the session itself
 *
 * `app/(lelanea)/app/layout.tsx` checks the session, and a layout is NOT
 * re-rendered when the router moves between sibling pages inside it — so that
 * check gates entry to the shell rather than each view. While every page under
 * it was a static placeholder that was harmless, which is exactly what t-9
 * shipped and said so. This page is the one that changes it: it renders a name,
 * an address and a join date, so it guards where it reads rather than
 * inheriting a check that may have been made under a session that has since
 * been revoked.
 *
 * Raised by t-9's security review, below its reporting threshold at the time
 * and carried forward on the task record (`B28`) because it becomes live here.
 */
export default async function AccountPage() {
  const session = await getServerSession();

  if (!session) {
    clearInvalidSession('/app/account');
  }

  return (
    <View
      eyebrow="your account"
      // The account's own name is the title, the way the prototype has it. A
      // user can exist without one — an OAuth provider that returned none, an
      // invite accepted before the profile was filled in — and the email is
      // always there, so it stands in rather than leaving the page untitled.
      title={session.user.name?.trim() || session.user.email}
      lede="What Lelañea knows about you here, and where to change it."
    >
      <AccountView
        name={session.user.name?.trim() || session.user.email}
        email={session.user.email}
        joined={formatJoined(session.user.createdAt)}
      />
    </View>
  );
}
