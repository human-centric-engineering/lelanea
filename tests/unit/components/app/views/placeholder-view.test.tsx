// @vitest-environment happy-dom

/**
 * The placeholder card — the kit's `<Card>`, with three classes overridden.
 *
 * ## Why this asserts the RESOLVED class list
 *
 * Every override here wins only because `tailwind-merge` drops the kit's class
 * from the same group. t-10 shipped three collisions where it dropped OURS
 * instead and nothing could see it: the source read correctly, the DOM read
 * correctly to anyone who did not know which of two classes the stylesheet
 * would apply, and only the resolved list knew. `className` on the rendered
 * element IS the resolved list, so that is what these assert — both what
 * survived and what was dropped, because "border-dashed is present" is equally
 * true of a card that also kept a solid border from the kit.
 *
 * @see components/app/views/placeholder-view.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlaceholderCard } from '@/components/app/views/placeholder-view';

function classesOf(): string[] {
  const { container } = render(
    <PlaceholderCard title="No module is open yet">Modules arrive later.</PlaceholderCard>
  );
  const card = container.firstElementChild;
  return (card?.className ?? '').split(/\s+/).filter(Boolean);
}

describe('it says what it is', () => {
  it('is tagged as unbuilt, not merely quiet', () => {
    render(<PlaceholderCard title="No module is open yet">Modules arrive later.</PlaceholderCard>);
    expect(screen.getByText('not built yet')).toBeTruthy();
  });

  it('carries the title and the plain line', () => {
    render(<PlaceholderCard title="No module is open yet">Modules arrive later.</PlaceholderCard>);
    expect(screen.getByText('No module is open yet')).toBeTruthy();
    expect(screen.getByText('Modules arrive later.')).toBeTruthy();
  });
});

describe('the three overrides survive the merge', () => {
  const keeps = [
    // The dashed edge is the only thing distinguishing this from a finished
    // card at a glance.
    'border-dashed',
    // The plain border, NOT the kit's card border — which is fully transparent
    // in light mode and would leave the dashes invisible on the theme they
    // matter most in.
    'border-[var(--color-border)]',
    // It sits ON the surface rather than being another raised panel above it.
    'bg-background',
    // It hugs its own text rather than stretching the surface: everything else
    // on the page is built to a measure, and a full-width card left its content
    // in the left third of a 940px box.
    'max-w-[30rem]',
    // Still the kit's card: radius and padding come from there, unchanged.
    'rounded-lg',
    'p-6',
  ];

  const drops = [
    // Both are the kit's, both are in a group one of ours also occupies, and
    // both losing is what makes the overrides above real.
    'bg-card',
    'border-[var(--color-card-border)]',
  ];

  it.each(keeps)('keeps %s', (cls) => {
    expect(classesOf()).toContain(cls);
  });

  it.each(drops)('drops %s', (cls) => {
    expect(classesOf()).not.toContain(cls);
  });
});

describe('no colour-mix in a class', () => {
  it('keeps the border out of the one construct Tailwind mis-builds', () => {
    // Tailwind guards any arbitrary value containing `color-mix()` behind an
    // `@supports` and synthesises the unguarded rule by stripping the mix and
    // keeping its first colour — so a 32% tone tint became a fully saturated
    // dashed rule on any browser without `color-mix`. The tint was barely
    // perceptible; the fallback was not. See `workspace.tsx`, where the same
    // mechanism was a legibility failure rather than a loud border.
    expect(classesOf().join(' ')).not.toContain('color-mix');
  });
});

describe('a caller can still add to it', () => {
  it('appends its own class rather than replacing the card', () => {
    const { container } = render(
      <PlaceholderCard title="t" className="mt-8">
        body
      </PlaceholderCard>
    );
    const cls = container.firstElementChild?.className ?? '';
    expect(cls).toContain('mt-8');
    expect(cls).toContain('border-dashed');
  });
});
