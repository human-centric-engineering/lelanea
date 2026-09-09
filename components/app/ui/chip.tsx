import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * §6.6: a theme or filter tag. `selected` renders heather amethyst; `tone="teal"`
 * marks an active teaching.
 *
 * `selected` wins over `tone`, because the two answer different questions — what
 * kind of thing this is, and whether you have picked it — and the answer to the
 * second is what a reader needs to see at a glance. Expressed as a compound
 * variant so `cva` resolves it rather than the component branching.
 */
const chipVariants = cva(
  cn(
    'inline-flex items-center rounded-full border px-[15px] py-[9px] text-[13px] leading-none',
    'transition-colors duration-200 ease-[var(--ease-brand)]',
    // The same offset outline as `Button`, and for the same reason: a selected
    // chip's fill and the focus ring are both brand colours, so a flush ring is
    // a chip that grew by a pixel. See `button.tsx`'s FOCUS_RING.
    'focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2',
    'focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]',
    'disabled:pointer-events-none disabled:opacity-45'
  ),
  {
    variants: {
      tone: {
        default:
          'border-border bg-card text-[var(--color-heading)] hover:bg-[var(--color-pill-hover)]',
        teal: 'border-transparent bg-secondary text-secondary-foreground hover:bg-[var(--color-secondary-hover)]',
      },
      selected: { true: '', false: '' },
    },
    compoundVariants: [
      {
        selected: true,
        className:
          'border-transparent bg-[var(--color-selected)] text-[var(--color-selected-foreground)] hover:bg-[var(--color-selected-hover)]',
      },
    ],
    defaultVariants: { tone: 'default', selected: false },
  }
);

export interface ChipProps
  extends
    Omit<React.ComponentPropsWithoutRef<'button'>, 'type'>,
    VariantProps<typeof chipVariants> {}

/**
 * A tag pill for themes and filters.
 *
 * ## It is a real button, and it says whether it is pressed
 *
 * The kit renders a `<button>` whose selected state is carried by colour alone.
 * `selected` here also sets `aria-pressed`, so a screen reader is told what the
 * fill is telling everyone else — WCAG 1.4.1, and the reason `--color-selected`
 * needed a contrast that reads rather than a tint that decorates.
 *
 * `type="button"` is forced. A chip is very often a filter inside a form, and
 * the default `submit` would post it.
 *
 * ## Why `--color-selected` is not `--color-status-purple`
 *
 * §6.2's heather amethyst `#806C7B` carries a label at 4.25:1, short of AA, and
 * the status token lightens in dark mode for badge use — which is exactly the
 * trap that put oyster on the status red at 2.99:1 before t-18. The selection
 * fill is its own mode-stable token, three points of lightness darker at 4.73:1.
 * See the comment at the token.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.2, §6.6
 */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, tone, selected, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected ?? false}
      className={cn(chipVariants({ tone, selected }), className)}
      {...props}
    />
  );
});
