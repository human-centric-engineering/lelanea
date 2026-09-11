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
