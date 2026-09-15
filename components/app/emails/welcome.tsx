import * as React from 'react';
import { Button, Section, Text } from '@react-email/components';

import { applyFirstName } from '@/components/app/content/authored-document';
import { CardLink, LelaneaEmail, styles } from '@/components/app/emails/lelanea-email';
import { paragraphRange, requireDocument } from '@/lib/app/content/sections';
import { appAuthLandingRoute } from '@/lib/app/auth-landing';
import { BRAND } from '@/lib/brand';

/**
 * The welcome email — her words, not the platform's.
 *
 * Registered through `lib/app/emails.ts`; `emails/welcome.tsx` is Sunrise's and
 * is not edited. Takes the platform's `welcome` props unchanged
 * (`EmailPropsMap['welcome']` in `lib/email/registry.ts`).
 *
 * ## The copy is the Initiation, verbatim, not a paraphrase of it
 *
 * `the_initiation` is the authored welcome statement (`surface:
 * first_run_welcome`), and the product's rule is that her words are never
 * reworded in the build. So the greeting here is its opening run — the beats
 * from "Welcome, {{first_name}}." to "Welcome to Lelañea." — read through the
 * loader by position, exactly as the landing page reads its own excerpts, and
 * rendered one beat per line because the document's `renderStyle: 'cadence'`
 * says so. Seventy beats would make an email nobody finishes; seven is the
 * authored unit that ends on the product's name.
 *
 * `WELCOME_BEATS` is pinned by its first and last beat in the test, so a beat
 * inserted upstream fails the suite rather than shifting the email to end
 * mid-thought — the same protection `sections.test.ts` gives the landing page.
 *
 * ## What follows the greeting is the product's register, and is labelled so
 *
 * "What happens next" is not in any authored document, so the two lines under
 * her words are the build's — plain, in the same register as the shell's own
 * copy, and about the mechanics only: the gate, then the conversation. Nothing
 * there is presented as hers.
 *
 * ## The first name
 *
 * The merge field takes the reader's first name, or the sentence closes over
 * the gap ("Welcome." — decision D7, `applyFirstName`). The platform hands
 * this template `user.name || 'User'` rather than `null` for an account with no
 * name, so `'User'` — the platform's literal fallback — is treated as no name.
 * That is a coupling to a string in Sunrise-owned `lib/auth/config.ts`; the
 * test pins it, and the honest fix is upstream (pass `null` through), which is
 * noted in the PR rather than patched here.
 */

/** `[from, to)` into `the_initiation` — "Welcome, …" through "Welcome to Lelañea." */
export const WELCOME_BEATS = { from: 0, to: 7 } as const;

/** The platform's stand-in for a missing name (`user.name || 'User'`). */
const PLATFORM_NAME_FALLBACK = 'User';

/** First whitespace-separated part of the name, or `null` when there is none. */
export function firstNameFrom(userName: string): string | null {
  const trimmed = userName.trim();
  if (!trimmed || trimmed === PLATFORM_NAME_FALLBACK) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}

export interface WelcomeEmailProps {
  userName: string;
  userEmail: string;
  /** The app's origin, e.g. `https://lelanea.com`. */
  baseUrl: string;
}

export default function WelcomeEmail({
  userName,
  userEmail,
  baseUrl,
}: WelcomeEmailProps): React.ReactElement {
  const firstName = firstNameFrom(userName);
  const beats = paragraphRange(
    requireDocument('the_initiation'),
    WELCOME_BEATS.from,
    WELCOME_BEATS.to
  ).map((beat) => applyFirstName(beat, firstName));
  const beginUrl = `${baseUrl}${appAuthLandingRoute ?? '/'}`;

  return (
    <LelaneaEmail
      preview={`Welcome to ${BRAND.name}.`}
      baseUrl={baseUrl}
      reason={`You are receiving this because an account was created at ${BRAND.name} for ${userEmail}.`}
    >
      {beats.map((beat, i) => (
        <Text key={i} style={styles.beat} className="lelanea-heading">
          {beat}
        </Text>
      ))}

      <Text style={{ ...styles.text, marginTop: '24px' }} className="lelanea-text">
        Your account is ready. The first time you open {BRAND.name} you will be asked to read what
        it is and what it is not, and to agree to the terms — and then the conversation begins.
      </Text>

      <Section style={styles.buttonRow}>
        <Button href={beginUrl} style={styles.button}>
          Begin
        </Button>
      </Section>

      <Text style={styles.small} className="lelanea-muted">
        If the button does not work, open this link: <CardLink href={beginUrl}>{beginUrl}</CardLink>
      </Text>
    </LelaneaEmail>
  );
}
