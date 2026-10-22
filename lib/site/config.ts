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
 * ## The outbound links (D3, then t-171)
 *
 * D3 ruled that a destination with no URL renders **nothing** rather than a
 * dead link, so `SITE_LINKS` keeps `null` as a legal value and the footer maps
 * only the entries that have one. Her URLs arrived with t-171 (owner, 22 Oct
 * 2026) and live once, in {@link CHANNEL_URL}: the footer row, the home page's
 * channels and `/lelanea`'s list all read from there, so a moved channel is one
 * edit.
 *
 * Everything she publishes outside the app goes out under one name,
 * Integrating Consciousness: the podcast, the Substack and the Skool community
 * all carry it, and "Conversations with Aya" is a second show on the same
 * YouTube channel. {@link SITE_CHANNELS} groups them that way.
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
 * Her URLs, once. Everything below reads from here.
 *
 * `site` is labelled "Integrating Consciousness" with "Lelañea’s personal
 * website" beside it wherever it appears — never "Her site" (owner, t-171).
 */
export const CHANNEL_URL = {
  site: 'https://www.lelaneafulton.com/',
  instagram: 'https://www.instagram.com/lelanea/',
  youtube: 'https://www.youtube.com/@lelaneafulton',
  spotify: 'https://open.spotify.com/show/2uzw0r6lQAbFxveAqnyGrQ',
  applePodcasts: 'https://podcasts.apple.com/us/podcast/integrating-consciousness/id1799753903',
  podcastOnYouTube: 'https://www.youtube.com/playlist?list=PLCl6VwDKqbGUxHb8F0MT6tTxzk4HFX5ta',
  ayaOnYouTube: 'https://www.youtube.com/playlist?list=PLCl6VwDKqbGWOASZWVxXG-EXSfexIgfr1',
  substack: 'https://lelanea.substack.com/',
  skool: 'https://www.skool.com/integrating-consciousness-2716',
} as const;

/** Which line icon a link carries. `components/app/site/channel-icons.tsx` draws them. */
export type ChannelIcon = 'site' | 'instagram' | 'video' | 'listen' | 'read' | 'gather';

/**
 * Where the site says she can be found — the footer's row. `null` means "no
 * URL yet" and renders nothing at all — not a disabled link, not a `#`, not an
 * empty `<a>`.
 */
export const SITE_LINKS: ReadonlyArray<{
  label: string;
  href: string | null;
  icon?: ChannelIcon;
  /** A quieter second label after the name, where the name alone is ambiguous. */
  detail?: string;
}> = [
  {
    label: 'Integrating Consciousness',
    detail: 'Lelañea’s personal website',
    href: CHANNEL_URL.site,
    icon: 'site',
  },
  { label: 'Instagram', href: CHANNEL_URL.instagram, icon: 'instagram' },
  { label: 'YouTube', href: CHANNEL_URL.youtube, icon: 'video' },
  { label: 'Spotify', href: CHANNEL_URL.spotify, icon: 'listen' },
  { label: 'Apple Podcasts', href: CHANNEL_URL.applePodcasts, icon: 'listen' },
  { label: 'Substack', href: CHANNEL_URL.substack, icon: 'read' },
  { label: 'Skool', href: CHANNEL_URL.skool, icon: 'gather' },
];

/**
 * Her work outside the app, as the home page shows it: one entry per thing
 * she makes, each with the places it can be found.
 *
 * Three of the four carry the name Integrating Consciousness, so the section
 * is headed with it and each entry is named for what it is. These are labels,
 * not prose: nothing here describes or sells the work, which is the owner's
 * ruling for t-171 — the public site says nothing about her work that she did
 * not. Her own account of it is on `/lelanea`, in `about_the_creator`.
 */
export const SITE_CHANNELS: ReadonlyArray<{
  name: string;
  icon: ChannelIcon;
  /** What the cover-art placeholder is waiting for. */
  art: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}> = [
  {
    name: 'The podcast',
    icon: 'listen',
    art: 'Podcast cover art',
    links: [
      { label: 'Spotify', href: CHANNEL_URL.spotify },
      { label: 'Apple Podcasts', href: CHANNEL_URL.applePodcasts },
      { label: 'YouTube', href: CHANNEL_URL.podcastOnYouTube },
    ],
  },
  {
    name: 'Conversations with Aya',
    icon: 'video',
    art: 'Conversations with Aya cover art',
    links: [{ label: 'YouTube', href: CHANNEL_URL.ayaOnYouTube }],
  },
  {
    name: 'Writing',
    icon: 'read',
    art: 'Substack header image',
    links: [{ label: 'Substack', href: CHANNEL_URL.substack }],
  },
  {
    name: 'Community',
    icon: 'gather',
    art: 'Community image',
    links: [{ label: 'Skool', href: CHANNEL_URL.skool }],
  },
];

/** Where to find her, as `/lelanea` lists it beneath her biography. */
export const CREATOR_LINKS: ReadonlyArray<{
  label: string;
  detail: string;
  href: string;
  icon: ChannelIcon;
}> = [
  {
    label: 'Integrating Consciousness',
    detail: 'Lelañea’s personal website',
    href: CHANNEL_URL.site,
    icon: 'site',
  },
  { label: 'Instagram', detail: '@lelanea', href: CHANNEL_URL.instagram, icon: 'instagram' },
  { label: 'YouTube', detail: '@lelaneafulton', href: CHANNEL_URL.youtube, icon: 'video' },
  { label: 'Substack', detail: 'lelanea.substack.com', href: CHANNEL_URL.substack, icon: 'read' },
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
