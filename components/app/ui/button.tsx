import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { Button as ShadcnButton } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The focus treatment, and the reason it is an `outline` rather than a `ring`.
 *
 * `components/ui/button.tsx` draws `focus-visible:ring-1` with **no offset**, so
 * a focused button's indicator sits flush against its own fill. On the orange
 * and terracotta fills you still perceive it, because its outer edge meets the
 * page ground at 4.91:1 — but t-18 moved `--color-ring` onto the secondary ink,
 * and `secondary` **is** that teal. A focused secondary button would merely grow
 * by a pixel in its own colour.
 *
 * No colour repairs it: clearing 3:1 on an oyster ground caps the ring's
 * lightness at 0.258, and clearing 3:1 against a fill demands 0.561 or more. The
 * two ranges do not overlap, so this is a missing mechanism rather than a wrong
 * value — which is why t-18 could not close it from the palette and routed it
 * here.
 *
 * ## Outline, not `ring-offset`
 *
 * `Badge`, `Switch` and `SelectTrigger` solve this with `ring-offset-2
 * ring-offset-background`, and that would have worked. An outline is better for
 * this component: `ring-offset` PAINTS the gap, in `--color-background`, so a
 * button sitting on a card or in a popover gets a two-pixel oyster halo that is
 * not the colour underneath it. An outline leaves whatever is actually there
 * showing, so the same class is correct on all four grounds.
 *
 * `ring-0` and the outline style are both load-bearing against shadcn's base.
 * `tailwind-merge` drops the `ring-1` and the `outline-none` it inherits, but
 * `outline-none` sets `outline-style: none` — an `outline-2` with no style is
 * two pixels of nothing, and it is invisible to type-checking. The test asserts
 * the resolved class list for exactly this reason.
 */
const FOCUS_RING =
  'focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]';

/**
 * §6.5: press is `scale(0.98)` over 120ms on the breath easing, with no colour
 * shift. `transition-colors` from the base would animate only the background, so
 * the transform is named explicitly — a scale with no transition snaps.
 */
const PRESS =
  'transition-[background-color,color,transform] duration-[120ms] ease-[var(--ease-brand)] ' +
  'active:scale-[0.98]';

export const appButtonVariants = cva(cn('rounded-full font-medium', FOCUS_RING, PRESS), {
  variants: {
    /**
     * §6.6's four, in the kit's vocabulary rather than shadcn's.
     *
     * EVERY FILLED VARIANT NAMES ITS HOVER TOKEN. shadcn writes its hover as a
     * 90% alpha of the fill, composited over whatever happens to be behind it,
     * so it lands on a different colour on every ground and cannot be measured
     * at all. On a light ground the destructive hover reaches 3.92:1 and the
     * primary's 3.83:1 — both below AA, both re-opening a gap t-18 closed at
     * rest. A token is a known colour, so the hover state is
     * measurable and the test measures it: 5.09, 5.65 and 5.15 against oyster,
     * every one of them ABOVE its resting value rather than below.
     *
     * EVERY VARIANT ALSO RESTATES ITS LABEL COLOUR UNDER `hover:`, which looks
     * redundant and is not. The base below is shadcn's `ghost`, whose class
     * string is `hover:bg-accent hover:text-accent-foreground`. `tailwind-merge`
     * drops the first — a `hover:bg-*` of ours is in the same group and comes
     * later — but a group with no member of ours in it is not a conflict, so
     * with only a resting `text-*` here the inherited `hover:text-accent-
     * foreground` SURVIVES. It is `#282c2e` on the consumer surface: hovering a
     * primary button swapped the oyster label for near-black on terracotta at
     * 2.35:1, and secondary and destructive for about 2:1. Restating the label
     * gives the group a later member and the inherited class is dropped with the
     * background it came in with.
     */
    variant: {
      primary:
        'bg-primary text-primary-foreground ' +
        'hover:bg-[var(--color-primary-hover)] hover:text-primary-foreground',
      secondary:
        'bg-secondary text-secondary-foreground ' +
        'hover:bg-[var(--color-secondary-hover)] hover:text-secondary-foreground',
      ghost:
        'bg-transparent text-[var(--color-heading)] ' +
        'hover:bg-[var(--color-pill-hover)] hover:text-[var(--color-heading)]',
      destructive:
        'bg-destructive text-destructive-foreground ' +
        'hover:bg-[var(--color-destructive-hover)] hover:text-destructive-foreground',
    },
    /** The kit's three, whose padding is generous per §6.4's 8-point scale. */
    size: {
      sm: 'h-auto px-[18px] py-[10px] text-sm',
      md: 'h-auto px-6 py-[14px] text-base',
      lg: 'h-auto px-8 py-4 text-[17px]',
    },
    block: {
      true: 'w-full',
      false: '',
    },
  },
  defaultVariants: { variant: 'primary', size: 'md', block: false },
});

export interface AppButtonProps
  extends
    Omit<React.ComponentPropsWithoutRef<typeof ShadcnButton>, 'variant' | 'size'>,
    VariantProps<typeof appButtonVariants> {}

/**
 * Lelañea's pill button.
 *
 * It COMPOSES `components/ui/button.tsx` rather than replacing it, so `asChild`,
 * the disabled behaviour, the icon sizing and anything upstream fixes later all
 * still arrive. What it overrides is the two things the palette could not reach
 * — the focus indicator and the hover fill — plus the pill radius and §6.5's
 * press.
 *
 * That composition leans on `tailwind-merge` resolving five conflicts in our
 * favour, which is a real dependency on a library's behaviour and therefore
 * asserted rather than assumed. See `FOCUS_RING`, and the hover-label note on
 * `appButtonVariants` for the one that is only a conflict because we made it
 * one.
 *
 * `variant="link"` is deliberately absent. §6.5 gives a text link "a 1px
 * underline at 3px offset with no colour change", which is a link's treatment
 * and not a button's; a pill that renders as underlined text invites the mistake
 * of using it for navigation. Use an anchor.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.5, §6.6
 */
export const Button = React.forwardRef<HTMLButtonElement, AppButtonProps>(function Button(
  { className, variant, size, block, ...props },
  ref
) {
  return (
    <ShadcnButton
      ref={ref}
      // shadcn's `ghost` carries no fill and no shadow, so it is the quietest
      // base to override. Anything with a fill would leave an alpha hover for
      // `tailwind-merge` to strip, and one more thing to get right silently.
      variant="ghost"
      className={cn(appButtonVariants({ variant, size, block }), className)}
      {...props}
    />
  );
});
