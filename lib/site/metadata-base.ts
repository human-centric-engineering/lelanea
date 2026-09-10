/**
 * The absolute origin Next resolves relative metadata URLs against.
 *
 * ## Why this is a function and not one expression in the root layout
 *
 * It was an expression, inline in `app/layout.tsx`'s `metadata` object. Two
 * things went wrong with that shape, and both are the kind that only surface in
 * production:
 *
 * 1. **It ran at module scope in the ROOT layout**, so a bad value throws while
 *    the layout is still evaluating — every page down, with a stack trace that
 *    names neither the variable nor the Dockerfile.
 * 2. **It could not be tested.** The only assertion available was that the
 *    already-evaluated `metadata.metadataBase` was a `URL`, which says nothing
 *    about which inputs produce which output. The empty-string case below was
 *    written as `new URL('' || fallback)` — a test of JavaScript's `||`, not of
 *    this app, and TypeScript rightly flagged it as always-falsy.
 *
 * Extracted, the resolution is ordinary code with ordinary tests, and the
 * layout keeps a one-line call.
 *
 * ## The empty string is the case that matters
 *
 * `Dockerfile` does `ARG NEXT_PUBLIC_APP_URL` then
 * `ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL`, which sets the variable to
 * `''` — not unset — when the build arg is omitted. `lib/env.ts`'s
 * `withoutBlankClientValues` documents that exact behaviour: "Docker gives us
 * no way to distinguish the two." So `??` is wrong here, since it only falls
 * back on `undefined`, and `new URL('')` throws `ERR_INVALID_URL`.
 *
 * A whitespace-only value is treated the same way, for the same reason: it is
 * a variable someone meant to set and did not.
 *
 * ## Why it matters at all
 *
 * Without `metadataBase`, Next resolves a relative `og:image` against
 * `VERCEL_URL` → `VERCEL_PROJECT_PRODUCTION_URL` → `http://localhost:3000`
 * (`next/dist/lib/metadata/resolvers/resolve-url.js`). This app deploys via
 * Docker, so none of the Vercel variables exist and every link shared to Slack,
 * X or LinkedIn unfurls against localhost — a grey box, with nothing failing
 * anywhere and no way to see it from inside the app.
 *
 * @see app/layout.tsx · app/opengraph-image.tsx · lib/env.ts
 */

/** Where a build with nothing configured points. Matches `app/sitemap.ts`. */
export const DEFAULT_APP_ORIGIN = 'http://localhost:3000';

/**
 * Resolve the metadata base from a configured app URL.
 *
 * Falls back to {@link DEFAULT_APP_ORIGIN} for `undefined`, an empty string, or
 * whitespace. A value that is set but unparseable is NOT swallowed — that is a
 * misconfiguration worth failing on, and it fails here with a message naming
 * the variable rather than inside Next's metadata resolver.
 */
export function resolveMetadataBase(configured: string | undefined): URL {
  const trimmed = configured?.trim();
  if (!trimmed) return new URL(DEFAULT_APP_ORIGIN);

  try {
    return new URL(trimmed);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_APP_URL is set to ${JSON.stringify(configured)}, which is not a valid ` +
        `absolute URL. It is used as the metadata base for og:image and canonical links.`
    );
  }
}
