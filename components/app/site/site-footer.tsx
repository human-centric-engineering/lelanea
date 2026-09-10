'use client';

import Link from 'next/link';

import { LotusMark } from '@/components/app/ui/lotus-mark';
import { useConsent } from '@/lib/consent';
import { BRAND } from '@/lib/brand';
import { resolveFooterCopyright } from '@/lib/footer/copyright';
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
 * ## The copyright half goes through `resolveFooterCopyright`, not around it
 *
 * It was written out inline at first, which quietly took this footer out of the
 * `lib/app/footer.ts` seam. `ProtectedFooter` honours that seam, so setting
 * `footerCopyright = false` — its documented white-label use — would have
 * dropped the line from the authenticated footer and left it standing on the
 * marketing one. That is the same split `lib/footer/copyright.ts` says #561
 * existed to close, and no test would have caught it: the protected footer's
 * suite covers only its own side.
 *
 * The trademark is ours and sits outside the seam, since the seam governs an
 * attribution line rather than a mark. When the seam yields nothing, the whole
 * paragraph goes — a bare `Lelañea™` with no year and no entity is not a line
 * anybody chose.
 *
 * @see .context/app/planning/design/lelanea.html — `footer.site-foot`
 */
export function SiteFooter() {
  const { openPreferences } = useConsent();
  const year = new Date().getFullYear();
  const copyright = resolveFooterCopyright(year, BRAND.legalName);

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
          {/* t-6. `/data` shows three sections of the disclosure document in
              the site's own chrome; this is the document itself. Without a link
              here it would be an orphan route — reachable only from a sentence
              at the bottom of `/data`, which is the page a reader who wants the
              full disclosures has already decided not to stop at. */}
          <Link href="/disclaimer">Disclosures</Link>
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

      {/*
        The standing disclaimer, on every public page.

        Its closing clause used to be "contact your local emergency services or
        a licensed crisis service in your area without delay" — which is the
        disclaimer document's own crisis instruction with two clauses trimmed
        out of the middle of it. t-6's provenance test found it. Safety copy is
        the worst possible place for a second copy of a sentence: the authored
        version tells a reader to stop using the app, to go to an emergency
        department, AND to contact a crisis service, and the footer's re-cut had
        quietly dropped two of the three.

        A footer strip cannot carry the whole passage, and paraphrasing it again
        would only re-make the same mistake. So the footer states the shortest
        true thing and sends the reader to where the passage is complete — set
        out in full on `/data`, and in its document context on `/disclaimer`.
      */}
      <p className={styles.footNote}>
        Lelañea is an educational and contemplative application. It is not a medical application,
        not a mental health application, not psychotherapy, not counseling, and not a crisis
        service. If you are at immediate risk, contact your local emergency services now — and see{' '}
        <Link href="/data">what to do in a crisis</Link>.
      </p>

      {/* Both names come from the brand seam: the trademark is the PRODUCT,
          the copyright is the LEGAL ENTITY, and they differ here. Hardcoding
          either would be a second place to change the name from. */}
      {copyright && (
        <p className={styles.footLegal}>
          {BRAND.name}™ · {copyright}
        </p>
      )}
    </footer>
  );
}
