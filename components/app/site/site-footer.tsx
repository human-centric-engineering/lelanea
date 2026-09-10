'use client';

import Link from 'next/link';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { useConsent } from '@/lib/consent';
import { BRAND } from '@/lib/brand';
import { SITE_DOMAIN, SITE_LINKS, SITE_NAV } from '@/lib/site/config';
import styles from '@/components/app/site/site.module.css';

/**
 * The public site's footer.
 *
 * ## We own the Cookie Preferences control now, and that is not optional
 *
 * The platform's `PublicFooter` renders that button unconditionally and says
 * why in place: consent is a legal requirement in many jurisdictions, not a
 * branding choice, so it is the one thing `lib/app/public-nav.ts` deliberately
 * cannot switch off. CUSTOMIZATION.md §4 states the consequence for a fork that
 * supplies its own footer frame instead — it has to render a real one of its
 * own. This is that one. Removing it does not fail a type-check and does not
 * fail a snapshot; it fails an audit, months later.
 *
 * ## Why this is ours rather than the platform's
 *
 * The prototype's footer carries the disclaimer paragraph — "not a medical
 * application… not a crisis service" — between the links and the legal line.
 * The seams available are two link lists and `footerCopyright`, a single
 * attribution string. There is no paragraph slot, and the disclaimer is the
 * reason the footer exists at all.
 *
 * ## The copyright holder is the seam's, not the prototype's
 *
 * The prototype prints "© [YEAR] Lelañea Fulton". `lib/app/leaf-brand.ts` sets
 * `leafBrandLegalName` to "All Too Human Ltd" with the reasoning recorded in
 * place: the product is Lelañea, the legal entity behind it is not, and this is
 * a legal-attribution surface. The seam is newer than the prototype and is the
 * one that was decided deliberately, so it wins.
 *
 * The line carries BOTH names on purpose, which is why this footer is not in
 * `tests/unit/brand-fork-surfaces.test.tsx`'s footer table: that table asserts a
 * copyright line contains the legal entity and NOT the product, and the design
 * puts the trademark on the same line. Its wiring is pinned in
 * `site-footer-brand.test.tsx` instead, with the same hoisted-mock technique.
 *
 * @see .context/app/planning/design/lelanea.html — `footer.site-foot`
 */
export function SiteFooter() {
  const { openPreferences } = useConsent();
  const year = new Date().getFullYear();

  // D3: nothing rather than a dead link. A destination with no URL yet is not
  // rendered at all — not disabled, not `#`.
  const outbound = SITE_LINKS.filter(
    (link): link is { label: string; href: string } => link.href !== null
  );

  return (
    <footer className={styles.foot}>
      <div className={styles.footTop}>
        <Link href="/" className={styles.wordmark} aria-label={`${BRAND.name}, home`}>
          <LotusMark size={30} water={false} />
          <span className={styles.wordmarkText} style={{ fontSize: 21 }}>
            {BRAND.name}
          </span>
        </Link>

        <span className={styles.footDomain}>{SITE_DOMAIN}</span>

        <span className={styles.spacer} />

        <nav className={styles.footLinks} aria-label="Footer">
          {SITE_NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
          <Link href="/data">What it is, what it is not</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          {outbound.map((link) => (
            <a key={link.label} href={link.href} rel="noopener noreferrer" target="_blank">
              {link.label}
            </a>
          ))}
          <button type="button" onClick={openPreferences}>
            Cookie Preferences
          </button>
        </nav>
      </div>

      <p className={styles.footNote}>
        Lelañea is an educational and contemplative application. It is not a medical application,
        not a mental health application, not psychotherapy, not counseling, and not a crisis
        service. If you are at immediate risk, contact your local emergency services or a licensed
        crisis service in your area without delay.
      </p>

      {/* Both halves come from the brand seam: the trademark is the PRODUCT,
          the copyright is the LEGAL ENTITY, and they differ here. Hardcoding
          either would be a second place to change the name from. */}
      <p className={styles.footLegal}>
        {BRAND.name}™ · © {year} {BRAND.legalName}
      </p>
    </footer>
  );
}
