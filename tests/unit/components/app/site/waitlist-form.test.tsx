// @vitest-environment happy-dom

/**
 * The waitlist card is inert, and is meant to be (t-5).
 *
 * This is a B31 deliberate stub: the route it will post to, the model and the
 * admin view are t-7 and t-8. The failure mode it guards against is the one
 * that looks like success — a form that accepts an email, appears to submit,
 * and drops it. Someone would believe they had joined the waitlist.
 *
 * So the assertions are about ABSENCE of a submission path as much as presence
 * of the fields, and they are written to fail the moment somebody enables the
 * controls without wiring the route. When t-7 lands, this file is the thing
 * that has to change on purpose — which is the point of writing it now.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WaitlistForm } from '@/components/app/site/waitlist-form';
import { LAUNCH_WINDOW, WAITLIST_ANCHOR } from '@/lib/site/config';

/** One name per trigger — the thing the identical pair used to get wrong. */
const HELP_LABELS = [
  'Why we ask where you heard about this',
  'Why we ask what you would want to achieve',
];

describe('WaitlistForm', () => {
  describe('while the waitlist is not open', () => {
    it('disables every entry control, so nothing can be typed or sent', () => {
      const { container } = render(<WaitlistForm />);

      // Population first: the fields exist, which is what makes "all disabled"
      // a real statement rather than one about an empty form.
      const controls = container.querySelectorAll('input, textarea, button[type="submit"]');
      expect(controls.length).toBeGreaterThanOrEqual(5);

      for (const control of controls) {
        expect(
          (control as HTMLInputElement).disabled,
          `${(control as HTMLInputElement).name || 'submit'} is not disabled`
        ).toBe(true);
      }
    });

    it('leaves the ⓘ explanations openable, so the reason can still be read', () => {
      render(<WaitlistForm />);

      // The first shape here wrapped everything in `<fieldset disabled>`, which
      // a browser propagates to descendant buttons — silently disabling the two
      // popovers that explain why we ask for someone's reason for coming, for
      // the whole period before the form opens. Nothing failed; the ⓘ simply
      // did not respond. Own-attribute `disabled` on the entry controls is what
      // keeps this true, so this case is what stops a tidy-up reinstating it.
      const help = HELP_LABELS.map((name) => screen.getByRole('button', { name }));
      expect(help).toHaveLength(2);
      for (const button of help) {
        expect(button).not.toBeDisabled();
      }
    });

    it('puts no `disabled` on the fieldset, which is what would reach the ⓘ buttons', () => {
      const { container } = render(<WaitlistForm />);

      const fieldset = container.querySelector('fieldset');
      expect(fieldset).not.toBeNull();
      expect(fieldset?.hasAttribute('disabled')).toBe(false);
    });

    it('has no submission path at all — no action, no method', () => {
      const { container } = render(<WaitlistForm />);
      const form = container.querySelector('form');

      expect(form).not.toBeNull();
      // A form with an `action` would post on submit even with a disabled
      // button, if a control were ever re-enabled without revisiting this.
      expect(form?.getAttribute('action')).toBeNull();
      expect(form?.getAttribute('method')).toBeNull();
    });

    it('says why, in the words the design uses rather than a generic notice', () => {
      render(<WaitlistForm />);

      expect(screen.getByText(new RegExp(`opening in small groups from`))).toBeTruthy();
      // EVERY regex metacharacter is escaped, not just the brackets
      // `[LAUNCH WINDOW]` happens to contain today. CodeQL flagged the narrow
      // version as incomplete escaping and was right: the whole point of this
      // constant is that it changes, and the first value containing a `.` or a
      // `?` would turn this assertion into a looser match that still passed.
      expect(
        screen.getByText(new RegExp(LAUNCH_WINDOW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      ).toBeTruthy();
    });

    it('tells assistive technology the group is unavailable, which `disabled` alone does not', () => {
      render(<WaitlistForm />);

      expect(screen.getByText(/not open yet/i)).toBeTruthy();
    });
  });

  describe('the fields D2 specified', () => {
    it.each([
      ['Your email', 'email'],
      ['Your name', 'name'],
      ['Where did you hear about this?', 'source'],
      ['What would you want to achieve?', 'why'],
    ])('asks for %s', (label, name) => {
      const { container } = render(<WaitlistForm />);

      expect(screen.getByText(label)).toBeTruthy();
      expect(container.querySelector(`[name="${name}"]`)).not.toBeNull();
    });

    it('marks the three optional ones optional, and the email not', () => {
      render(<WaitlistForm />);

      // D2: email required, the rest optional. Three labels carry the word.
      expect(screen.getAllByText('optional')).toHaveLength(3);
    });

    it('offers the ⓘ explanation on the two fields that ask for something personal', () => {
      render(<WaitlistForm />);

      for (const name of HELP_LABELS) {
        expect(screen.getByRole('button', { name })).toBeTruthy();
      }
    });

    it('gives each ⓘ trigger its own accessible name', () => {
      render(<WaitlistForm />);

      // Both said "Why we ask this", which is two identically named buttons on
      // one page: a screen-reader user navigating by control cannot tell which
      // field either belongs to, and the distinguishing text lives in the
      // popover, announced only after activation.
      expect(new Set(HELP_LABELS).size).toBe(HELP_LABELS.length);
      expect(screen.queryAllByRole('button', { name: 'Why we ask this' })).toHaveLength(0);
    });
  });

  it('carries the id the header CTA scrolls to', () => {
    const { container } = render(<WaitlistForm />);

    // If these drift apart the button still "works" — it navigates home and
    // lands nowhere in particular, with nothing to notice.
    expect(container.querySelector('form')?.id).toBe(WAITLIST_ANCHOR);
  });

  it('promises only what the privacy copy promises', () => {
    render(<WaitlistForm />);

    expect(screen.getByText(/No newsletter unless you ask for one/)).toBeTruthy();
    expect(screen.getByText(/remove yourself in one click/)).toBeTruthy();
  });
});
