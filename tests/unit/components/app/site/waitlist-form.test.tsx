// @vitest-environment happy-dom

/**
 * The waitlist card is live (t-7).
 *
 * t-5 shipped it as a deliberate stub and this file asserted the ABSENCE of a
 * submission path, so that nobody could enable the controls without wiring the
 * route. t-7 is the change that was meant to rewrite it: the route, the model
 * and the erasure path exist, so the assertions invert — the controls work, the
 * post happens, and the failure this file now guards is the mirror image of the
 * old one. Someone must not be told they are on the list when nothing was
 * written.
 *
 * @see components/app/site/waitlist-form.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', () => ({
  apiClient: { post },
  APIClientError: class APIClientError extends Error {},
}));

import { WaitlistForm } from '@/components/app/site/waitlist-form';
import { WAITLIST_ENDPOINT } from '@/lib/app/waitlist/endpoint';
import { LAUNCH_WINDOW, WAITLIST_ANCHOR } from '@/lib/site/config';

/**
 * One name per trigger — the thing the identical pair used to get wrong — and a
 * line from each popover's body, so operability can be asserted by what the
 * reader actually gets rather than by the button still being in the tree.
 */
const HELP_TRIGGERS = [
  {
    label: 'Why we ask where you heard about this',
    body: /It tells her which of the places she shows up actually reaches people/,
  },
  {
    label: 'Why we ask what you would want to achieve',
    body: /It is how she can tell what the app is getting wrong/,
  },
];
const HELP_LABELS = HELP_TRIGGERS.map((trigger) => trigger.label);

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ message: 'You are on the list.' });
});

