import type { MetadataRoute } from 'next';

/**
 * Sitemap Configuration
 *
 * Generates a sitemap for search engine discovery.
 * Lists all public pages with their last modified dates and change frequencies.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap
 *
 * Phase 3.5: Landing Page & Marketing
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  // Public pages - add new public pages here.
  //
  // Lelañea (t-5): the starter's /about and /contact are gone with the pages
  // themselves; the three the site actually has took their place. They are
  // listed while they are still placeholders (t-6 writes them) because the
  // header and footer link to them, so a crawler reaches them regardless — the
  // sitemap agreeing with the nav is the honest state, not a claim they are
  // finished.
  const publicPages = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' as const },
    { path: '/lelanea', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/mission', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/data', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/privacy', priority: 0.3, changeFrequency: 'yearly' as const },
    { path: '/terms', priority: 0.3, changeFrequency: 'yearly' as const },
  ];

  return publicPages.map((page) => ({
    url: `${baseUrl}${page.path}`,
    lastModified: new Date(),
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));
}
