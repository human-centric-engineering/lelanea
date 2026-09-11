/**
 * Waitlist validation — the public form's contract, the write route's, and the
 * admin read's.
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
 * @see lib/app/waitlist/admin.ts — what the admin list and export schemas feed
 */

import { z } from 'zod';
import { queryBooleanSchema } from '@/lib/validations/common';

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

/**
 * The server's schema. The honeypot is `unknown` and **never fails validation**.
 *
 * It carried `z.string().max(0)` first, which reads like the stricter choice and
 * is the wrong place for the check. The rejection then happened inside
 * `validateRequestBody`, so the route could only recognise a honeypot hit by
 * inspecting the thrown error's `details.errors[].path` — and that matches on
 * the FIELD, not on what was in it. `{"email":"ada@example.com","website":null}`
 * fails with "Expected string, received null", takes the honeypot branch, writes
 * nothing, and answers "You are on the list": a real person told they joined
 * when no row exists, which is the exact failure `B31` and the t-5 stub were
 * written to prevent.
 *
 * Letting the value through unvalidated moves the decision to the handler, which
 * can see the value itself and can tell "a bot filled the trap" from "a client
 * sent a null". See `app/api/v1/app/waitlist/route.ts`.
 */
export const waitlistWithHoneypotSchema = waitlistSchema.extend({
  website: z.unknown().optional(),
});

/**
 * Whether the honeypot was filled in — the check the route makes.
 *
 * Exported so the rule lives beside the schema that carries the field, and so
 * it can be tested without a request. Deliberately narrow: only actual CONTENT
 * counts. `undefined`, `null` and blank strings are what honest clients send.
 */
export function isHoneypotFilled(value: unknown): boolean {
  // What an honest client sends: the field absent, an explicit null from a
  // hand-rolled caller, or the empty string the real form always submits.
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  // Anything that is neither absent nor a string — a number, an object — is not
  // something the real form can produce, so it counts as filled. Not
  // stringified to decide that: `String({})` is `[object Object]`, which would
  // be "filled" by accident rather than on purpose.
  return true;
}

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

// ─── The admin read surface ──────────────────────────────────────────────────

/**
 * How many entries a page of the admin list holds.
 *
 * `paginationQuerySchema`'s own default is 10, which is Sunrise's number for a
 * list of things an operator scans for one row. This list is read rather than
 * scanned — `intent` is why the table exists and she reads the answers one by
 * one (`.context/app/waitlist.md`) — so the default is higher and the page is
 * still one screenful of scrolling.
 */
export const WAITLIST_ADMIN_PAGE_SIZE = 25;

/**
 * The filter both admin reads share: a free-text search, and nothing else.
 *
 * ## `contains` + `mode: 'insensitive'` is an `ILIKE`, and here that is FINE
 *
 * `lib/app/waitlist/service.ts` documents at length why the GDPR matcher must
 * never use `mode: 'insensitive'`: it compiles to Postgres `ILIKE` on this
 * connector, Prisma does not escape the compared value, and `_` and `%` are both
 * legal in an email local part — so an *equality* match silently widens into a
 * wildcard one and hands a data subject a stranger's row, or deletes it.
 *
 * The reasoning does not transfer to this search box, and re-deriving it rather
 * than copying the conclusion is the point (`fp5`). Two things differ: the
 * caller is an admin who is already authorised to read every row in the table,
 * so a wider match discloses nothing they could not page to; and a substring
 * search is *already* a wildcard match by construction, so `%` behaving like one
 * surprises nobody. The worst case is an odd result set, not a disclosure.
 *
 * What remains worth bounding is the cost, hence the length cap.
 */
export const waitlistAdminFilterSchema = z.object({
  q: z
    .string()
    .trim()
    .max(200, 'Please keep the search under 200 characters.')
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value)),
  /**
   * Show entries an admin has taken off the list. Default false: the list is
   * "who is waiting", and a removed entry is not.
   *
   * `queryBooleanSchema`, not `z.coerce.boolean()` — the latter is `Boolean('false')`,
   * which is `true`, so `?includeRemoved=false` would turn the filter ON. It is
   * the platform's helper for exactly this, and the bug it avoids is the kind
   * that only shows up when someone unchecks a box.
   */
  includeRemoved: queryBooleanSchema.optional().default(false),
});

/**
 * The body of a removal or a restore: the state to REACH, not a toggle.
 *
 * A toggle would make two admins acting on the same row in the same minute leave
 * it in whichever state arrived last, and a double-clicked button undo itself.
 * `{ removed: true }` twice is the same as once.
 */
export const waitlistRemovalSchema = z.object({
  removed: z.boolean({ error: 'Say whether this entry is removed: true or false.' }),
});

/** The admin list query: the shared filter plus page/limit. */
export const waitlistAdminQuerySchema = z.object({
  ...waitlistAdminFilterSchema.shape,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(WAITLIST_ADMIN_PAGE_SIZE),
});

export type WaitlistAdminFilter = z.infer<typeof waitlistAdminFilterSchema>;
export type WaitlistRemovalInput = z.infer<typeof waitlistRemovalSchema>;
export type WaitlistAdminQuery = z.infer<typeof waitlistAdminQuerySchema>;
