import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EyebrowProps extends React.ComponentPropsWithoutRef<'span'> {
  /**
   * Render as a different element — `div` above a heading, `span` inline.
   *
   * A HEADING LEVEL is allowed and is sometimes the honest choice. Where the
   * eyebrow IS a section's label and nothing else labels that section, marking
   * it up as a `<p>` leaves the section out of the document outline entirely:
   * a screen-reader user navigating by heading skips straight over it. The type
   * is unchanged either way — the class carries the look — so this costs
   * nothing visually and is the difference between a section that exists in the
   * outline and one that does not.
   *
   * Do NOT reach for it reflexively: an eyebrow sitting directly above a real
   * `<h2>` is a label for that heading, not a second one, and promoting it
   * there would put two headings where the design shows one.
   */
  as?: 'span' | 'div' | 'p' | 'h2' | 'h3';
}

/**
 * The tracked-out label above a title (§6.3): 12px, `0.14em`, secondary ink.
 *
 * Barely more than the `.brand-eyebrow` class it wraps, and worth existing
 * anyway for one reason: the class carries the TYPE and deliberately no colour,
 * because `app/brand-theme.css` is unlayered and a `color` there could not be
 * overridden by any utility. So every eyebrow in the product would otherwise
 * repeat `brand-eyebrow text-muted-foreground`, and the day one of them forgets
 * the second half it inherits its parent's ink and reads as a heading.
 *
 * CASING IS NOT FORCED, which matches the stylesheet's own reasoning. §6.10 says
 * eyebrows *may* be lowercase, and `text-transform: lowercase` would strip the
 * capital from Lelañea's name wherever an eyebrow carries it. Write the label in
 * the case you want it.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.3, §6.10
 */
export const Eyebrow = React.forwardRef<HTMLSpanElement, EyebrowProps>(function Eyebrow(
  { as: Component = 'span', className, children, ...props },
  ref
) {
  return (
    <Component
      ref={
        ref as React.Ref<
          HTMLSpanElement & HTMLDivElement & HTMLParagraphElement & HTMLHeadingElement
        >
      }
      className={cn('brand-eyebrow text-muted-foreground', className)}
      {...props}
    >
      {children}
    </Component>
  );
});
