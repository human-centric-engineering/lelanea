/**
 * Waitlist validation — the public form's contract, and the route's.
 *
 * ## The messages are the product's register, not the platform's
 *
 * `lib/validations/auth.ts` already exports an `emailSchema` with the same three
 * constraints, and reusing it was the first shape here. Its message is "Invalid
 * email address", which is Sunrise's voice on a sign-in form. This form is the
 * first thing a stranger does on the public site, and the design guide gives it
 * a different register: the prototype's own line is "That email address does not
 * look complete. Check it and try once more." — a description of what happened
 * and what to do, with nothing in it that reads as the reader having failed.
 *
 * Every message below is the one a visitor sees, so each is written for that
 * reader rather than for a developer reading a log.
 *
 * ## D2's four fields
 *
 * Email required; name, `heardFrom` and `intent` optional. The optional three
 * are `''` when untouched — a form control has no other empty value — and the
 * transform below turns each blank into `undefined` so a skipped field is
 * stored as `NULL` rather than as an empty string that reads like an answer.
 *
 * @see .context/app/planning/design/Lelanea_Design_System/README.md — the copy register
 * @see components/app/site/waitlist-form.tsx · app/api/v1/app/waitlist/route.ts
 */

import { z } from 'zod';

/** Longest value we will store in any of the three optional free-text fields. */
const FREE_TEXT_MAX = 2000;
/** Longest value for the two short optional fields (a name, a referral source). */
const SHORT_TEXT_MAX = 200;

/**
 * An optional free-text answer: trimmed, capped, and `undefined` when blank.
 *
 * `''` is what an untouched `<input>` submits. Stored as-is it becomes an empty
 * string in a nullable column, which is indistinguishable in a query from
 * someone who typed a space — and it makes `heardFrom IS NOT NULL` count people
 * who answered nothing.
 *
 * **`.transform()` on an optional string, not `z.preprocess()`.** Preprocess was
 * the first shape and it types its INPUT as `unknown`, so `zodResolver` inferred
 * `{ name: unknown }` for the form and could not be assigned to the field values
 * `useForm` was declared with. This shape keeps input and output both
 * `string | undefined`, which is what the resolver needs and is also the honest
 * description of what the field is.
 *
 * `.trim()` comes BEFORE `.max()` so trailing whitespace cannot push a
 * legitimate answer over the cap.
 */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Please keep this under ${max} characters.`)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));
}

/** The email, lower-cased so the table's `@unique` means one person. */
export const waitlistEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'We need an email address to tell you when a place opens.')
  .email('That email address does not look complete. Check it and try once more.')
  .max(255, 'That email address does not look complete. Check it and try once more.');

/** What the visitor sends, before the honeypot is considered. */
export const waitlistSchema = z.object({
  email: waitlistEmailSchema,
  name: optionalText(SHORT_TEXT_MAX),
  heardFrom: optionalText(SHORT_TEXT_MAX),
  intent: optionalText(FREE_TEXT_MAX),
});

/**
 * The client's schema: the four fields plus the honeypot, which the browser
 * accepts with any value.
 *
 * The check that it is EMPTY is server-side only, exactly as `contact.ts` splits
 * it. A client that rejected a filled honeypot would tell the bot which field
 * it is, and the whole value of a honeypot is that it does not.
 */
export const waitlistClientSchema = waitlistSchema.extend({
  website: z.string().optional(),
});

/** The server's schema: the honeypot must be empty. */
export const waitlistWithHoneypotSchema = waitlistSchema.extend({
  website: z.string().max(0, 'Invalid submission').optional(),
});

export type WaitlistInput = z.infer<typeof waitlistSchema>;
export type WaitlistClientInput = z.infer<typeof waitlistClientSchema>;
export type WaitlistWithHoneypotInput = z.infer<typeof waitlistWithHoneypotSchema>;

/**
 * What the FORM holds, as distinct from what the schema produces.
 *
 * `optionalText` transforms, so the schema's input and output types differ: a
 * blank field is `name?: string` going in and `name: string | undefined` coming
 * out. `useForm` is generic over the values it HOLDS — the input side — and
 * hands the output side to the submit handler, so the two are named separately
 * rather than both being `z.infer`, which is the output type only.
 *
 * Collapsing them is what the type error says, at some length: the resolver's
 * `Resolver<In, ctx, Out>` cannot be assigned where `Resolver<Out, ctx, Out>` is
 * wanted.
 */
export type WaitlistFormValues = z.input<typeof waitlistClientSchema>;
