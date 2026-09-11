/**
 * Changelog-guard logic (f-release t-3) — pure, unit-tested, no I/O.
 *
 * Decides whether a set of changed files requires an entry in Daybreak's
 * changelog. The CLI wrapper (`scripts/release/changelog-check.ts`) supplies the
 * file list from git and does the exiting.
 *
 * # Why a gate at all
 *
 * `.context/framework/CHANGELOG.md` is what a leaf fork reads before merging a
 * Daybreak release. Its value is entirely in being complete — a changelog that
 * omits the one change that breaks you is worse than none, because you trusted it.
 * Conventions alone decay; the Sunrise v0.8.0 sync is the proof, where a
 * leaf-contract change (`lib/app/data-export.ts` changing hands) would have
 * reached a leaf with no announcement at all.
 *
 * # Why the gated set is NARROWER than the documented public surface
 *
 * `VERSIONING.md` defines the public surface to include "exported values from
 * `lib/framework/**` that a leaf is documented to call". That is not
 * mechanically detectable — a path cannot tell you whether an export is
 * documented — so gating all of `lib/framework/**` would fire on every internal
 * refactor. A gate that cries wolf gets bypassed, and then it protects nothing.
 *
 * So this guard covers the **high-signal, mechanically-decidable** subset:
 *
 *   - the `lib/app/*` seam files (a file changing hands is THE change that
 *     breaks a leaf, and it is exactly what 0.1.0 had to announce)
 *   - `prisma/schema/framework-*.prisma` (published model shapes)
 *   - `lib/daybreak-version.ts` (the version contract itself)
 *   - **the exported symbol set of any `lib/framework/**\/index.ts` barrel**
 *     (#239 gap 3, below)
 *
 * # The fourth rule is not a path rule, and that is the point
 *
 * The three above ask "did this file change". The fourth asks "did the set of
 * symbols a leaf can import change" — computed, not guessed. That distinction is
 * what this docblock previously said was unavailable, and it was wrong: gating
 * `lib/framework/**` by PATH would indeed fire on every internal refactor, but
 * `scripts/ci/exports-diff.ts` already diffs barrels symbol-by-symbol, and
 * `check-exports.ts` already exports the git-backed readers. So the gate can ask
 * the precise question.
 *
 * That closes the case the issue opened with: `createJourney` was added to two
 * barrels, `check:exports` reported it, and `framework:changelog` said "no
 * public-surface change". The entry got written because a human read one tool and
 * decided — not because anything gated it.
 *
 * An internal refactor that moves code without changing what a barrel exports
 * still does not trip this. A rename shows as one removal plus one addition,
 * which is correct: it breaks every leaf importing the old name.
 *
 * The rest of the public surface still relies on the written rule plus review —
 * an exported value that is not barrel-exported is not seen here. Still a floor,
 * just a higher one.
 */

/** The changelog a public-surface change must touch. */
export const CHANGELOG_PATH = '.context/framework/CHANGELOG.md';

/**
 * Path patterns that constitute a mechanically-detectable public-surface change.
 * Each carries the reason it is here, which is surfaced in the failure message —
 * an error that says WHICH file tripped it and WHY is actionable; "add a
 * changelog entry" alone is not.
 */
export const GATED_SURFACE: ReadonlyArray<{ test: (path: string) => boolean; reason: string }> = [
  {
    // `lib/app/<name>.ts` only — not nested paths, which are a leaf's own code.
    test: (p) => /^lib\/app\/[^/]+\.(ts|mjs)$/.test(p),
    reason:
      'a lib/app/* seam changed — which files are Daybreak-owned vs leaf-reserved is itself public surface, and a file changing hands breaks any leaf that filled it',
  },
  {
    test: (p) => /^prisma\/schema\/framework-[^/]+\.prisma$/.test(p),
    reason: 'a framework_* model shape changed — leaves read these tables',
  },
  {
    test: (p) => p === 'lib/daybreak-version.ts',
    reason: 'the Daybreak version constant changed',
  },
];

