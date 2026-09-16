// @vitest-environment happy-dom

/**
 * The invitation email — what a person is actually being invited to, with no
 * borrowed prose and none of the platform's promises.
 *
 * @see components/app/emails/invitation.tsx
 */

import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import InvitationEmail from '@/components/app/emails/invitation';
import { BRAND } from '@/lib/brand';

const PROPS = {
  inviterName: 'Simon Holmes',
  inviteeName: 'Maya Reyes',
  inviteeEmail: 'maya@example.com',
  invitationUrl: 'https://example.com/accept-invite?token=abc123',
  expiresAt: new Date('2026-09-22T12:00:00Z'),
};

describe('InvitationEmail', () => {
  it('names who invited whom, and the one action is the invitation link', async () => {
    const html = await render(<InvitationEmail {...PROPS} />);
    expect(html).toContain('Simon Holmes');
    expect(html).toContain('Maya Reyes, you have been invited.');
    expect(html).toContain('maya@example.com');
    expect(html).toContain('Accept the invitation');
    expect(
      (html.match(/href="https:\/\/example\.com\/accept-invite\?token=abc123"/g) ?? []).length
    ).toBe(2);
  });

  it('takes the lotus from the invitation link’s origin, since the platform passes no baseUrl', async () => {
    const html = await render(<InvitationEmail {...PROPS} />);
    expect(html).toContain('src="https://example.com/lotus-mark.png"');
  });

  it('greets without a name when there is none', async () => {
    const html = await render(<InvitationEmail {...PROPS} inviteeName="  " />);
    expect(html).toContain('You have been invited.');
    expect(html).not.toContain(', you have been invited.');
  });

  it('states the expiry, formatted the way the template formats it', async () => {
    // Computed with the same call rather than written out: the template
    // formats in the process's local zone, and a literal date fails at UTC+12,
    // where this instant is already the 23rd. SSR separates adjacent text
    // nodes with `<!-- -->`.
    const html = await render(<InvitationEmail {...PROPS} />);
    const expected = new Date(PROPS.expiresAt).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
    expect(html).toContain(`expires on <!-- -->${expected}`);
  });

  it('says nothing about how sign-in is set up — the accept page does that', async () => {
    // "Accepting sets a password for …" was false once the page offered Google,
    // and it made the next sentence read as "asked what [the password] is".
    const html = await render(<InvitationEmail {...PROPS} />);
    expect(html.toLowerCase()).not.toContain('password');
    // The first-time-open sentence stands alone, and comes before the action.
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const firstOpen = text.indexOf('The first time you open');
    const action = text.indexOf('Accept the invitation');
    expect(firstOpen).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(firstOpen);
  });

  it('promises nothing the product does not have', async () => {
    const html = await render(<InvitationEmail {...PROPS} />);
    for (const phrase of ['dashboard', 'collaborating', 'your team', 'excited to have you']) {
      expect(html.toLowerCase()).not.toContain(phrase);
    }
  });

  it('borrows none of her prose', async () => {
    // The Initiation's phrasing belongs to the welcome that follows acceptance.
    // A line lifted from it into the build's sentence is the paraphrase the
    // content rule forbids; pin the one that was nearly shipped.
    const html = await render(<InvitationEmail {...PROPS} />);
    expect(html).not.toContain('relationship you have with yourself');
    expect(html).not.toContain('{{first_name}}');
  });

  it('says why the person is receiving it, and that ignoring it creates nothing', async () => {
    const html = await render(<InvitationEmail {...PROPS} />);
    expect(html).toContain('nothing is created until you accept');
    expect(html).toContain(BRAND.legalName);
  });
});
