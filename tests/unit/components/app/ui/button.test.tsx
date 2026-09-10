// @vitest-environment happy-dom

/**
 * Lelañea's Button — and the two defects t-18 could not reach from the palette.
 *
 * Both are invisible to type-checking and to a screenshot of a resting page, and
 * both come from the same place: this component COMPOSES shadcn's Button, so
 * what actually reaches the DOM is `tailwind-merge`'s resolution of our classes
 * against the platform's. That resolution is a library behaviour, not a language
 * one, and it fails silently in the direction that looks fine.
 *
 *   1. **The focus indicator.** shadcn draws `ring-1` with no offset. t-18 moved
 *      `--color-ring` onto the secondary ink, and `secondary` IS that teal — so
 *      a flush ring makes a focused secondary button a button that grew by a
 *      pixel. The arithmetic in `button.tsx` shows no colour can fix it.
 *
 *   2. **The hover fill.** shadcn writes a 90% alpha of the fill, which
 *      composites against whatever is behind it: 3.92:1 for destructive on a
 *      light ground, 3.83:1 for primary. The CONTRAST of the replacement tokens
 *      is measured in `tests/unit/app/brand-theme.test.ts`; what is asserted
 *      here is that the component reaches for them, because a token nothing uses
 *      passes every measurement in that file.
 *
 *   3. **The hover LABEL**, which is the same failure one group over and was
 *      missed for a while by this file itself. `tailwind-merge` only resolves a
 *      group we have a member in; the base's `hover:text-accent-foreground` had
 *      no competitor, so it survived and turned every filled button's label
 *      near-black on hover at roughly 2:1. The alpha-hover case below greps for
 *      a slashed `hover:bg-` and could never have seen it — a guard shaped
 *      around the defect that was already known.
 *
 * The assertions are on the resolved `class` attribute rather than on computed
 * style, deliberately: happy-dom has no Tailwind, so `getComputedStyle` would
 * report nothing for every one of these utilities and each case would pass
 * without proving anything.
 *
 * @see components/app/ui/button.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/app/ui/button';

function classesFor(name: string): string[] {
  return (screen.getByRole('button', { name }).getAttribute('class') ?? '').split(/\s+/);
}

/** Every variant that paints a fill and therefore carries a label on it. */
const FILLED = [
  ['primary', '--color-primary-hover'],
  ['secondary', '--color-secondary-hover'],
  ['destructive', '--color-destructive-hover'],
] as const;

