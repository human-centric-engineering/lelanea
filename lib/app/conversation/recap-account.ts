/**
 * What a session recap drew on, as its turn row keeps it (f-recap t-142).
 *
 * The recap is the AI's own opening of a new session (`recap.ts`), steered by
 * material the person never sees: their words from the last session, the
 * notes that changed since, and where their journey moved. "Nothing is
 * understood invisibly", so the account under the reply says what it drew on
 * (`account.ts`), and this is what it reads — stored on `app_turn.recap` when
 * the recap is claimed, sent on its `done` frame, and read back on reload.
 *
 * Counts and headings, never the material: the person's words are already in
 * their transcript, and a note's value is in their notes. A heading is the
 * note's slug, which is what the notes panel shows it under.
 *
 * Import-light (zod only), because the pane's client reads it too.
 */

import { z } from 'zod';

export const recapAccountSchema = z.object({
  /** When the session the recap looked back to began — ISO. */
  since: z.string(),
  /** How many of the person's own messages from that session it was given. */
  words: z.number().int().nonnegative(),
  /** The headings of the notes captured since, as the notes panel files them. */
  notes: z.array(z.string()),
  /** How many steps of their journey it was told about. */
  journey: z.number().int().nonnegative(),
});

export type RecapAccount = z.infer<typeof recapAccountSchema>;

/** A stored or sent recap account, or null when there is none or it does not parse. */
export function parseRecapAccount(raw: unknown): RecapAccount | null {
  const parsed = recapAccountSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
