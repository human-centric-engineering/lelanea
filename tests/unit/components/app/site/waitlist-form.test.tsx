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

/** One name per trigger — the thing the identical pair used to get wrong. */
const HELP_LABELS = [
  'Why we ask where you heard about this',
  'Why we ask what you would want to achieve',
];

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

    it('puts no `disabled` on the fieldset, which is what would reach the ⓘ buttons', () => {
      const { container } = render(<WaitlistForm />);

      // `<fieldset disabled>` propagates to descendant buttons, including the
      // two help popovers. It was the first shape in t-5 and it silently
      // disabled the explanation of WHY we ask for someone's reason for coming.
      const fieldset = container.querySelector('fieldset');
      expect(fieldset).not.toBeNull();
      expect(fieldset?.hasAttribute('disabled')).toBe(false);
    });

    it('no longer claims the form is closed', () => {
      render(<WaitlistForm />);

      expect(screen.queryByText(/not open yet/i)).toBeNull();
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

  it('promises only what the privacy copy promises', () => {
    render(<WaitlistForm />);

    expect(screen.getByText(/No newsletter unless you ask for one/)).toBeTruthy();
    expect(screen.getByText(/remove yourself in one click/)).toBeTruthy();
  });
});
