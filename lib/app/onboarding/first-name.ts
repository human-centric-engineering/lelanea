/**
 * The reader's first name for `{{first_name}}`, or `null` when there is none.
 *
 * One rule for every place her words greet someone by name: the welcome email
 * (`components/app/emails/welcome.tsx`) and the in-app Initiation
 * (`components/app/onboarding/first-run.tsx`, t-103). Two copies of it would
 * disagree the first time one of them learned a new stand-in.
 *
 * `null` is what `applyFirstName` needs to take its fallback — "Welcome." with
 * the comma dropped (decision D7) — so every "no usable name" case lands there:
 *
 * - **No name at all** — an OAuth provider that returned none, an invite
 *   accepted before the profile was filled in.
 * - **Only whitespace**, which is a missing name rather than a name.
 * - **`'User'`**, the platform's literal stand-in. Sunrise hands the welcome
 *   email `user.name || 'User'` rather than `null`, and a profile saved with
 *   that value would otherwise greet the person as "Welcome, User." That is a
 *   coupling to a string in Sunrise-owned `lib/auth/config.ts`; the tests pin
 *   it, and the honest fix is upstream (pass `null` through).
 */

/** The platform's stand-in for a missing name (`user.name || 'User'`). */
export const PLATFORM_NAME_FALLBACK = 'User';

/** First whitespace-separated part of the name, or `null` when there is none. */
export function firstNameFrom(userName: string | null | undefined): string | null {
  const trimmed = userName?.trim();
  if (!trimmed || trimmed === PLATFORM_NAME_FALLBACK) return null;
  return trimmed.split(/\s+/)[0] ?? null;
}