describe('WaitlistForm', () => {
  describe('now that the waitlist is open', () => {
    it('leaves every entry control usable', async () => {
      const { container } = render(<WaitlistForm />);

      // Population first: "none are disabled" says nothing about an empty form.
      const controls = container.querySelectorAll('input, textarea, button[type="submit"]');
      expect(controls.length).toBeGreaterThanOrEqual(5);

      for (const control of controls) {
        const element = control as HTMLInputElement;
        expect(element.disabled, `${element.name || 'submit'} is disabled`).toBe(false);
      }
    });

    it('stands nothing down with a `disabled` fieldset, which is what would reach the ⓘ buttons', () => {
      const { container } = render(<WaitlistForm />);

      // `<fieldset disabled>` propagates to descendant buttons, including the
      // two help popovers. It was the first shape in t-5 and it silently
      // disabled the explanation of WHY we ask for someone's reason for coming.
      //
      // t-20 removed the fieldset entirely, so this asserts the TRAP is absent
      // rather than that one particular element is clean — it keeps holding if
      // a grouping element is ever reintroduced, which the old shape of this
      // test (which required a fieldset to exist) would not have.
      expect(container.querySelectorAll('fieldset[disabled]')).toHaveLength(0);
    });

    it('no longer claims the form is closed', () => {
      render(<WaitlistForm />);

      expect(screen.queryByText(/not open yet/i)).toBeNull();
    });

    it('names the card once for a screen reader, not once per wrapper', () => {
      const { container } = render(<WaitlistForm />);

      // Three announcements before t-20: the visible <h2>, a sr-only <legend>
      // inside the fieldset, and the submit button. t-5's legend earned its
      // announcement — it carried "Waitlist sign-up, not open yet", the only
      // thing saying WHY the controls were inert — but t-7 made the form live
      // and replaced that sentence with a copy of the heading.
      expect(screen.getAllByRole('heading', { name: 'Join the waitlist' })).toHaveLength(1);
      expect(screen.getAllByRole('button', { name: 'Join the waitlist' })).toHaveLength(1);

      // The button's name is the ACTION's and is the design's own word, so it
      // stays. What must not come back is a second LABEL for the same card.
      expect(container.querySelectorAll('legend')).toHaveLength(0);
    });

    it('still says when the first groups open, in the design’s words', () => {
      render(<WaitlistForm />);

      expect(screen.getByText(/opening in small groups from/)).toBeTruthy();
      // EVERY regex metacharacter is escaped, not just the brackets
      // `[LAUNCH WINDOW]` happens to contain today: the whole point of the
      // constant is that it changes, and the first value containing a `.` or a
      // `?` would turn this into a looser match that still passed.
      expect(
        screen.getByText(new RegExp(LAUNCH_WINDOW.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      ).toBeTruthy();
    });
  });

  describe('joining', () => {
    it('posts the four answers to the waitlist route', async () => {
      const user = userEvent.setup();
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.type(screen.getByLabelText('Your name'), 'Ada');
      await user.type(screen.getByLabelText('Where did you hear about this?'), 'a friend');
      await user.type(screen.getByLabelText('What would you want to achieve?'), 'to slow down');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post).toHaveBeenCalledWith(WAITLIST_ENDPOINT, {
        body: expect.objectContaining({
          email: 'ada@example.com',
          name: 'Ada',
          heardFrom: 'a friend',
          intent: 'to slow down',
        }),
      });
    });

    it('replaces the card with the confirmation, naming the address', async () => {
      const user = userEvent.setup();
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      expect(await screen.findByText('you are on the list')).toBeTruthy();
      expect(screen.getByText(/Rest here for a moment before you go/)).toBeTruthy();
      expect(screen.getByText(/We will write to ada@example.com when a place opens/)).toBeTruthy();
      // The form is gone, so a second submission is not possible from here.
      expect(screen.queryByRole('button', { name: 'Join the waitlist' })).toBeNull();
    });

    it('announces the confirmation, which replacing a form silently would not', async () => {
      const user = userEvent.setup();
      const { container } = render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      const confirmation = await screen.findByRole('status');
      expect(confirmation).toBeTruthy();
      // The heading the reader was on has just been removed from under them.
      // Without focus moving, the outcome of the only action on the page is
      // announced to nobody.
      expect(container.ownerDocument.activeElement).toBe(confirmation);
    });

    it('keeps the anchor on whatever is rendered, so the header CTA still lands', async () => {
      const user = userEvent.setup();
      const { container } = render(<WaitlistForm />);

      expect(container.querySelector('form')?.id).toBe(WAITLIST_ANCHOR);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      // A fragment that matches no element does not error — it silently lands
      // the reader at the top of the page.
      await waitFor(() => expect(container.querySelector(`#${WAITLIST_ANCHOR}`)).not.toBeNull());
    });

    it('does NOT link "Look inside the app" from the confirmation', async () => {
      const user = userEvent.setup();
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      await screen.findByText('you are on the list');
      // The prototype ends the confirmation with a ghost button to `#/app`.
      // `/app` is behind the auth gate and the app is not open, so it would send
      // someone who has just been told to rest to a login they cannot complete.
      expect(screen.queryByRole('link', { name: /look inside/i })).toBeNull();
    });
  });

  describe('when something goes wrong', () => {
    it('refuses an incomplete email in its own register, and posts nothing', async () => {
      const user = userEvent.setup();
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'not-an-email');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      expect(
        await screen.findByText(
          'That email address does not look complete. Check it and try once more.'
        )
      ).toBeTruthy();
      expect(post).not.toHaveBeenCalled();
      // Not the submission-failed line: a bad address is the reader's to fix and
      // a failed request is not, and telling someone with a perfectly good
      // address that their address is wrong is the collapse worth avoiding.
      expect(screen.queryByText(/Something didn't land/)).toBeNull();
    });

    it('flags an over-long optional answer on the field itself', async () => {
      const user = userEvent.setup();
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      // Pasted rather than typed: `user.type` would fire 201 change events.
      await user.click(screen.getByLabelText('Where did you hear about this?'));
      await user.paste('x'.repeat(201));
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      const field = screen.getByLabelText('Where did you hear about this?');
      expect(await screen.findByText(/Please keep this under 200 characters/)).toBeTruthy();
      // The message alone is not enough: without `aria-invalid` and the
      // `aria-describedby` link, a screen-reader user reaches the field, is told
      // nothing is wrong, and never hears the sentence sitting under it.
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe('wl-source-error');
      expect(post).not.toHaveBeenCalled();
    });

    it('leaves an untouched field unmarked, so the attributes mean something', () => {
      render(<WaitlistForm />);

      // The other half of the case above. `aria-invalid` permanently set would
      // announce every field as broken, which is the same as announcing none.
      const field = screen.getByLabelText('Where did you hear about this?');
      expect(field.getAttribute('aria-invalid')).toBeNull();
      expect(field.getAttribute('aria-describedby')).toBeNull();
    });

    it('shows the submission-failed banner when the request fails', async () => {
      const user = userEvent.setup();
      post.mockRejectedValue(new Error('offline'));
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toContain("Something didn't land.");
      expect(alert.textContent).toContain('Try that once more.');
    });

    it('does NOT claim they are on the list when the request failed', async () => {
      const user = userEvent.setup();
      post.mockRejectedValue(new Error('offline'));
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      await screen.findByRole('alert');
      // The failure that looks like success, and the reason t-5 shipped this
      // card inert at all: somebody believing they had joined when nothing was
      // written. The form must still be there, with what they typed in it.
      expect(screen.queryByText('you are on the list')).toBeNull();
      expect(screen.getByLabelText('Your email')).toHaveValue('ada@example.com');
    });

    it('clears the banner when they try again', async () => {
      const user = userEvent.setup();
      post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ message: 'ok' });
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));
      await screen.findByRole('alert');

      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      expect(await screen.findByText('you are on the list')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  describe('the honeypot', () => {
    it('is sent along, so the server can decide', async () => {
      const user = userEvent.setup();
      render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));

      await waitFor(() => expect(post).toHaveBeenCalled());
      // The client schema accepts any value on purpose: rejecting a filled
      // honeypot here would tell the bot which field it is.
      const [, options] = post.mock.calls[0] as [string, { body: Record<string, unknown> }];
      expect(options.body).toHaveProperty('website');
    });

    it('is hidden from sight, from the keyboard and from assistive technology', () => {
      const { container } = render(<WaitlistForm />);

      const honeypot = container.querySelector<HTMLInputElement>('input[name="website"]');
      expect(honeypot).not.toBeNull();
      expect(honeypot?.tabIndex).toBe(-1);
      expect(honeypot?.closest('[aria-hidden="true"]')).not.toBeNull();
    });
  });

  describe('the fields D2 specified', () => {
    it.each([
      ['Your email', 'email'],
      ['Your name', 'name'],
      ['Where did you hear about this?', 'heardFrom'],
      ['What would you want to achieve?', 'intent'],
    ])('asks for %s and posts it as `%s`', (label, name) => {
      const { container } = render(<WaitlistForm />);

      expect(screen.getByText(label)).toBeTruthy();
      // The `name` is the payload key the route validates against, so a rename
      // on either side is a silently dropped answer rather than an error.
      expect(container.querySelector(`[name="${name}"]`)).not.toBeNull();
    });

    it('marks the three optional ones optional, and the email not', () => {
      render(<WaitlistForm />);

      expect(screen.getAllByText('optional')).toHaveLength(3);
    });

    it('offers the ⓘ explanation on the two fields that ask for something personal', () => {
      render(<WaitlistForm />);

      for (const name of HELP_LABELS) {
        expect(screen.getByRole('button', { name })).toBeTruthy();
      }
    });

    it.each(HELP_TRIGGERS)(
      'opens the $label popover when it is activated',
      async ({ label, body }) => {
        const user = userEvent.setup();
        render(<WaitlistForm />);

        // Present is not the same as operable, and the difference is exactly the
        // failure mode a `disabled` fieldset ancestor produces: the button is
        // still in the tree, still named, and does nothing. `button.disabled`
        // would not catch it either — the IDL property reflects the ATTRIBUTE,
        // not the state inherited from a fieldset. Only activating it does.
        await user.click(screen.getByRole('button', { name: label }));

        expect(await screen.findByText(body)).toBeTruthy();
      }
    );

    it('keeps both ⓘ popovers operable WHILE a submission is in flight', async () => {
      const user = userEvent.setup();
      let release: ((value: unknown) => void) | undefined;
      post.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      );
      const { container } = render(<WaitlistForm />);

      await user.type(screen.getByLabelText('Your email'), 'ada@example.com');
      await user.click(screen.getByRole('button', { name: 'Join the waitlist' }));
      await screen.findByRole('button', { name: 'Joining…' });

      // Every other guard in this file renders the form AT REST, where
      // `isSubmitting` is false. That is the hole: the natural way to
      // reintroduce the trap is `<fieldset disabled={isSubmitting}>`, and React
      // emits no `disabled` attribute at all while the value is false — so it
      // would pass all of them, then disable both ⓘ buttons for exactly as long
      // as the request is in flight. This is the assertion taken at the one
      // moment the attribute would actually exist.
      expect(container.querySelectorAll('fieldset[disabled]')).toHaveLength(0);

      const { label, body } = HELP_TRIGGERS[0];
      await user.click(screen.getByRole('button', { name: label }));
      expect(await screen.findByText(body)).toBeTruthy();

      release?.({ message: 'ok' });
      expect(await screen.findByText('you are on the list')).toBeTruthy();
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

  it('promises only what the product can actually do', () => {
    render(<WaitlistForm />);

    expect(screen.getByText(/No newsletter unless you ask for one/)).toBeTruthy();
    expect(
      screen.getByText(/every email we send will have a one-click way off the list/)
    ).toBeTruthy();
  });

  it('does NOT claim a removal that exists nowhere', () => {
    render(<WaitlistForm />);

    // This paragraph is the notice `consentedAt` records agreement to. The
    // prototype's "you can remove yourself in one click" was decorative while
    // the card was inert and became a false claim the moment it went live —
    // there is no unsubscribe route, no token, no email (A8) and no contact
    // page. The promise now attaches to the email that will carry it.
    expect(screen.queryByText(/remove yourself in one click/)).toBeNull();
  });
});
