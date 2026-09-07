/**
 * The Daybreak framework version this checkout corresponds to.
 *
 * SOURCE OF TRUTH for the Daybreak version, and the middle member of a
 * three-tier set. All three answer a different question, which is why none can
 * be derived from another:
 *
 *   - `APP_VERSION`      (`lib/app-version.ts`)     — the LEAF app's own version,
 *     read from `package.json`. In a leaf fork that file says `reclaim-your-week`,
 *     not `daybreak`, so Daybreak's version cannot be recovered from it.
 *   - `DAYBREAK_VERSION` (this file)                — the FRAMEWORK version the
 *     leaf is built on.
 *   - `SUNRISE_VERSION`  (`lib/sunrise-version.ts`) — the PLATFORM version
 *     Daybreak is built on.
 *
 * Together they are what lets an operator answer "what is actually deployed?"
 * for a three-tier app, via `/api/health` (`version` / `daybreak` / `sunrise`).
 *
 * # Who edits this
 *
 * Bumped by **Daybreak maintainers** as part of cutting a Daybreak release (a
 * one-line edit + an annotated `daybreak-vX.Y.Z` tag + a CHANGELOG entry — see
 * `.context/framework/VERSIONING.md`, "Cutting a release").
 *
 * **Leaf forks merge this file through with the rest of Daybreak; they do NOT
 * edit it.** Editing it in a leaf makes the leaf claim a framework version it is
 * not running, which is worse than no answer at all — the number is only useful
 * because it is not negotiable downstream. A leaf's own version belongs in its
 * `package.json` (surfaced as `APP_VERSION`).
 *
 * # Why this is not derived from `package.json`
 *
 * Exactly the reason `SUNRISE_VERSION` is not: `package.json.version` is owned by
 * whoever owns the repo. In Daybreak's own repo the two agree (a parity test
 * enforces it, so a release cannot bump one and forget the other). In a leaf they
 * deliberately diverge — the leaf sets its own, and this constant keeps reporting
 * the framework's.
 *
 * # Conventions
 *
 * - **Server-side use only.** Symmetric with `lib/sunrise-version.ts` — this file
 *   is deliberately NOT marked `server-only`, so it can be imported from
 *   platform-agnostic tiers. Render the framework version in a client component
 *   by fetching `/api/health` (where it appears as `daybreak`), not by importing
 *   this constant.
 * - **Lives at `lib/` root, not `lib/framework/`, and this is forced.** The
 *   ESLint boundary (`lib/framework/eslint.config.mjs`) bans core code from
 *   importing `@/lib/framework`, because a static specifier resolves at BUILD
 *   time and would break any fork without that folder. `app/api/health/route.ts`
 *   is core, so the constant it reads cannot live in the framework tier.
 */
export const DAYBREAK_VERSION = '0.2.0';
