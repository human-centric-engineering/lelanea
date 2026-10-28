import type { Metadata } from 'next';
import { Suspense } from 'react';
import { headers } from 'next/headers';
import '@/app/globals.css';
import '@/app/brand-theme.css'; // fork-owned per-surface palette; must cascade after globals
import { ThemeProvider } from '@/hooks/use-theme';
import { NO_FLASH_THEME_SCRIPT } from '@/lib/theme';
import { ErrorHandlingProvider } from '@/app/error-handling-provider';
import { ConsentProvider } from '@/lib/consent';
import { CookieBanner } from '@/components/cookie-consent';
import { AnalyticsProvider } from '@/lib/analytics';
import { AnalyticsScripts, UserIdentifier, PageTracker } from '@/components/analytics';
import { SurfaceSync } from '@/components/surface-sync';
import { DEFAULT_SURFACE } from '@/lib/app/surface';
import { BRAND } from '@/lib/brand';
import { resolveMetadataBase } from '@/lib/site/metadata-base';
// LELAÑEA divergence — see .context/app/divergences.md, rows 1 and 2.
import { brandFontVariables } from '@/app/fonts';

// Root metadata, driven entirely by the BRAND seam (#519). The `template`
// gives every page that sets only a plain string title consistent branding;
// a route group declaring its own `title.template` still wins, so there is no
// double-branding. Previously this hardcoded "- Next.js Starter" and the
// starter blurb, which every fork inherited on any un-templated page.
export const metadata: Metadata = {
  // LELAÑEA divergence (row 8): without `metadataBase`, Next resolves a
  // relative `og:image` against `VERCEL_URL` → `VERCEL_PROJECT_PRODUCTION_URL`
  // → `http://localhost:3000`. This app deploys via Docker, so none of the
  // Vercel variables exist and every shared link would have unfurled against
  // localhost — a grey box on Slack, X and LinkedIn, with nothing failing
  // anywhere and no way to see it from inside the app. It became load-bearing
  // the moment `app/opengraph-image.tsx` gave the site a card at all (t-5).
  // The resolution — including the empty string Docker's `ENV X=$ARG`
  // produces — lives in `lib/site/metadata-base.ts`, where it is tested.
  metadataBase: resolveMetadataBase(process.env.NEXT_PUBLIC_APP_URL),
  title: {
    default: BRAND.name,
    template: `%s - ${BRAND.name}`,
  },
  description: BRAND.description,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersList = await headers();
  const nonce = headersList.get('x-nonce') ?? undefined;
  // Rendering surface, classified per-request in proxy.ts. Drives the fork-owned
  // app/brand-theme.css (empty in vanilla Sunrise). On <html> so body-portaled
  // overlays inherit it; kept current across client nav by <SurfaceSync> below.
  const surface = headersList.get('x-surface') ?? DEFAULT_SURFACE;

  return (
    // LELAÑEA divergence (row 1): the three `next/font` variable classes are
    // declared on <html> so body-portaled overlays inherit them too. They are
    // only MAPPED onto the font tokens for the consumer surface, in
    // app/brand-theme.css, so /admin still renders in the platform's fonts.
    <html lang="en" data-surface={surface} className={brandFontVariables} suppressHydrationWarning>
      <head>
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: NO_FLASH_THEME_SCRIPT,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <SurfaceSync />
        <ErrorHandlingProvider>
          <ConsentProvider>
            <AnalyticsProvider>
              <ThemeProvider>
                {children}
                <CookieBanner />
              </ThemeProvider>
              <Suspense fallback={null}>
                <UserIdentifier />
                <PageTracker skipInitial />
              </Suspense>
              <AnalyticsScripts nonce={nonce} />
            </AnalyticsProvider>
          </ConsentProvider>
        </ErrorHandlingProvider>
      </body>
    </html>
  );
}
