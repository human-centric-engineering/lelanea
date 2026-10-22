import type { ChannelIcon } from '@/lib/site/config';

/**
 * Line icons for the places she publishes that have no service mark to show
 * (t-171): her own site, and Skool, which publishes no vector mark. Every other
 * link carries its service's own logo from `service-logos.tsx`, so a glyph for
 * it here would never render. A single 1.5px line in `currentColor` sits in the
 * footer's register and takes whatever ink its link has.
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
