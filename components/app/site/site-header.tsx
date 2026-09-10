'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { Button } from '@/components/app/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserButton } from '@/components/auth/user-button';
import { useSession } from '@/lib/auth/client';
import { BRAND } from '@/lib/brand';
import { SITE_NAV, WAITLIST_ANCHOR } from '@/lib/site/config';
import styles from '@/components/app/site/site.module.css';

/**
 * The public site's header.
 *
 * ## Why this is ours rather than the platform's
 *
 * `AppHeader` takes a logo slot and a navigation slot and then renders
 * `HeaderActions` — `ThemeToggle` plus `UserButton`, with no props. The
 * prototype's bar carries a **"Join the waitlist" primary button** as its last
 * element, and there is no seam that reaches that position: `publicNavItems`
 * governs a list of links, not an action. Filling the seam would have produced
 * a header without the one control the page exists to offer.
 *
 * So `app/(public)/layout.tsx` renders this instead. The theme toggle is still
 * the platform's component, unchanged — the part that had a seam uses it.
 *
 * ## The CTA routes home first, and that is the whole mechanism
 *
 * `href="/#waitlist-form"` is a route plus a fragment, so from `/mission` it
 * navigates home and lands on the form, and from `/` it just scrolls. A bare
 * `#waitlist-form` would silently do nothing on every page except the home
 * page, which is exactly the defect the test pins.
 *
 * The sticky bar would otherwise cover what it scrolled to; `scroll-margin-top`
 * on the form itself is what keeps the heading clear of it.
 *
 * ## A signed-in visitor keeps their user menu
 *
 * `AppHeader` closed with `HeaderActions` — `ThemeToggle` AND `UserButton` —
 * and the first version of this bar replaced that pair with the toggle plus a
 * static "Log in" link, because that is what the design shows. The design has
 * no auth state to show, so it could not have raised the question.
 *
 * The consequence was concrete: a signed-in member clicking the wordmark from
 * `/dashboard` landed here and was told to log in, with no avatar, no way to
 * sign out, and no route back into the app from ANY public page. `UserButton`'s
 * own sign-out handler redirects to `/`, so it deposited every user on exactly
 * the page that had lost the menu.
 *
 * So the design's plain "Log in" link is kept for the visitor the page is
 * written for — a stranger, who should not meet an avatar icon — and
 * `UserButton` renders in its place once there is a session. `isPending` shows
 * the link rather than a skeleton: it is a link, not an action, so the
 * worst case is a moment of offering the way in to someone already in, and
 * this is the marketing surface where signed-out is overwhelmingly the norm.
 *
 * ## The wordmark comes from the brand seam
 *
 * Both the visible text and the link's accessible name read `BRAND.name`, for
 * the reason the footer's legal line gives: a literal here would be a second
 * place to change the product's name from, and the one nobody would think to
 * look at. Pinned in `site-brand.test.tsx`.
 *
 * @see .context/app/planning/design/lelanea.html — `header.site-nav`
 */
export function SiteHeader() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <header className={styles.nav}>
      {/* The mark is decorative (`aria-hidden` inside `LotusMark`), so the LINK
          carries the accessible name — one component, one a11y job. */}
      <Link href="/" className={styles.wordmark} aria-label={`${BRAND.name}, home`}>
        <LotusMark size={30} water={false} />
        <span className={styles.wordmarkText}>{BRAND.name}</span>
      </Link>

      <span className={styles.spacer} />

      {/* A real landmark. `PublicNav` wrapped these in a `<nav>`; the first
          version of this bar put the links straight into the `<header>`, which
          left the site with a footer navigation landmark and no primary one —
          a screen-reader user browsing by landmark could reach the footer nav
          and not this. Labelled, because there are two navs on the page. */}
      <nav className={styles.navlinks} aria-label="Main">
        {SITE_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={styles.navlink}
            aria-current={pathname === item.href ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {session ? (
        <span className={styles.userSlot}>
          <UserButton />
        </span>
      ) : (
        <Link href="/login" className={styles.navLogin}>
          Log in
        </Link>
      )}

      <span className={styles.themeSlot}>
        <ThemeToggle />
      </span>

      <Button asChild size="sm" className={styles.cta}>
        <Link href={`/#${WAITLIST_ANCHOR}`}>Join the waitlist</Link>
      </Button>
    </header>
  );
}