describe('Button', () => {
  describe('the focus indicator is offset from the fill (t-18)', () => {
    it.each(['primary', 'secondary', 'ghost', 'destructive'] as const)(
      '%s draws an offset outline, not a flush ring',
      (variant) => {
        render(<Button variant={variant}>Begin</Button>);
        const classes = classesFor('Begin');

        expect(classes).toContain('focus-visible:outline-offset-2');
        expect(classes).toContain('focus-visible:outline-2');
        expect(classes).toContain('focus-visible:outline-[var(--color-ring)]');
      }
    );

    it('sets the outline STYLE, without which the width paints nothing', () => {
      // The whole failure in one assertion. shadcn's base carries
      // `focus-visible:outline-none`, which in Tailwind 4 is
      // `outline-style: none` — so an `outline-2` inherited alongside it is two
      // pixels of nothing. `tailwind-merge` drops `outline-none` only because
      // `outline-solid` is in the same group and comes later. Nothing about that
      // is guaranteed by a type, and the page looks correct until you tab to it.
      render(<Button>Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain('focus-visible:outline-solid');
      expect(classes).not.toContain('focus-visible:outline-none');
    });

    it('suppresses the ring it inherits, so the two indicators do not stack', () => {
      render(<Button>Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).not.toContain('focus-visible:ring-1');
      expect(classes).toContain('focus-visible:ring-0');
    });

    it('is the case that could only ever fail on secondary', () => {
      // t-18's finding, stated as a test. The ring colour and the secondary fill
      // are the same value, so on every OTHER variant a flush ring is still
      // perceptible against its own fill and only this one is invisible. A
      // regression here would therefore pass a spot-check on the primary button
      // somebody happened to look at.
      render(<Button variant="secondary">Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain('bg-secondary');
      expect(classes).toContain('focus-visible:outline-offset-2');
    });
  });

  describe('every filled variant hovers to a token, not an alpha', () => {
    it.each(FILLED)('%s names %s', (variant, hoverToken) => {
      render(<Button variant={variant}>Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain(`hover:bg-[var(${hoverToken})]`);
    });

    it.each(FILLED)('%s carries no alpha-of-itself hover', (variant) => {
      render(<Button variant={variant}>Begin</Button>);
      const classes = classesFor('Begin');

      // This is the assertion that fails if `tailwind-merge` ever stops
      // resolving an arbitrary `var()` background against a slashed one. Both
      // classes would then be present, the CSS would decide by stylesheet order
      // rather than class order, and the hover would silently go back to being
      // a composite nobody measured.
      const alphaHovers = classes.filter((name) => /^hover:bg-\S+\/\d+$/.test(name));
      expect(alphaHovers).toEqual([]);
    });

    it.each([
      ['primary', 'hover:text-primary-foreground'],
      ['secondary', 'hover:text-secondary-foreground'],
      ['ghost', 'hover:text-[var(--color-heading)]'],
      ['destructive', 'hover:text-destructive-foreground'],
    ] as const)('%s keeps its LABEL colour on hover, at %s', (variant, hoverLabel) => {
      // The other half of the hover, and the half that was missing. The base
      // component is shadcn's `ghost`, whose class string is `hover:bg-accent
      // hover:text-accent-foreground`. `tailwind-merge` drops the background
      // because a `hover:bg-*` of ours is in the same group and comes later —
      // but with no `hover:text-*` of ours there was no conflict to resolve, so
      // the inherited LABEL colour survived every merge. `--color-accent-
      // foreground` is near-black on the consumer surface: a hovered primary
      // button put it on terracotta at 2.35:1, and secondary and destructive at
      // about 2:1. Every resting value in this component clears AA and the
      // hovered one did not, which is the reverse of what its header claims.
      render(<Button variant={variant}>Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain(hoverLabel);
      expect(classes).not.toContain('hover:text-accent-foreground');
      // Exactly one, so a future inherited `hover:text-*` cannot ride along
      // beside ours and let stylesheet order decide the label.
      expect(classes.filter((name) => name.startsWith('hover:text-'))).toEqual([hoverLabel]);
    });

    it('leaves ghost on a wash, which is a surface and not a label ground', () => {
      // `ghost` is the one variant that SHOULD hover to an alpha: §6.5's "hover
      // deepens a background by about 6%" is about surfaces, and `--color-pill-
      // hover` is that wash. Its label sits on the page ground, not on a fill,
      // so no filled-variant measurement applies to it.
      render(<Button variant="ghost">Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain('hover:bg-[var(--color-pill-hover)]');
      expect(classes).toContain('bg-transparent');
    });
  });

  describe('the shape §6.4 and §6.5 ask for', () => {
    it('is a pill, not the platform radius', () => {
      render(<Button>Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain('rounded-full');
      expect(classes).not.toContain('rounded-md');
    });

    it('presses to 0.98 on the breath easing', () => {
      render(<Button>Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain('active:scale-[0.98]');
      expect(classes).toContain('duration-[120ms]');
      expect(classes).toContain('ease-[var(--ease-brand)]');
      // `transition-colors` would animate the background and snap the scale.
      expect(classes).toContain('transition-[background-color,color,transform]');
      expect(classes).not.toContain('transition-colors');
    });

    it.each(['sm', 'md', 'lg'] as const)('%s replaces the platform height', (size) => {
      render(<Button size={size}>Begin</Button>);
      const classes = classesFor('Begin');

      // shadcn sizes with a fixed `h-*`; the kit's are padding-led, so a button
      // grows with its text rather than clipping it at a larger base size.
      expect(classes).toContain('h-auto');
      expect(classes.some((name) => /^h-\d/.test(name))).toBe(false);
    });

    it('fills its container only when asked', () => {
      const { rerender } = render(<Button>Begin</Button>);
      expect(classesFor('Begin')).not.toContain('w-full');

      rerender(<Button block>Begin</Button>);
      expect(classesFor('Begin')).toContain('w-full');
    });
  });

  describe('what it keeps from the platform component', () => {
    it('still renders as another element with asChild', () => {
      render(
        <Button asChild>
          <a href="/begin">Begin</a>
        </Button>
      );
      const link = screen.getByRole('link', { name: 'Begin' });

      expect(link.tagName).toBe('A');
      expect(link.getAttribute('class')).toContain('rounded-full');
      expect(link.getAttribute('class')).toContain('hover:bg-[var(--color-primary-hover)]');
    });

    it('defaults to type="button", so a form is not submitted by a filter', () => {
      render(<Button>Begin</Button>);
      expect(screen.getByRole('button', { name: 'Begin' })).toHaveAttribute('type', 'button');
    });

    it('keeps the disabled treatment', () => {
      render(<Button disabled>Begin</Button>);
      const button = screen.getByRole('button', { name: 'Begin' });

      expect(button).toBeDisabled();
      expect(button.getAttribute('class')).toContain('disabled:opacity-50');
    });

    it('lets a caller add classes without losing the variant', () => {
      render(<Button className="mt-4">Begin</Button>);
      const classes = classesFor('Begin');

      expect(classes).toContain('mt-4');
      expect(classes).toContain('bg-primary');
    });
  });
});
