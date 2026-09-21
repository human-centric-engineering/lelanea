// @vitest-environment happy-dom

/**
 * The frame every destination renders inside.
 *
 * What is worth pinning is the part a reader depends on and nobody looks at:
 * the shell had no `<main>` and no `<h1>` until this component, so a reader on
 * a view had nothing to skip to and no heading naming the page. Both are
 * structural, both are invisible in a screenshot, and both are the kind of
 * thing a later refactor drops while the page still looks right.
 *
 * @see components/app/views/view.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { View } from '@/components/app/views/view';

describe('the landmark and the heading', () => {
  it('gives the view a main landmark', () => {
    render(<View eyebrow="settings" title="How she speaks to you" />);
    expect(screen.getByRole('main')).toBeTruthy();
  });

  it('names the page with the one top-level heading', () => {
    render(<View eyebrow="settings" title="How she speaks to you" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('How she speaks to you');
  });

  it('leaves the eyebrow out of the heading outline', () => {
    // It LABELS the h1 directly under it. Promoting it would put two headings
    // where the design shows one, and make every view announce its own name
    // twice to anyone navigating by heading.
    render(<View eyebrow="settings" title="How she speaks to you" />);
    expect(screen.getAllByRole('heading')).toHaveLength(1);
    expect(screen.getByText('settings').tagName).toBe('P');
  });
});

describe('the optional lines', () => {
  it('renders the lede and the note when given', () => {
    render(<View eyebrow="a" title="b" lede="the lede" note="the note" />);
    expect(screen.getByText('the lede')).toBeTruthy();
    expect(screen.getByText('the note')).toBeTruthy();
  });

  it('renders neither when they are absent, rather than an empty line', () => {
    // An empty `<p>` still takes the flex gap above and below it, so a view
    // without a lede would be spaced as though it had one.
    const { container } = render(<View eyebrow="a" title="b" />);
    expect(container.querySelectorAll('p')).toHaveLength(1); // the eyebrow only
  });
});

describe('what it wraps', () => {
  it('puts the children after the head', () => {
    render(
      <View eyebrow="a" title="b">
        <div data-testid="body" />
      </View>
    );
    const main = screen.getByRole('main');
    const heading = screen.getByRole('heading', { level: 1 });
    expect(
      heading.compareDocumentPosition(screen.getByTestId('body')) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(main.contains(screen.getByTestId('body'))).toBe(true);
  });
});

describe('the centred column (t-73)', () => {
  it('is off unless a view asks for it', () => {
    // The default is what every view before `/app/notes` renders as, and a
    // change of default here would silently re-lay-out six pages.
    render(<View eyebrow="a" title="b" />);
    const main = screen.getByRole('main');
    expect(main.className).not.toMatch(/mx-auto/);
    expect(main.className).not.toMatch(/max-w-/);
  });

  it('moves the whole page, head included, rather than just the body', () => {
    render(
      <View column eyebrow="a" title="b" lede="c">
        <div data-testid="body" />
      </View>
    );
    const main = screen.getByRole('main');
    // The cap is on `<main>`, so the title and the lede travel with the
    // content. Centring the body alone puts the page on two axes, which is
    // the thing this prop exists to avoid.
    expect(main.className).toMatch(/mx-auto/);
    expect(main.className).toMatch(/max-w-\[54rem\]/);
    expect(main.contains(screen.getByRole('heading', { level: 1 }))).toBe(true);
    expect(main.contains(screen.getByTestId('body'))).toBe(true);
  });

  it('keeps `w-full` beside the cap', () => {
    // Without it a flex or grid parent sizes the column to its content and
    // `mx-auto` then centres something narrower than the reader asked for.
    render(<View column eyebrow="a" title="b" />);
    expect(screen.getByRole('main').className).toMatch(/w-full/);
  });
});
