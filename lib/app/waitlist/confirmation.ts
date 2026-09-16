import { createElement } from 'react';

import WaitlistConfirmationEmail from '@/components/app/emails/waitlist-confirmation';
import { BRAND } from '@/lib/brand';
import { sendEmail } from '@/lib/email/send';
import { env } from '@/lib/env';
import { logger } from '@/lib/logging';

/**
 * Send the one email a joiner gets — and never let it touch the submission.
 *
 * Called from the route inside Next's `after()`, so it runs once the response
 * has already gone. Two properties follow from that and both are the point:
 *
 * - **It cannot block or fail the join.** The row is written and the 200 sent
 *   before this starts; a bounced or unconfigured mailer is logged and the person
 *   is on the list either way. This function also never throws — `sendEmail`
 *   has its own `try`, and the `catch` here is for anything outside it.
 * - **It cannot be timed.** The confirmation goes on a FIRST join only (below),
 *   so an awaited send would have made the response measurably slower for an
 *   address not yet on the list — a timing oracle for the same question the
 *   status code used to leak. After the response, there is nothing to time.
 *
 * ## First join only
 *
 * The address is unverified input: a stranger can type anyone's. Sending on
 * every accepted submission would make the public form a way to put five emails
 * an hour per IP into a chosen inbox. On `created` only, the most the form can
 * ever cause is one email per address, ever — which is also why a repeat
 * submission (someone not sure the first one landed) gets no second copy: the
 * first is in their inbox. Neither the response nor the card reveals which case
 * it was, so the on-screen copy is written to be true of both.
 *
 * ## No address in the leaf's own logs
 *
 * The route's rule: an address in an application log is a copy of personal
 * data outside the table the export and erasure paths know about. Ours log the
 * entry id. (The platform's `sendEmail` logs its recipient on every send, for
 * every auth email; that is Sunrise's and pre-existing, noted in the PR.)
 */
export interface WaitlistConfirmationInput {
  entryId: string;
  email: string;
  name?: string | null;
}

/**
 * Where the lotus resolves from. `NEXT_PUBLIC_APP_URL` is required by the env
 * schema (`z.string().url()`, no `.optional()`), so there is no fallback to
 * write: one that existed here was dead code, and a test of it tested nothing.
 */
function appOrigin(): string {
  return env.NEXT_PUBLIC_APP_URL;
}

export async function sendWaitlistConfirmation(input: WaitlistConfirmationInput): Promise<void> {
  try {
    const result = await sendEmail({
      to: input.email,
      subject: `You are on the ${BRAND.name} list`,
      react: createElement(WaitlistConfirmationEmail, {
        name: input.name,
        email: input.email,
        baseUrl: appOrigin(),
      }),
    });

    if (result.success) {
      logger.info('Waitlist confirmation sent', { entryId: input.entryId, status: result.status });
    } else {
      logger.warn('Waitlist confirmation not sent', {
        entryId: input.entryId,
        status: result.status,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Waitlist confirmation threw', {
      entryId: input.entryId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
