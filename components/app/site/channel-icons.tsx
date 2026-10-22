import type { ChannelIcon } from '@/lib/site/config';

/**
 * Line icons for the places she publishes (t-171).
 *
 * Deliberately generic glyphs — a page, a play button, sound waves — rather than
 * the platforms' own logos. Logos come with brand-usage rules, each platform's
 * is a different weight and colour, and a row of them reads as a row of
 * advertisements. A single 1.5px line in `currentColor` sits in the footer's
 * register and takes whatever ink its link has.
 *
 * Always decorative: every caller puts the platform's name in text beside it,
 * so the icon is `aria-hidden` and has no title.
 */
export function ChannelGlyph({ icon, size = 18 }: { icon: ChannelIcon; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[icon]}
    </svg>
  );
}

const GLYPHS: Record<ChannelIcon, React.ReactNode> = {
  // A globe: her own site.
  site: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" />
    </>
  ),
  // A camera body: Instagram, without its mark.
  instagram: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="12" cy="12" r="3.6" />
      <circle cx="16.6" cy="7.4" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  // A play button: video.
  video: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="3.5" />
      <path d="m10.25 9.25 4.5 2.75-4.5 2.75Z" />
    </>
  ),
  // Sound rising and falling: something to listen to.
  listen: <path d="M4 10.5v3M8 7.5v9M12 4.5v15M16 8v8M20 10.5v3" />,
  // A page with lines: writing.
  read: (
    <>
      <path d="M6.5 3.5h7l4 4v13h-11Z" />
      <path d="M13.5 3.5v4h4M9 12h6M9 15.5h6" />
    </>
  ),
  // Three people in a ring: a community.
  gather: (
    <>
      <circle cx="12" cy="7.5" r="2.5" />
      <circle cx="6" cy="14.5" r="2.25" />
      <circle cx="18" cy="14.5" r="2.25" />
      <path d="M8.5 20c.7-1.6 2-2.5 3.5-2.5s2.8.9 3.5 2.5" />
    </>
  ),
};
