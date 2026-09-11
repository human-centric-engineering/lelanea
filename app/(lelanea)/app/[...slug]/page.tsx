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
 * linking to `/`, and the back button was the only way home.
 *
 * **That was true under t-9 as well**, and an earlier draft of this comment said
 * otherwise. t-9's catch-all called `notFound()` for any path the nav did not
 * offer — deliberately, so a typo never became a page that looked deliberate —
 * and there was no segment-level `not-found.tsx` to catch it. So a bad path has
 * ALWAYS left the frame; what t-9 fixed was the eight dead links, which is a
 * different defect. This is the first time a typo stays inside the shell.
 *
 * `[...slug]` and not `[[...slug]]`: the optional form also matches `/app` and
 * would collide with `page.tsx`. A real route beats a catch-all in App Router,
 * so the seven destinations are untouched by this.
 *
 * ## The invariant the 404 status actually depends on
 *
 * Next returns `200` for a streamed response and `404` only for one that has
 * not begun streaming, because the headers are already sent by then
 * (`next/dist/docs`, file-conventions/loading, "Status Codes"). The body starts
 * streaming when a Suspense fallback renders.
 *
 * **So the invariant is not this file. It is that no Suspense boundary sits
 * between the root and this page.** The layout one segment up already
 * `await`s `getServerSession()`, and that is fine only because nothing above it
 * suspends: the root layout's single `<Suspense>` wraps `UserIdentifier` and
 * `PageTracker` as SIBLINGS of `{children}`, not `{children}` itself, and
 * neither `ppr` nor `cacheComponents` is enabled. React buffers the shell until
 * every unsuspended part resolves, so the throw lands before a byte is flushed.
 *
 * The change that breaks it is not an obvious one. Next's own `loading.js`
 * documentation recommends wrapping a layout's runtime data access in its own
 * `<Suspense>` for instant navigation — follow that advice here and every 404
 * under `/app` silently becomes a 200. `tests/unit/app/shell-not-found.test.tsx`
 * guards both shapes: a `loading` file at any level in the chain, and a
 * `<Suspense>` that contains `{children}` in any layout above this.
 *
 * This component is still deliberately not `async`, takes no `params` (a
 * Promise in Next 16, which would have to be awaited) and throws as its first
 * statement. With no boundary above it that is belt-and-braces rather than the
 * load-bearing part — an earlier draft of this comment claimed the opposite,
 * which would have sent a maintainer looking in the wrong file.
 */
export default function ShellUnknownPath(): never {
  notFound();
}
