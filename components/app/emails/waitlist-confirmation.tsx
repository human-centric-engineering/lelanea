import * as React from 'react';
import { Text } from '@react-email/components';

import { LelaneaEmail, styles } from '@/components/app/emails/lelanea-email';
import { paragraphRange, requireDocument } from '@/lib/app/content/sections';
import { BRAND } from '@/lib/brand';

/**
 * The waitlist confirmation — the one email a joiner gets, and the whole of it.
 *
 * Not a platform kind: `lib/email/registry.ts` has no waitlist email to
 * override, so this is sent by `lib/app/waitlist/confirmation.ts` directly,
 * from the route, after the response has gone. It reverses **A8** ("no email is
 * sent") — owner ruling, t-37, 16 September 2026: a silent signup was the wrong
 * first contact for a list whose whole point is reaching these people.
 *
 * ## What they have joined, in her words
 *
 * The three beats the landing page's "An invitation" card already excerpts —
 * `the_initiation` `[7, 10)`: "This is not simply an app." / "It is an
 * invitation." / "An invitation to explore…" — read by position through the
 * loader, one per line per the document's cadence note, and pinned by first and
 * last beat in the test. Chosen because they say what this is without greeting
 * someone who has not arrived: the Initiation's opening line is for the person
 * who has, and that is the welcome email's.
 *
 * ## What happens next, honestly
 *
 * The build's register: we will write when we open, we do not have a date, and
 * this is the only email until then. No date is invented — the test pins the
 * absence of a digit. **No unsubscribe, no preferences, no footer link** — owner
 * ruling: one transactional acknowledgement of something the person just asked
 * for is not a list they need a way off. The trigger to revisit is the first
 * *unsolicited* send — an "we are opening" note, a progress update — which is
 * marketing and needs a way out; whoever builds that send revisits this.
 *
 * ## The address is unverified
 *
 * A stranger can type anyone's address, so the footer says why this arrived and
 * that nothing more will — the honest minimum for mail to an address nobody has
 * proved they own. The send is on first join only (see `confirmation.ts`), so
 * one email per address is the most this can ever cause.
 *
 * ## Read at render time
 *
 * The loader reads live in a child component for the reason `welcome.tsx`
 * gives: a content failure lands inside `render()`, inside `sendEmail`'s own
 * `try`, and is logged — never thrown at the caller.
 */

/** `[from, to)` into `the_initiation` — "This is not simply an app." through the invitation. */
export const CONFIRMATION_BEATS = { from: 7, to: 10 } as const;

export interface WaitlistConfirmationEmailProps {
  /** The name they gave, or nothing. First name only is used. */
  name?: string | null;
  email: string;
  /** The app's origin, e.g. `https://lelanea.com`. */
  baseUrl: string;
}

/** First whitespace-separated part of a name, or `null` for none. */
function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

function InvitationBeats(): React.ReactElement {
  const beats = paragraphRange(
    requireDocument('the_initiation'),
    CONFIRMATION_BEATS.from,
    CONFIRMATION_BEATS.to
  );
  return (
    <>
      {beats.map((beat, i) => (
        <Text key={i} style={styles.beat} className="lelanea-heading">
          {beat}
        </Text>
      ))}
    </>
  );
}

export default function WaitlistConfirmationEmail({
  name,
  email,
  baseUrl,
}: WaitlistConfirmationEmailProps): React.ReactElement {
  const firstName = firstNameOf(name);

  return (
    <LelaneaEmail
      preview={`You are on the ${BRAND.name} list.`}
      baseUrl={baseUrl}
      reason={`You are receiving this because ${email} was added to the ${BRAND.name} waitlist. If that was not you, nothing more will come — this is the only email.`}
    >
      <Text style={{ ...styles.text, marginBottom: '24px' }} className="lelanea-text">
        {firstName ? `${firstName}, you are on the list.` : 'You are on the list.'}
      </Text>

      <InvitationBeats />

      <Text style={{ ...styles.text, marginTop: '24px' }} className="lelanea-text">
        That is what you have asked to be part of. We will write to this address when {BRAND.name}{' '}
        opens. We do not have a date yet, and we would rather say so than invent one.
      </Text>

      <Text style={{ ...styles.text, marginBottom: 0 }} className="lelanea-text">
        Until then, this is the only email you will get from us.
      </Text>
    </LelaneaEmail>
  );
}
