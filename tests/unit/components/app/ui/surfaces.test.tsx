// @vitest-environment happy-dom

/**
 * Card, Chip, Banner and Eyebrow — the four kit components that are markup
 * rather than motion.
 *
 * They are together in one file because the interesting cases are the same
 * question asked four times: **what did we deliberately not copy from the kit?**
 * The kit is a mobile prototype, so each of the four carries something that is
 * right in a preview card and wrong in a product — a clickable `<div>`, a
 * selected state with no accessible name, a banner nobody is told about, a
 * light-mode-only palette. Those are the assertions worth having; that a `<div>`
 * renders its children is not.
 *
 * @see components/app/ui/
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Banner } from '@/components/app/ui/banner';
import { Card } from '@/components/app/ui/card';
import { Chip } from '@/components/app/ui/chip';
import { Eyebrow } from '@/components/app/ui/eyebrow';

describe('Card', () => {
  it('renders the four slots §6.6 gives it', () => {
    render(
      <Card eyebrow="yesterday" title="What you brought in" meta="4 min · yesterday">
        A body.
      </Card>
    );

    expect(screen.getByText('yesterday')).toBeInTheDocument();
    expect(screen.getByText('What you brought in')).toBeInTheDocument();
    expect(screen.getByText('A body.')).toBeInTheDocument();
    expect(screen.getByText('4 min · yesterday')).toBeInTheDocument();
  });

  it('omits a slot rather than rendering an empty one', () => {
    // An empty `<div>` with a bottom margin is invisible and still takes space,
    // which is how a card with no eyebrow ends up looking mis-aligned against
    // one that has one.
    const { container } = render(<Card>Just a body.</Card>);
    expect(container.querySelectorAll('div')).toHaveLength(2);
  });

  it('carries a border in BOTH themes, because the token does the branching', () => {
    // The kit takes a `dark` prop and draws the border only when it is set. A
    // component that has to be told which theme it is in can be told wrong —
    // and cannot be right inside a dark island on a light page. Here the border
    // is unconditional and `--color-card-border` is transparent in light mode.
    render(<Card title="Anything" />);
    const classes = screen.getByText('Anything').parentElement?.className ?? '';

    expect(classes).toContain('border');
    expect(classes).toContain('border-[var(--color-card-border)]');
    expect(classes).not.toContain('dark:');

    // Written as a `var()` and NOT as `border-card-border`, which is what this
    // case used to assert. That class compiled to nothing — the token lives in
    // `app/brand-theme.css`, which is unlayered and generates no utilities — so
    // the border colour fell through to the global `*` rule and every card wore
    // a 24% hairline in light mode, the one thing §6.4 rules out. A class-name
    // assertion cannot tell a utility that exists from one that does not, which
    // is why the general rule lives in `tokens-only.test.ts` and this line only
    // pins the shape.
    expect(classes).not.toMatch(/(^|\s)border-card-border(\s|$)/);
  });

  it('takes §6.4 radius and elevation from the scale, not from a literal', () => {
    // `rounded-lg` is 20px on a consumer page because `app/brand-theme.css`
    // restates Tailwind's scale at the design's values. Writing `rounded-[20px]`
    // would be correct today and would stop following the design tomorrow.
    render(<Card title="Anything" />);
    const classes = screen.getByText('Anything').parentElement?.className ?? '';

    expect(classes).toContain('rounded-lg');
    expect(classes).toContain('shadow-[var(--shadow-rest)]');
  });

  it('sets the title in the display register', () => {
    render(<Card title="What you brought in" />);
    expect(screen.getByText('What you brought in').className).toContain('brand-display');
  });

  it('is not a clickable div', () => {
    // Deliberate: the kit's `onClick` produces a div with a pointer cursor, no
    // focus, no role and no keyboard activation. An actionable card should hold
    // a real control, so the accessible name is the thing being actioned rather
    // than every word in the card.
    render(<Card title="Anything" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('Chip', () => {
  it('is a button that will not submit the form it sits in', () => {
    // A chip is very often a filter inside a form, where the HTML default of
    // `submit` posts the page the moment you filter it.
    render(<Chip>Grief</Chip>);
    expect(screen.getByRole('button', { name: 'Grief' })).toHaveAttribute('type', 'button');
  });

  it('says whether it is selected, rather than only showing it', () => {
    // WCAG 1.4.1 — the kit carries the selected state in the fill alone, so a
    // screen-reader user is told nothing. This is also why `--color-selected`
    // had to be a colour that reads rather than a tint that decorates.
    const { rerender } = render(<Chip>Grief</Chip>);
    expect(screen.getByRole('button', { name: 'Grief' })).toHaveAttribute('aria-pressed', 'false');

    rerender(<Chip selected>Grief</Chip>);
    expect(screen.getByRole('button', { name: 'Grief' })).toHaveAttribute('aria-pressed', 'true');
  });

  it.each([
    ['default', 'bg-card'],
    ['teal', 'bg-secondary'],
  ] as const)('%s tone fills with %s', (tone, fill) => {
    render(<Chip tone={tone}>Grief</Chip>);
    expect(screen.getByRole('button', { name: 'Grief' }).className).toContain(fill);
  });

  it('lets selected win over tone', () => {
    // The two answer different questions — what kind of thing this is, and
    // whether you have picked it — and at a glance the second is the one that
    // has to be legible. An active teaching you have selected reads as selected.
    render(
      <Chip tone="teal" selected>
        Grief
      </Chip>
    );
    const classes = screen.getByRole('button', { name: 'Grief' }).className;

    expect(classes).toContain('bg-[var(--color-selected)]');
    expect(classes).not.toContain('bg-secondary');
  });

  it('hovers to a token on every filled state', () => {
    render(
      <>
        <Chip tone="teal">Teal</Chip>
        <Chip selected>Selected</Chip>
      </>
    );

    expect(screen.getByRole('button', { name: 'Teal' }).className).toContain(
      'hover:bg-[var(--color-secondary-hover)]'
    );
    expect(screen.getByRole('button', { name: 'Selected' }).className).toContain(
      'hover:bg-[var(--color-selected-hover)]'
    );
  });

  it('gets the same offset focus outline as Button', () => {
    // Same reasoning: a selected chip's fill and the focus ring are both brand
    // colours, so a flush ring is a chip that grew by a pixel. And the same
    // silent failure — `outline-none` without `outline-solid` paints nothing.
    render(<Chip selected>Grief</Chip>);
    const classes = screen.getByRole('button', { name: 'Grief' }).className.split(/\s+/);

    expect(classes).toContain('focus-visible:outline-solid');
    expect(classes).toContain('focus-visible:outline-offset-2');
    expect(classes).not.toContain('focus-visible:outline-none');
  });
});

describe('Banner', () => {
  it.each(['success', 'error', 'warning', 'info'] as const)(
    '%s reads its trio from tokens',
    (tone) => {
      // The kit hard-codes twelve light-mode hexes here and has no dark values, so
      // a banner on a charcoal page painted a pale wash with dark text on it.
      // Routing each tone through a `-bg`/`-ink` trio makes the whole component
      // mode-aware without knowing what a mode is.
      render(<Banner tone={tone}>Something happened.</Banner>);
      const banner = screen.getByText('Something happened.').closest('[data-tone]');

      expect(banner).toHaveAttribute('data-tone', tone);
      expect(banner?.className).toContain(`bg-[var(--color-status-${bandFor(tone)}-bg)]`);
      expect(banner?.className).toContain(`text-[var(--color-status-${bandFor(tone)}-ink)]`);
    }
  );

  it('interrupts for an error and waits its turn for everything else', () => {
    // A banner appears after the page has been read, so a screen-reader user is
    // told nothing at all unless it has a live role — the kit had neither. How
    // loudly is the tone's business: an error is worth interrupting for.
    const { rerender } = render(<Banner tone="error">Something didn’t land.</Banner>);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(<Banner tone="success">Saved.</Banner>);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sets the lead phrase apart without shouting it', () => {
    // §6.10: sentence case, no exclamation, medium rather than bold — §6.3 caps
    // the family at 600 and this is 500.
    render(<Banner lead="Something didn’t land.">Try that once more.</Banner>);
    const lead = screen.getByText(/Something didn’t land\./);

    expect(lead.tagName).toBe('STRONG');
    expect(lead.className).toContain('font-medium');
  });

  it('hides the dot, which repeats what the text already says', () => {
    // And it is why the tone is not carried by colour alone (WCAG 1.4.1): the
    // words are the message, the dot and the edge are emphasis.
    const { container } = render(<Banner tone="info">Anything.</Banner>);
    const dot = container.querySelector('span');

    expect(dot).toHaveAttribute('aria-hidden', 'true');
    expect(dot?.className).toContain('rounded-full');
  });

  it('defaults to info, the quietest of the four', () => {
    render(<Banner>Anything.</Banner>);
    expect(screen.getByText('Anything.').closest('[data-tone]')).toHaveAttribute(
      'data-tone',
      'info'
    );
  });
});

describe('Eyebrow', () => {
  it('supplies the tracking AND the ink', () => {
    // The `.brand-eyebrow` class deliberately carries no colour — the stylesheet
    // is unlayered, so a `color` there could not be overridden by any utility.
    // Which means every eyebrow in the product would otherwise repeat
    // `text-muted-foreground`, and the one that forgets reads as a heading.
    render(<Eyebrow>welcome</Eyebrow>);
    const classes = screen.getByText('welcome').className;

    expect(classes).toContain('brand-eyebrow');
    expect(classes).toContain('text-muted-foreground');
  });

  it('does not force casing', () => {
    // §6.10 says eyebrows MAY be lowercase, and `text-transform: lowercase`
    // would strip the capital from Lelañea's name wherever one carries it.
    render(<Eyebrow>About Lelañea</Eyebrow>);

    expect(screen.getByText('About Lelañea').textContent).toBe('About Lelañea');
    expect(screen.getByText('About Lelañea').className).not.toContain('lowercase');
  });

  it('renders as the element the layout needs', () => {
    const { rerender } = render(<Eyebrow>welcome</Eyebrow>);
    expect(screen.getByText('welcome').tagName).toBe('SPAN');

    rerender(<Eyebrow as="div">welcome</Eyebrow>);
    expect(screen.getByText('welcome').tagName).toBe('DIV');
  });

  it('keeps a caller’s classes alongside its own', () => {
    render(<Eyebrow className="mb-2">welcome</Eyebrow>);
    const classes = screen.getByText('welcome').className;

    expect(classes).toContain('mb-2');
    expect(classes).toContain('brand-eyebrow');
  });
});

/** Which palette band a banner tone reads from. */
function bandFor(tone: 'success' | 'error' | 'warning' | 'info'): string {
  return { success: 'green', error: 'red', warning: 'yellow', info: 'blue' }[tone];
}
