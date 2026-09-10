/**
 * Public-site configuration — the handful of strings the marketing surface
 * needs that are neither authored content nor deployment secrets.
 *
 * ## Why `lib/site/` and not `lib/app/`
 *
 * `lib/app/**` is the SEAM tier: files Daybreak and Sunrise ship empty for a
 * fork to fill, and `tests/unit/lib/app/defaults.test.ts` derives its roster
 * from that directory's contents and requires a row per file asserting the seam
 * still ships empty. This is not a seam — it is our own content, born full — so
 * a row there would assert the opposite of what the file is for. It lives one
 * directory over instead.
 *
 * ## Why constants rather than environment variables
 *
 * Every consumer here is a client component: `SiteFooter` and `SiteHeader` read
 * `SITE_LINKS` and `SITE_NAV`, and `WaitlistForm` — which reads `LAUNCH_WINDOW`
 * — became one in §03 t-7 when the form went live. **There is no server-only
 * value in this file**, so do not reach for a server env var on the strength of
 * an exception that used to be here: an earlier version of this comment said
 * `WaitlistForm` was a server component and could have taken one, which was
 * true when written and stopped being true without anything failing.
 * A client-readable env var has to be `NEXT_PUBLIC_*`, and
 * Sunrise #661 removed the last three of those from this codebase for a reason
 * worth not re-learning: `NEXT_PUBLIC_*` is inlined at **build** time and
 * `.dockerignore` excludes `.env*`, so a container build shipped none of them
 * and put someone else's name in both footers. `lib/app/leaf-brand.ts` carries
 * the full account.
 *
 * Nothing here is a secret, nothing varies per environment, and every value is
 * copy that a human authored — so a change is a PR either way. A constant is
 * the honest shape.
 *
 * ## The outbound links are `null` on purpose (D3)
 *
 * Her YouTube, Spotify and personal site are named in the product description
 * but no URLs exist yet. D3 ruled: render **nothing** rather than a dead link.
 * `SITE_LINKS` therefore holds `null` per destination, and the footer maps only
 * the entries that have a URL. Filling one in is the whole change needed to
 * make it appear — there is no second place to edit.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.10
 */

/**
 * When the first groups open, as the waitlist card says it.
 *
 * The prototype carries the literal placeholder `[LAUNCH WINDOW]` and the task
 * calls it a config string, so it is one — still bracketed, because a bracketed
 * placeholder reads as unfinished to everyone who sees it, and an invented date
 * would read as a promise. Replace the whole string when the window is known.
 */
export const LAUNCH_WINDOW = '[LAUNCH WINDOW]';

/** The domain, as the footer prints it beside the wordmark. */
export const SITE_DOMAIN = 'lelanea.com';

/**
 * The photograph of Lelañea Fulton on `/lelanea`, or `null` while there is none.
 *
 * The same shape as `SITE_LINKS` and for the same reason (D3): an asset that
 * does not exist renders as nothing deliberate rather than as a broken image,
 * and filling this constant is the whole change needed to make it appear. A
 * path under `public/lelanea/` — `/lelanea/creator.jpg` — once the file lands;
 * `next/image` needs the intrinsic size, which the page passes.
 *
 * Her video sits behind this and is a todo for her, not for us. It is
 * deliberately NOT stubbed: there is no design for the slot yet, and B31's
 * "deliberate stub" needs something to be a stub of.
 */
export const CREATOR_PORTRAIT: string | null = null;

/**
 * Where the site says she can be found. `null` means "no URL yet" and renders
 * nothing at all — not a disabled link, not a `#`, not an empty `<a>`.
 */
export const SITE_LINKS: ReadonlyArray<{ label: string; href: string | null }> = [
  { label: 'YouTube', href: null },
  { label: 'Spotify', href: null },
  { label: 'Her site', href: null },
];

/** The public pages, in the order the header and footer list them. */
export const SITE_NAV = [
  { href: '/lelanea', label: 'Lelañea' },
  { href: '/mission', label: 'The mission' },
  { href: '/data', label: 'Your data' },
] as const;

/**
 * The id the header's CTA scrolls to, and the form's own id. One constant so
 * the button and its target cannot drift apart.
 */
export const WAITLIST_ANCHOR = 'waitlist-form';

/**
 * The id of the crisis disclosure on `/data`, which the site footer links to
 * from every page.
 *
 * A constant for the same reason `WAITLIST_ANCHOR` is one, with more riding on
 * it: a fragment that no longer matches an element does not error, it silently
 * lands the reader at the top of the page — and the reader following this
 * particular link is the one the whole disclaimer exists for.
 * `site-footer.test.tsx` pins the two ends together.
 */
export const CRISIS_ANCHOR = 'crisis';