/** Paths that never require an entry, even when they match a rule above. */
function isExempt(path: string): boolean {
  // Tests and docs cannot change a leaf's contract on their own. `.context/`
  // includes the changelog itself, so exempting it also stops a docs-only PR
  // that edits the changelog from being asked to edit the changelog.
  return path.startsWith('tests/') || path.startsWith('.context/');
}

export interface ChangelogVerdict {
  /** True when the change requires an entry and none was made. */
  violation: boolean;
  /** The gated files that triggered the requirement, with their reasons. */
  triggers: { path: string; reason: string }[];
  /** True when the changelog was touched. */
  changelogTouched: boolean;
}

/** One barrel's symbol delta, as `scripts/ci/exports-diff.ts` reports it. */
export interface BarrelDelta {
  file: string;
  added: readonly string[];
  removed: readonly string[];
}

/**
 * The barrel deltas that constitute a framework public-surface change (#239).
 *
 * Only `lib/framework/**` barrels: `lib/app/*` is the leaf's own surface (already
 * covered by a path rule above), and core's barrels are Sunrise's to announce.
 * A delta with nothing added and nothing removed is not a change — it is a barrel
 * whose file moved without its exports moving, which is exactly the internal
 * refactor this must not fire on.
 */
export function frameworkBarrelChanges(deltas: readonly BarrelDelta[]): BarrelDelta[] {
  return deltas.filter(
    (d) => d.file.startsWith('lib/framework/') && (d.added.length > 0 || d.removed.length > 0)
  );
}

/** Render one barrel delta as the reason shown in the failure message. */
export function barrelReason(delta: BarrelDelta): string {
  const parts: string[] = [];
  if (delta.added.length > 0) parts.push(`+${delta.added.join(', +')}`);
  // Stated separately and first in the sentence, because a removal is BREAKING
  // for any leaf importing the name while an addition merely wants announcing.
  if (delta.removed.length > 0) {
    parts.unshift(`REMOVED ${delta.removed.join(', ')} (breaking for any leaf importing them)`);
  }
  return `a lib/framework barrel's exported symbols changed — ${parts.join('; ')}`;
}

/**
 * Decide whether `changedFiles` needs a changelog entry it does not have.
 *
 * Pure: give it a list of repo-relative paths, get a verdict. No git, no fs.
 */
export function checkChangelog(
  changedFiles: readonly string[],
  barrelDeltas: readonly BarrelDelta[] = []
): ChangelogVerdict {
  const changelogTouched = changedFiles.includes(CHANGELOG_PATH);

  const pathTriggers = changedFiles
    .filter((path) => !isExempt(path))
    .flatMap((path) => {
      const rule = GATED_SURFACE.find((r) => r.test(path));
      return rule ? [{ path, reason: rule.reason }] : [];
    });

  // Defaulted to `[]` so every existing caller and test keeps its meaning: no
  // deltas supplied is "nothing known about the surface", not "surface unchanged".
  // The wrapper is what knows the difference, and it says so when it cannot look.
  const surfaceTriggers = frameworkBarrelChanges(barrelDeltas).map((d) => ({
    path: d.file,
    reason: barrelReason(d),
  }));

  const triggers = [...pathTriggers, ...surfaceTriggers];

  return {
    violation: triggers.length > 0 && !changelogTouched,
    triggers,
    changelogTouched,
  };
}

