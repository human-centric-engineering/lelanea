// @vitest-environment happy-dom

/**
 * The right rail — a deliberate stub, and the test that keeps it deliberate.
 *
 * The two buttons open drawers `t-10` builds, so between that merge and this
 * one they do nothing. `B31` allows exactly three honest responses to that, and
 * the one taken here is the middle one: ship a stub that says what it is.
 *
 * The reason this needs a test rather than a comment is the failure mode of the
 * other two options. If `disabled` is ever dropped — by someone tidying, or by
 * `t-10` wiring one button and forgetting the other — the rail silently becomes
 * `B31`'s dishonest fourth option: a control that looks live, accepts the click,
 * and does nothing. Nothing about that fails a type-check or a screenshot.
 *
 * @see components/app/shell/shell-rail.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShellRail } from '@/components/app/shell/shell-rail';

describe('ShellRail', () => {
  it('is the fourth column, present and labelled', () => {
    render(<ShellRail />);
    expect(screen.getByRole('navigation', { name: 'Panels' })).toBeTruthy();
  });

  it('offers the map and the resources', () => {
    render(<ShellRail />);
    expect(screen.getByRole('button', { name: /Your map/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Resources/ })).toBeTruthy();
  });

  it('leaves neither button clickable while it opens nothing', () => {
    render(<ShellRail />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('says why somewhere a person can actually reach', () => {
    // The explanation used to be a `title` on the button itself, which renders
    // NOWHERE: browsers suppress pointer events on a disabled control, so the
    // tooltip never fired on hover, and a disabled button is out of the tab
    // order, so assistive technology never reached it either. The stub's claim
    // to be honest rather than broken rested on a string nobody could read.
    //
    // So both routes are asserted: the hover tooltip on the enabled wrapper,
    // and the reason inside the button's own accessible name.
    render(<ShellRail />);

    for (const button of screen.getAllByRole('button')) {
      expect(button.getAttribute('aria-label')).toMatch(/arrives with the drawers/);

      const wrapper = button.parentElement;
      expect(wrapper?.getAttribute('title')).toMatch(/arrives with the drawers/);
      // The wrapper must NOT be disabled, or it swallows the hover exactly as
      // the button did.
      expect(wrapper?.hasAttribute('disabled')).toBe(false);
    }
  });
});
