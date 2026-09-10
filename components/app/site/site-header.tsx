'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { Button } from '@/components/app/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
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
 * @see .context/app/planning/design/lelanea.html — `header.site-nav`
 */
export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className={styles.nav}>
      {/* The mark is decorative (`aria-hidden` inside `LotusMark`), so the LINK
          carries the accessible name — one component, one a11y job. */}
      <Link href="/" className={styles.wordmark} aria-label="Lelañea, home">
        <LotusMark size={30} water={false} />
        <span className={styles.wordmarkText}>Lelañea</span>
      </Link>

      <span className={styles.spacer} />

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

      <Link href="/login" className={styles.navLogin}>
        Log in
      </Link>

      <span className={styles.themeSlot}>
        <ThemeToggle />
      </span>

      <Button asChild size="sm" className={styles.cta}>
        <Link href={`/#${WAITLIST_ANCHOR}`}>Join the waitlist</Link>
      </Button>
    </header>
  );
}
