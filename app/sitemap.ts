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
  // Lelañea (t-5, extended t-6; divergence row 11): the starter's /about and
  // /contact are gone with the pages themselves, and the routes the site
  // actually has took their place.
  //
  // /disclaimer arrived with t-6 and is listed like any other page. /privacy is
  // listed but carries `robots: { index: false }` on the page itself while its
  // body is still the starter's template — the sitemap offering a URL and the
  // page declining to be indexed is not a contradiction, it is how a crawler is
  // told the route exists and is not ready. The three that WERE noindexed for
  // the same reason (/lelanea, /mission, /data) had that removed with this
  // task, because they now carry her words.
  const publicPages = [
    { path: '', priority: 1.0, changeFrequency: 'weekly' as const },
    { path: '/lelanea', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/mission', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/data', priority: 0.8, changeFrequency: 'monthly' as const },
    { path: '/disclaimer', priority: 0.5, changeFrequency: 'yearly' as const },
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
