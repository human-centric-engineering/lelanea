/**
 * Which `lib/app/` entries are THIS fork's own modules, not seams.
 *
 * **Fork-owned scaffold** — Sunrise ships an empty array and does NOT change
 * this file after release, so your edits here merge cleanly on upgrade (the
 * stable contract is this file's exports, not their values).
 *
 * Auto-wired: read by `tests/helpers/app-scaffolds.ts` (`unlistedSeams()`), which
 * subtracts it for the three guards that treat every `lib/app/` entry as a
 * public seam: the VERSIONING.md Covered list, CUSTOMIZATION.md §4's "Edit this
 * file" table, and the `SEAM_DEFAULTS` rows in `tests/unit/lib/app/defaults.test.ts`.
 *
 * ## Why this exists
 *
 * Those guards assume every entry in `lib/app/` is a starter file a fork fills,
 * so each one is owed a row in Sunrise's own documents. Upstream that is right:
 * everything Sunrise ships there is a seam. A leaf fork that keeps its own
 * modules there too (`lib/app/questionnaire/`, `lib/app/pricing.ts`) has no
 * file of its own in which to say "these are mine, not seams", so it carries a
 * row per module in three Sunrise-owned files, and conflicts on most syncs. This
 * file is that declaration.
 *
 * ## Who should declare
 *
 * **A leaf fork**: nobody forks it, so its modules are not anyone's public
 * surface. **A fork others build on** (a framework layer such as Daybreak)
 * should not: its `lib/app/` modules ARE the public surface of the forks below
 * it, and the rows in VERSIONING.md are how they learn about a breaking change.
 *
 * Boundary-clean: no imports at all, so this stays within the `lib/app/**`
 * framework-agnostic boundary.
 *
 * Full guide: CUSTOMIZATION.md §4 · .context/architecture/fork-init-seams.md
 */

/**
 * This fork's own modules under `lib/app/`, named as the guards name entries:
 * `lib/app/<file>` for a file, `lib/app/<dir>/` (trailing slash) for a
 * directory.
 *
 * Sunrise core ships `[]` — everything it puts in `lib/app/` is a seam.
 *
 * An entry is refused, not ignored, when it is not on disk, is not in that
 * form, is this file, is already not a seam, or still has a row in
 * VERSIONING.md, the CUSTOMIZATION.md §4 table, `SEAM_DEFAULTS` or
 * `UNASSERTED_SEAMS`. Every
 * Sunrise seam has those rows, so naming one is refused; a module of your own
 * is accepted once you delete the rows you added for it before this file
 * existed. So a typo fails loudly instead of silently exempting nothing.
 *
 * @example A leaf fork with two modules of its own
 * ```ts
 * export const appOwnModules: readonly string[] = [
 *   'lib/app/questionnaire/',
 *   'lib/app/pricing.ts',
 * ];
 * ```
 */
export const appOwnModules: readonly string[] = [
  // LELAÑEA — our own modules, not seams (Daybreak 0.9.0 sync, t-174). Until
  // then each was a row in VERSIONING.md's Covered list, carried as a
  // divergence; nobody forks Lelañea, so none of them is anyone's public surface.
  // the one agent's pins: the model she runs on and its rate, the two seats she holds
  'lib/app/agent/',
  // the authored content loader: foundational documents, discovery questions, journey structure
  'lib/app/content/',
  // the conversation pane's side of a turn: the leaf event schema, the transcript read, the stream client and its copy
  'lib/app/conversation/',
  // the acknowledgement gate: kinds, current versions, a member's standing at the gate
  'lib/app/gateway/',
  // the published journey map, its module registry and path helpers
  'lib/app/journey/',
  // the journey record: session synopses and a person's own entries, read, searched, written and exported
  'lib/app/journey-record/',
  // what was said, kept and taken back: the per-person memory index, and deleting an exchange and everything it left behind
  'lib/app/memory/',
  // the leaf's module definitions, registered with Daybreak's module registry
  'lib/app/modules/',
  // the first-run sequence: the discovery questions as data slots, and the set a person is asked
  'lib/app/onboarding/',
  // the resources tool: `suggest_resource`, the suggestion shape the pane reads, and the offering the agent is shown
  'lib/app/resources/',
  // the crisis path: deterministic detection, the context check, the regional resource and the safety record
  'lib/app/safety/',
  // a person's sittings: the twelve-hour boundary, and opening, closing and reading sessions in Daybreak's event stream
  'lib/app/sessions/',
  // the authored slot taxonomy: the store, and the provider Daybreak's global slot sync reads
  'lib/app/slots/',
  // the usage view: the wire shapes of the meter's member endpoints, and what each figure means
  'lib/app/usage/',
  // the voice corpus: designation, comparison, corpus access and the chat context contributor
  'lib/app/voice/',
  // the public waitlist: endpoint, service, confirmation email, locale and rate limit
  'lib/app/waitlist/',
];
