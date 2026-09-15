/**
 * The design's own pair for collapsing and expanding a panel.
 *
 * Two bars and a chevron, pointing the way the panel is about to go: `<||` to
 * collapse it leftwards, `||>` to bring it back. Ported path-for-path from the
 * prototype's `ICONS.collapse` / `ICONS.expand`.
 *
 * ## Why these are not lucide's `PanelLeftClose` / `PanelLeftOpen`
 *
 * Those were the nearest thing in the kit and they are a different drawing: a
 * full panel outline with an arrow inside it, which reads as a window rather
 * than as an edge being pushed. The design's pair says *this edge moves, that
 * way* — the bars are the edge, the chevron is the direction — and it is the
 * only glyph in the shell that has to communicate a direction rather than a
 * destination. Substituting a near-match there is the kind of drift that turns
 * a designed product into a themed one.
 *
 * Both the left menu's control and the conversation's own collapse control take
 * them, which is what the prototype does: one gesture, one glyph, wherever the
 * edge happens to be.
 */
export interface PanelIconProps {
  /** Matches the kit's convention; 18 is what both callers use. */
  size?: number;
  className?: string;
}

/** `<||` — push this edge away. */
export function PanelCollapseIcon({ size = 18, className }: PanelIconProps) {
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
      className={className}
    >
      <path d="M15 5v14" />
      <path d="m10 9-3 3 3 3" />
      <path d="M20 5v14" />
    </svg>
  );
}

/** `||>` — bring it back. */
export function PanelExpandIcon({ size = 18, className }: PanelIconProps) {
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
      className={className}
    >
      <path d="M9 5v14" />
      <path d="m14 9 3 3-3 3" />
      <path d="M4 5v14" />
    </svg>
  );
}
