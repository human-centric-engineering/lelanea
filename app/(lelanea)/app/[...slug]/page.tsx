import { notFound } from 'next/navigation';

/**
 * The route that exists so the shell's own 404 can be reached.
 *
 * ## It resolves nothing, and that is the whole design
 *
 * t-9 shipped a catch-all here that RENDERED a placeholder for each of the
 * eight destinations the nav offered, because only `/app` had a page. t-11 gave
 * every one of them a real route and deleted it. This is not that file coming
 * back: it renders nothing, resolves nothing, and knows nothing about
 * `SHELL_NAV`. Its only job is to throw, so that `not-found.tsx` in the segment
 * above becomes reachable.
 *
 * Without it, a path under `/app` that matches no route is handled by the ROOT
 * `app/not-found.tsx` — the only boundary Next uses for unmatched URLs
 * (`next/dist/docs`, file-conventions/not-found: "the root `app/not-found.js`
 * … handle any unmatched URLs for your whole application"). That takes the
 * whole window, so a typo replaced the four-column frame with a full-page 404
 * linking to `/`, and the back button was the only way home. Which is verbatim
 * the defect t-9's catch-all was written to close, arriving through the other
 * door once it was gone.
 *
 * `[...slug]` and not `[[...slug]]`: the optional form also matches `/app` and
 * would collide with `page.tsx`. A real route beats a catch-all in App Router,
 * so the seven destinations are untouched by this — `shell-view-pages.test.tsx`
 * holds that line.
 *
 * ## Why it is synchronous, and why that is load-bearing
 *
 * **The status code depends on it.** Next returns `200` for a streamed response
 * and `404` only for one that has not begun streaming, because the headers are
 * already sent by then (`next/dist/docs`, file-conventions/loading, "Status
 * Codes"). The body starts streaming when a Suspense fallback renders — a
 * `loading.tsx` in the path, or a Server Component suspending under a
 * `<Suspense>` — so the docs' instruction is to "place `notFound()` before
 * those boundaries and before any `await` that may suspend".
 *
 * So this component is deliberately NOT `async`, takes no `params` (which is a
 * Promise in Next 16 and would have to be awaited), and calls `notFound()` as
 * its first and only statement. There is no `loading.tsx` at or above
 * `app/(lelanea)/app/`, which is the other half of the condition and the half
 * that is easy to break later — `tests/unit/app/shell-not-found.test.tsx`
 * guards it, because adding one would silently turn every 404 here into a 200
 * and nothing else in the suite would notice.
 */
export default function ShellUnknownPath(): never {
  notFound();
}
