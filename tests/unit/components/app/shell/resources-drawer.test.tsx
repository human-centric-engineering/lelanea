// @vitest-environment happy-dom

/**
 * The resources panel is a placeholder, and this is what keeps it one.
 *
 * `drawer.test.tsx` covers the panel's chrome — the width, the head, the close
 * control. This file is about the one rule the BODY has to keep: the card and
 * the section structure are t-34's, and the films are **f-resources'**, in
 * phase 3. So the section exists and is honestly empty.
 *
 * The failure mode is specific and it is not a crash. Someone fills the section
 * with two plausible films and a stock thumbnail to "see how it looks", it
 * reads as finished to anyone glancing at a screenshot, and D6's whole point —
 * that the skeleton is visible as a skeleton — is gone. A duration pill and a
 * play button are what that looks like when it happens.
 *
 * @see components/app/shell/resources-drawer.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ResourcesDrawerBody } from '@/components/app/shell/resources-drawer';

describe('ResourcesDrawerBody', () => {
  it('carries her words in the designed card rather than a bare paragraph', () => {
    const { container } = render(<ResourcesDrawerBody />);

    // The italic display face is what makes the opening line hers; the card is
    // what makes it a panel rather than a note.
    const quote = container.querySelector('.brand-quote');
    expect(quote).not.toBeNull();
    expect(quote?.textContent).toMatch(/\S/);
  });

  it('builds the `to watch` section as a real, labelled section', () => {
    render(<ResourcesDrawerBody />);
    // A heading rather than a styled paragraph, so the section exists in the
    // document outline for anyone navigating by heading.
    expect(screen.getByRole('heading', { name: 'to watch' })).toBeTruthy();
  });

  it('says the section is empty instead of leaving a heading over nothing', () => {
    render(<ResourcesDrawerBody />);
    expect(screen.getByText(/Nothing to watch yet/)).toBeTruthy();
  });

  it('invents no film', () => {
    // The three tells, all at once: a duration, a play control, and an image.
    const { container } = render(<ResourcesDrawerBody />);

    expect(container.textContent).not.toMatch(/\d+\s*(min|:\d\d)/i);
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('img, video')).toBeNull();
  });
});