/** Render a verdict as the message CI prints. Separated so it is testable. */
export function formatVerdict(verdict: ChangelogVerdict): string {
  const lines = [
    `Public-surface change with no entry in ${CHANGELOG_PATH}.`,
    '',
    'Triggered by:',
    ...verdict.triggers.map((t) => `  • ${t.path}\n      ${t.reason}`),
    '',
    `Add an entry under "## [Unreleased]" describing what a LEAF fork must do about`,
    `this change — or, if it genuinely does not affect them, say so in the PR.`,
    `Contract: .context/framework/VERSIONING.md`,
  ];
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Structure: is the changelog itself well-formed? (#239 gap 1)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Category headings Daybreak's changelog is allowed to use **in addition** to
 * Keep-a-Changelog's six, each with the reason it earns its place.
 *
 * Sunrise's `checkChangelogStructure` hardcodes the six (`CATEGORIES` in
 * `scripts/ci/changelog-structure.ts`), which is right for Sunrise's own file. It
 * is wrong for Daybreak's, and not because we were sloppy: these headings carry
 * information the six cannot, to an audience the six were not designed for.
 *
 * A leaf reads this changelog to answer one question — *what do I have to do?* —
 * and the standard six cannot distinguish "Sunrise changed this and we pass it
 * through" from "Daybreak changed this", or "this needs work from you before you
 * merge" from "this is just news". Folding them into `Changed` to satisfy a
 * convention would make the document worse at its only job.
 *
 * Upstream has been asked to make the category set a parameter (a three-line
 * change); until then the violations for these are filtered out below. See
 * `.context/framework/upstream-asks.md`.
 */
export const EXTRA_CATEGORIES: ReadonlyArray<{ label: string; reason: string }> = [
  {
    label: 'Platform',
    reason:
      'the Sunrise version this release sits on, and what the sync changed about the leaf contract — a different problem with a different fix from a Daybreak-owned change',
  },
  {
    label: 'Documentation',
    reason: 'documentation-only changes, which a leaf can read but need not act on',
  },
];

/**
 * The action-required marker: `### ⚠️ Changed — action required for existing leaf forks`.
 *
 * A prefixed, suffixed form of a standard category rather than a new one, because
 * that is what it is — the same change class, flagged. It is the single most
 * valuable heading in an upgrade document ("stop, this one needs work from you"),
 * and 0.1.0 used it for `lib/app/data-export.ts` changing hands, where following
 * the obvious merge resolution silently dropped the framework's tables from every
 * GDPR subject-access export.
 *
 * Matched as a pattern rather than an exact string so the suffix can say which
 * forks and why, without this list needing an edit per release.
 */
const ACTION_REQUIRED_RE = /^⚠️\s+(Added|Changed|Deprecated|Removed|Fixed|Security)\s+—\s+\S/u;

/** Sunrise's message for a heading outside its six. Matched to filter our extras. */
const NOT_A_CATEGORY = 'is not a Keep a Changelog category';

/** True when `label` is a heading Daybreak deliberately permits. */
export function isPermittedCategory(label: string): boolean {
  return EXTRA_CATEGORIES.some((c) => c.label === label) || ACTION_REQUIRED_RE.test(label);
}

/**
 * Structural violations in Daybreak's changelog, with the ones Daybreak
 * deliberately permits removed and the platform-flavoured wording corrected.
 *
 * **Delegates rather than reimplements.** Sunrise's `checkChangelogStructure` is a
 * pure function over source text, so pointing it at this file costs nothing and
 * duplicates none of the parsing, ordering, `[Unreleased]`-placement or
 * duplicate-heading logic. The issue (#239) assumed the path was hardcoded all the
 * way down; it is hardcoded only in the CLI wrapper.
 *
 * Two things need adjusting, and both are narrow:
 *
 * 1. **Our extra categories** are filtered out. A category violation survives only
 *    if {@link isPermittedCategory} rejects it — so a genuine typo (`### Add`)
 *    still fails, while `### Platform` does not.
 * 2. **The version rule is ours, not the platform's.** Sunrise checks the topmost
 *    release against `SUNRISE_VERSION`; this file tracks `DAYBREAK_VERSION`. The
 *    check itself is correct once given the right version, but the message names
 *    the wrong constant and the wrong file, which would send someone editing
 *    `lib/sunrise-version.ts` — a file forks must never touch. Reworded here.
 *
 * Both adjustments are string-matched against Sunrise's messages. If upstream
 * rewords them the match stops working, and the failure direction is **safe**: an
 * unfiltered violation surfaces as a loud build failure, never as a silent pass.
 */
export function checkFrameworkChangelogStructure(
  source: string,
  daybreakVersion: string,
  checkStructure: (source: string, options: { sunriseVersion: string }) => ChangelogViolation[],
  parse: (source: string) => { categories: readonly CategoryHeading[]; truncation?: unknown }
): ChangelogViolation[] {
  // Which LINES carry a heading Daybreak permits. Keyed by line rather than by
  // label parsed back out of the rendered message: a heading whose own label
  // contains `" is not` produced a message the lazy regex mis-parsed, so
  // `### Platform" is not` extracted `Platform`, was accepted, and suppressed its
  // own violation. A heading cannot lie about which line it is on.
  // Parsed ONCE. It was called twice on the same source, which is wasteful and,
  // worse, invites the two call sites to disagree about truncation.
  const parsed = parse(source);
  const permittedLines = new Set(
    parsed.categories.filter((c) => isPermittedCategory(c.label)).map((c) => c.line)
  );

  const kept = checkStructure(source, { sunriseVersion: daybreakVersion })
    .filter((v) => !(v.message.includes(NOT_A_CATEGORY) && permittedLines.has(v.line)))
    .map((v) =>
      v.message.includes('SUNRISE_VERSION')
        ? {
            ...v,
            message: v.message
              .replace(/`SUNRISE_VERSION`/g, '`DAYBREAK_VERSION`')
              .replace(/lib\/sunrise-version\.ts/g, 'lib/daybreak-version.ts'),
          }
        : v
    );

  // A truncated parse means we do not have the full set of headings, and every
  // cross-heading rule below reasons across that set. `checkChangelogStructure`
  // returns early for exactly this reason — an unclosed code fence made it report
  // "duplicate ### Platform" about a file it stopped reading a third of the way in.
  // The fence violation is already in `kept` and says what to fix.
  if (parsed.truncation) return kept;

  return [...kept, ...duplicatePermittedCategories(parsed.categories)];
}

/**
 * Second `### Platform` in one release section, and friends.
 *
 * **This exists because permitting a heading accidentally exempted it from a
 * different rule.** Sunrise's category loop pushes the "not a Keep a Changelog
 * category" violation and then `return`s, so a non-canonical label never reaches
 * the duplicate check below it. Filtering that violation out therefore removed the
 * only thing that ever looked at these headings — the split-section rule silently
 * did not apply to the three Daybreak added, including the action-required one.
 *
 * The failure it allows is not cosmetic: a leaf scanning a release for what the
 * Sunrise sync changed reads the first `### Platform` block and stops. 0.2.0's own
 * notes record consolidating duplicate `###` headings, found by hand.
 *
 * Re-applied here rather than left to upstream, because the exemption is ours.
 */
function duplicatePermittedCategories(
  categories: readonly CategoryHeading[]
): ChangelogViolation[] {
  const seen = new Map<string, number>();
  const violations: ChangelogViolation[] = [];

  for (const category of categories) {
    if (!isPermittedCategory(category.label)) continue;
    const key = `${category.sectionLine}\u0000${category.label}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, category.line);
      continue;
    }
    violations.push({
      line: category.line,
      message:
        `"### ${category.label}" appears twice in the same release section ` +
        `(already at line ${first}). A reader stops at the first block — merge them.`,
    });
  }

  return violations;
}

/** Mirrors `CategoryHeading` from `@/scripts/ci/changelog-structure`. */
export interface CategoryHeading {
  line: number;
  label: string;
  sectionLine: number;
}

/** Mirrors `ChangelogViolation` from `@/scripts/ci/changelog-structure`. */
export interface ChangelogViolation {
  line: number;
  message: string;
}
