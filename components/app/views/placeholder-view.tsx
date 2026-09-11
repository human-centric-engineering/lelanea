import * as React from 'react';

import { Card } from '@/components/app/ui/card';
import { cn } from '@/lib/utils';

export interface PlaceholderCardProps {
  /** What it will hold, said as a sentence rather than a feature name. */
  title: React.ReactNode;
  /** One plain line: that it is not built, and what will be true when it is. */
  children: React.ReactNode;
  className?: string;
}

/**
 * The prototype's `.placeholder` — a card that is honest about being one.
 *
 * ## It is `<Card>`, and that is the point
 *
 * The §01 kit's card was dormant until t-9 wired it, and these views are its
 * widest consumer. Hand-rolling the markup here would be the easy mistake: the
 * prototype's `.placeholder` is a dashed variant of its own `.panel`, so it
 * reads as "different enough to need its own div" right up until the kit's
 * radius, shadow or dark-mode border changes underneath it and this one does
 * not follow.
 *
 * What it overrides is three classes, and every one of them relies on
 * `tailwind-merge` resolving a conflict in OUR favour — the same mechanism that
 * silently deleted three classes in t-10. They are pinned in
 * `tests/unit/components/app/views/placeholder-view.test.tsx` against the
 * resolved class list rather than the written one, because the written one
 * cannot tell you which survived.
 *
 * - `border-dashed` — a solid border says "finished"; the dashed one is the
 *   prototype's own signal and the only thing distinguishing this from a real
 *   card at a glance.
 * - the border COLOUR is the plain `--color-border`, not the kit's card border,
 *   which is fully transparent in light mode and would leave the dashes
 *   invisible on the very theme they matter most in.
 *
 *   It was a 32% mix of the view's tone, which looked right and carried a
 *   fallback that did not: Tailwind guards any arbitrary value containing
 *   `color-mix()` behind an `@supports` and synthesises the unguarded rule by
 *   stripping the mix and keeping its first colour — a fully saturated tone
 *   border on any browser without `color-mix`. The tint was barely perceptible
 *   at 32%; a loud dashed rule on an old browser is not, and the card is not
 *   the place that needs to carry the tone. The head above it does.
 * - `bg-background`, because the prototype's placeholder sits ON the surface
 *   rather than being another raised panel above it.
 *
 * The kit's resting shadow is KEPT rather than cleared. `shadow-none` alongside
 * `shadow-[var(--shadow-rest)]` is the one conflict `tailwind-merge` cannot
 * resolve — an arbitrary `shadow-[…]` may be a colour or a box-shadow, so it
 * keeps both and stylesheet order decides which wins. A rule nobody here can
 * read is worse than a card that keeps its shadow.
 */
export function PlaceholderCard({ title, children, className }: PlaceholderCardProps) {
  return (
    <Card
      eyebrow="not built yet"
      title={title}
      className={cn(
        // It hugs its own text rather than stretching the surface. The note is
        // a reading measure and the view's lede is capped at 44ch, so a
        // full-width card left a 940px box with its content in the left third
        // — the one element on the page not built to a measure.
        'max-w-[30rem]',
        'border-dashed',
        'border-[var(--color-border)]',
        'bg-background',
        className
      )}
    >
      {/* No measure of its own: the card above is the measure now. */}
      <p className="text-muted-foreground leading-[1.65]">{children}</p>
    </Card>
  );
}
