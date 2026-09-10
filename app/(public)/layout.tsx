import type { Metadata } from 'next';
import { SiteHeader } from '@/components/app/site/site-header';
import { SiteFooter } from '@/components/app/site/site-footer';
import { MaintenanceWrapper } from '@/components/maintenance-wrapper';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: {
    template: `%s - ${BRAND.name}`,
    default: BRAND.name,
  },
  // Was the starter blurb, hardcoded — which every fork shipped as the meta
  // description across its whole marketing surface. The root layout's
  // `BRAND.description` does NOT reach here: Next resolves metadata at the
  // nearest segment that defines a field, so a group declaring `description`
  // overrides the root outright. That is why #519's root-only fix was not
  // enough on its own.
  description: BRAND.description,
};

/**
 * Public Layout
 *
 * Layout for public pages. Includes the shared header with branding,
 * navigation, and user actions.
 *
 * Phase 3.5: Landing Page & Marketing
 * Phase 4.4: Added maintenance mode support
 *
 * ## Lelañea: the frame is the leaf's (t-5)
 *
 * The three swapped components are the ONLY change to this Sunrise-owned file,
 * kept to imports and two elements so the next upstream merge is a one-line
 * "keep mine" rather than a re-resolution.
 *
 * `AppHeader` + `PublicNav` + `PublicFooter` could not render this design
 * through their seams: `AppHeader` closes with `HeaderActions` (theme toggle
 * and user button, no props) and the design ends the bar with a "Join the
 * waitlist" action, while the footer's seams are two link lists and a
 * single-string attribution line with nowhere to put the "not a crisis service"
 * disclaimer. Both replacements are in `components/app/site/`.
 *
 * `SiteFooter` therefore owns the **Cookie Preferences** control that
 * `PublicFooter` used to guarantee — see CUSTOMIZATION.md §4 and the note on
 * `SiteFooter` itself. `lib/app/public-nav.ts` and `lib/app/footer.ts` are
 * consequently left at their defaults, and their `defaults.test.ts` rows still
 * pin them there.
 */
export default function PublicLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <MaintenanceWrapper>
      <div className="bg-background flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </div>
    </MaintenanceWrapper>
  );
}
