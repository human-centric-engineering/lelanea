import type { Metadata } from 'next';

import { EntryBloom } from '@/components/app/shell/entry-bloom';
import { ShellNav } from '@/components/app/shell/shell-nav';
import { ShellRail } from '@/components/app/shell/shell-rail';
import { ShellTopbar } from '@/components/app/shell/shell-topbar';
import { MaintenanceWrapperWithAdminNotice } from '@/components/maintenance-wrapper';
import { clearInvalidSession } from '@/lib/auth/clear-session';
import { getServerSession } from '@/lib/auth/utils';
import { BRAND } from '@/lib/brand';

/**
 * The `default` is what a page WITHOUT its own title gets, and every page here
 * has one — so it is the fallback for a view added later that forgets, not the
 * usual case. It names the shell rather than any one destination, because a
 * page that forgot its title is exactly the one we cannot name.
 */
export const metadata: Metadata = {
  title: {
    template: `%s - ${BRAND.name}`,
    default: BRAND.name,
  },
  description: 'Your journey with Lelañea',
};

/**
 * The shell: four columns, full height, and nothing scrolls but the panes.
 *
 * ## Why this is its own route group
 *
 * `app/(protected)/layout.tsx` is a header over a single `container mx-auto`
 * main — a centred document column. The product is the opposite shape, so it
 * takes its own group rather than bending that one. `/profile` and `/settings`
 * stay behind the platform frame on purpose and the account view links to them.
 *
 * ## Maintenance mode
 *
 * `MaintenanceWrapperWithAdminNotice`, matching `(protected)`. Both existing
 * layouts wrap their children in a maintenance wrapper, and a new route group
 * that skipped it would silently take the entire product out of maintenance
 * mode — invisibly, until someone switched maintenance on and found the app
 * still serving. Owner ruling, 10 September 2026.
 *
 * ## The session
 *
 * `lib/app/protected-routes.ts` lists `/app`, so the proxy has already bounced a
 * signed-out visitor before this renders. `clearInvalidSession` covers the
 * narrower case the edge cannot: a cookie that survives the proxy but no longer
 * resolves to a user. Reading it here rather than per-page means the account
 * footer is server-rendered with the real name on first paint.
 *
 * KNOWN LIMITATION: the `'/app'` passed to `clearInvalidSession` is hardcoded,
 * so a visitor who opens `/app/journey` with a cookie that no longer resolves
 * loses the deep link and lands at `/app` after signing back in. The proxy's own
 * path preserves `callbackUrl`; this one cannot, because a layout has no access
 * to the pathname and nothing upstream puts it on a header. Left as is rather
 * than diverging `proxy.ts` to add one for a case that costs a redirect and
 * never a session.
 *
 * A layout is also not re-rendered when the router moves between sibling pages
 * inside it, so this check is a gate on entry rather than on every view. That is
 * fine while the pages under it hold no data — but `t-10` and `t-11` add views
 * that do, and those should guard where they fetch rather than inherit this.
 *
 * ## `h-dvh`, not `h-screen`
 *
 * `100vh` on mobile Safari is the viewport *without* the browser chrome
 * subtracted, so a `h-screen` shell is taller than the window and the rail's
 * last item sits under the address bar. `100dvh` is what the prototype uses.
 *
 * The pane column carries `overflow-y-auto` for the same reason `ShellNav`
 * does: nothing scrolls inside `h-dvh overflow-hidden` unless something is told
 * to. Without it, anything taller than the viewport is clipped with no way to
 * reach it — and the case that matters is `error.tsx`, whose `ErrorCard`
 * defaults to `min-h-[400px]`, so on a short window the "Try again" button
 * disappeared and the browser's back button became the only exit from a broken
 * view.
 */
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession();

  if (!session) {
    clearInvalidSession('/app');
  }

  return (
    <MaintenanceWrapperWithAdminNotice>
      <div className="bg-background relative flex h-dvh overflow-hidden">
        <ShellNav
          user={{
            // A user can exist without a name — an OAuth provider that returned
            // none, or an invite accepted before the profile was filled in. The
            // email is always there, and `initialsFor` falls back to it too.
            name: session.user.name?.trim() || session.user.email,
            email: session.user.email,
          }}
        />
        <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto">
          <ShellTopbar />
          {children}
        </div>
        <ShellRail />
        <EntryBloom />
      </div>
    </MaintenanceWrapperWithAdminNotice>
  );
}
