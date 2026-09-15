import * as React from 'react';
import { Button, Section, Text } from '@react-email/components';

import { CardLink, LelaneaEmail, styles } from '@/components/app/emails/lelanea-email';
import { BRAND } from '@/lib/brand';

/**
 * The invitation email — what a person is actually being invited to.
 *
 * Registered through `lib/app/emails.ts`; `emails/invitation.tsx` is Sunrise's
 * and is not edited. Takes the platform's `invitation` props unchanged
 * (`EmailPropsMap['invitation']` in `lib/email/registry.ts`).
 *
 * ## Why it is replaced rather than left on the default
 *
 * The platform's version promises "your personalized dashboard" and "start
 * collaborating with your team". Neither exists here: an invitee gets a
 * conversation with a guide, alone, behind a gate that asks them to read what
 * this is and is not. An invitation that describes a different product is
 * worse than a plain one. This matters more, not less, if signup goes
 * invite-only — then it is the first message anyone receives.
 *
 * ## No authored copy in it, deliberately — and no borrowed phrasing either
 *
 * The foundational documents address the person who has already arrived; the
 * Initiation's first line is "Welcome, {{first_name}}." Sending it to someone
 * who has not accepted yet would be greeting them at a door they have not
 * opened, so this stays in the product's own plain register and leaves her
 * words for the welcome that follows acceptance. The one-line description of
 * what this is comes from the product description (§1), not from her prose:
 * lifting a phrase of hers into the build's sentence is the paraphrase the
 * content rule forbids.
 *
 * ## The origin comes from the invitation link
 *
 * The platform does not pass a `baseUrl` for this kind, and the lotus needs an
 * absolute URL. `invitationUrl` is absolute and points at this app, so its
 * origin is the app's origin — read rather than reached for through `env`.
 */

export interface InvitationEmailProps {
  inviterName: string;
  inviteeName: string;
  inviteeEmail: string;
  invitationUrl: string;
  expiresAt: Date;
}

export default function InvitationEmail({
  inviterName,
  inviteeName,
  inviteeEmail,
  invitationUrl,
  expiresAt,
}: InvitationEmailProps): React.ReactElement {
  const baseUrl = new URL(invitationUrl).origin;
  const expiry = new Date(expiresAt).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });

  return (
    <LelaneaEmail
      preview={`${inviterName} has invited you to ${BRAND.name}.`}
      baseUrl={baseUrl}
      reason={`You are receiving this because ${inviterName} invited ${inviteeEmail} to ${BRAND.name}. If you were not expecting it, you can ignore it — nothing is created until you accept.`}
    >
      <Text style={styles.beat} className="lelanea-heading">
        {inviteeName.trim()
          ? `${inviteeName.trim()}, you have been invited.`
          : 'You have been invited.'}
      </Text>

      <Text style={styles.text} className="lelanea-text">
        {inviterName} has invited you to {BRAND.name}, a transcendental-coaching companion built
        around the work of Lelañea Fulton — a conversation with a coach, at your own pace.
      </Text>

      <Text style={styles.text} className="lelanea-text">
        Accepting sets a password for {inviteeEmail}. The first time you open {BRAND.name} you will
        be asked to read what it is and what it is not, and to agree to the terms — and then the
        conversation begins.
      </Text>

      <Section style={styles.buttonRow}>
        <Button href={invitationUrl} style={styles.button}>
          Accept the invitation
        </Button>
      </Section>

      <Text style={styles.small} className="lelanea-muted">
        This invitation expires on {expiry}.
      </Text>
      <Text style={styles.small} className="lelanea-muted">
        If the button does not work, open this link:{' '}
        <CardLink href={invitationUrl}>{invitationUrl}</CardLink>
      </Text>
    </LelaneaEmail>
  );
}
