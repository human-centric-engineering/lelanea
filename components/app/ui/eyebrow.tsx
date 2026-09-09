import * as React from 'react';

import { cn } from '@/lib/utils';

export interface EyebrowProps extends React.ComponentPropsWithoutRef<'span'> {
  /** Render as a different element — `div` above a heading, `span` inline. */
  as?: 'span' | 'div' | 'p';
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
      ref={ref as React.Ref<HTMLSpanElement & HTMLDivElement & HTMLParagraphElement>}
      className={cn('brand-eyebrow text-muted-foreground', className)}
      {...props}
    >
      {children}
    </Component>
  );
});
