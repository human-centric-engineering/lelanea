import * as React from 'react';

import { Eyebrow } from '@/components/app/ui/eyebrow';
import { cn } from '@/lib/utils';

// `title` is omitted from the div's own props before being redeclared: the DOM
// attribute is a `string` tooltip, and a `<Card title={<em>…</em>}>` would
// otherwise be a type error at every call site that passes markup.
export interface CardProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Lowercase tracked-out label above the title (§6.3). */
  eyebrow?: React.ReactNode;
  /** Serif title, set in the display register. */
  title?: React.ReactNode;
  /** The quiet line beneath the body — `4 min · yesterday`. */
  meta?: React.ReactNode;
}

/**
 * §6.4's card: surface colour, 20px radius, resting shadow, no border in light
 * and an 8% border in dark.
 *
 * ## One border declaration, not two
 *
 * The kit branches on a `dark` prop to decide whether to draw a border at all.
 * Here the border is unconditional and `--color-card-border` is transparent in
 * light mode — the token does the branching, so the component has no idea which
 * theme it is in and cannot be rendered into the wrong one. It also means a card
 * inside a dark island on a light page is correct, which a prop could not be.
 *
 * ## `rounded-lg` is 20px here
 *
 * `app/brand-theme.css` restates Tailwind's radius scale at §6.4's values, so
 * the ordinary utility comes out at the design's corner on a consumer page and
 * at the platform's on `/admin`. There is no `rounded-[20px]` anywhere for the
 * same reason there is no hex literal.
 *
 * ## It is a `<div>`, and interactivity is the caller's
 *
 * The kit takes an `onClick` and sets `cursor: pointer`, which produces a
 * clickable div: no keyboard focus, no role, no Enter or Space. A card that
 * needs to be actionable should have a real control inside it — a link on the
 * title, or a `<button>` — so the accessible name is the thing being actioned
 * rather than the whole card's text. Passing `onClick` through here would make
 * the wrong thing the easy thing.
 *
 * @see .context/app/planning/lelanea-product-description.md §6.4, §6.6
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { eyebrow, title, meta, className, children, ...props },
  ref
) {
  return (
    <div
      ref={ref}
      className={cn(
        'bg-card text-card-foreground border-card-border rounded-lg border p-6',
        'shadow-[var(--shadow-rest)]',
        className
      )}
      {...props}
    >
      {eyebrow ? <Eyebrow className="mb-2.5 block">{eyebrow}</Eyebrow> : null}
      {title ? (
        <div
          className={cn(
            'brand-display text-2xl text-[var(--color-heading)]',
            children ? 'mb-2' : undefined
          )}
        >
          {title}
        </div>
      ) : null}
      {children ? <div className="text-sm leading-relaxed">{children}</div> : null}
      {meta ? <div className="text-muted-foreground mt-3.5 text-xs">{meta}</div> : null}
    </div>
  );
});
