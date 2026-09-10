import type { Metadata } from 'next';
import Link from 'next/link';
import { BRAND } from '@/lib/brand';

const description = `Privacy Policy for ${BRAND.name}. Learn how we collect, use, and protect your data.`;

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description,
  openGraph: {
    title: `Privacy Policy - ${BRAND.name}`,
    description,
  },
  twitter: {
    card: 'summary',
    title: `Privacy Policy - ${BRAND.name}`,
    description,
  },
  // LELAÑEA (t-6, divergence row 10). Withheld from search while the body is
  // the starter's template. `/terms` and `/disclaimer` carry her real words and
  // are indexable; this one would put "This is a placeholder privacy policy"
  // into search results as lelanea.com's privacy policy. Remove this line with
  // the interim notice below, when her policy exists.
  robots: { index: false },
};

/**
 * Privacy Policy Page
 *
 * Placeholder privacy policy page.
 * Replace with your actual privacy policy content.
 *
 * Phase 3.5: Landing Page & Marketing
 *
 * ## Lelañea: kept, and labelled (t-6, decision D8, divergence row 10)
 *
 * D8 rules that Sunrise's generic page STAYS and is linked as interim, rather
 * than being deleted or replaced with something we wrote. Deleting it would
 * break the footer link and leave a site with no privacy policy at all;
 * writing one ourselves would put a legal document on lelanea.com that no
 * lawyer and no author has seen. The honest third option is to keep the
 * template and say plainly that it is one — B31's "deliberate stub", applied to
 * a page rather than a control.
 *
 * The edit is deliberately two things — a `robots` line and one notice element
 * — so the next Daybreak sync is a small re-application rather than a
 * re-resolution of a rewritten file.
 *
 * The Terms of Use cross-reference this page (clause 12) and the authored file
 * flags it as an open review note. That closes when her policy is written, not
 * here.
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="container mx-auto px-4 py-16 md:py-24">
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-8 text-4xl font-bold tracking-tight">Privacy Policy</h1>

        {/* LELAÑEA (t-6, divergence row 10) — the interim notice D8 requires. */}
        <div className="border-[var(--color-status-yellow)] bg-[var(--color-status-yellow-bg)] mb-10 rounded-md border p-5 text-sm leading-relaxed">
          <strong className="font-medium">This is an interim policy.</strong> Lelañea&rsquo;s own
          privacy policy is being written and will replace the template below. In the meantime,{' '}
          <Link href="/data" className="underline underline-offset-4">
            Your data
          </Link>{' '}
          is an accurate account of what the app holds and what you can do with it, and{' '}
          <Link href="/disclaimer" className="underline underline-offset-4">
            the disclosures
          </Link>{' '}
          are hers in full.
        </div>

        <div className="prose prose-neutral dark:prose-invert max-w-none">
          <p className="text-muted-foreground lead">Last updated: January 19, 2026</p>

          <section className="mt-8">
            <h2>Introduction</h2>
            <p>
              This is a placeholder privacy policy. Replace this content with your actual privacy
              policy that complies with applicable laws and regulations (GDPR, CCPA, etc.).
            </p>
          </section>

          <section className="mt-8">
            <h2>Information We Collect</h2>
            <p>Describe what personal information you collect, such as:</p>
            <ul>
              <li>Account information (name, email address)</li>
              <li>Usage data and analytics</li>
              <li>Cookies and tracking technologies</li>
              <li>Information from third-party services</li>
            </ul>
          </section>

          <section className="mt-8">
            <h2>How We Use Your Information</h2>
            <p>Explain how you use the collected information:</p>
            <ul>
              <li>Providing and improving our services</li>
              <li>Communicating with you</li>
              <li>Security and fraud prevention</li>
              <li>Legal compliance</li>
            </ul>
          </section>

          <section className="mt-8">
            <h2>Data Sharing and Disclosure</h2>
            <p>
              Describe when and with whom you share user data, including third-party service
              providers, legal requirements, and business transfers.
            </p>
          </section>

          <section className="mt-8">
            <h2>Your Rights</h2>
            <p>Outline the rights users have regarding their data:</p>
            <ul>
              <li>Access and portability</li>
              <li>Correction and deletion</li>
              <li>Opt-out of marketing</li>
              <li>Withdraw consent</li>
            </ul>
          </section>

          <section className="mt-8">
            <h2>Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at{' '}
              <a href="mailto:privacy@example.com" className="text-primary hover:underline">
                privacy@example.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
