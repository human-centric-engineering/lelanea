/**
 * App subject-data export seam (GDPR Art. 15) — Daybreak's framework/leaf bridge.
 *
 * **Fork-owned scaffold.** Upstream Sunrise ships this returning nothing and does
 * NOT change it after release, so Daybreak's edits here merge cleanly on upgrade
 * (the stable contract is this file's `collectAppSubjectData` export, not its
 * body).
 *
 * Auto-wired: `exportUserData()` (`lib/privacy/export-user.ts`) calls this and
 * folds the result into the `app` section of the export bundle, so both the
 * self-service and admin export endpoints pick it up with no core edit.
 *
 * Daybreak fills it to contribute the **framework** tier's tables, then delegates
 * to the reserved **leaf** seam — the subject-access analogue of the boot bridge
 * (`bootstrap.ts` → `initFramework()` → `leaf-bootstrap.ts`) and the nav bridge
 * (`admin-nav.ts` → `initFrameworkNav()` → `leaf-admin-nav.ts`). This is the
 * one of the `lib/app/*` bridges Daybreak fills (the roster is in CLAUDE.md's
 * banner — do not count them from a docblock; this line used to say "THIRD", as
 * did `db-drift.ts`); `lib/app/**` is the sanctioned
 * core→framework bridge (the ESLint boundary exempts it).
 *
 * Core covers its own tables via `lib/privacy/export-sources.ts` and cannot see
 * the framework's; the framework's own manifest lives at
 * `lib/framework/privacy/export-sources.ts`, guarded by its own coverage test.
 *
 * NOTE — `@/lib/framework/privacy/export` is imported STATICALLY, matching
 * `admin-nav.ts` rather than `bootstrap.ts`. The static specifier is safe because
 * this filled bridge lives only in Daybreak: vanilla Sunrise ships the empty
 * version with no framework import, and every Daybreak leaf fork has the
 * `lib/framework/` folder, so it always resolves. (`bootstrap.ts` reaches for a
 * dynamic import because it runs at server boot in every runtime; this seam runs
 * only inside the two export route handlers.)
 *
 * **Failures are NOT swallowed here.** A collector that throws fails the whole
 * export — the deliberate opposite of the erasure path, where hook failures are
 * swallowed so app trouble can never block a deletion. An export that quietly
 * lost a section looks exactly like a complete answer to the person reading it.
 *
 * **Keep it complete — and core now checks that you did.** Declare your tables
 * in `initAppSubjectSources()` below. The core guard test
 * (`export-sources.test.ts`) diffs `prisma/schema/*.prisma` against the core
 * manifest so a new core table can't quietly narrow the export, and it holds
 * your tier's schema file to the same rule against your declarations: **every**
 * model in a schema file that is not one of Sunrise's own — `app.prisma`,
 * `framework-*.prisma`, or any other name you choose — must be declared as a
 * source or excluded with a reason, or the suite fails naming it.
 *
 * Full accounting, rather than the user-id heuristic core applies to itself,
 * because core reads its own column vocabulary and cannot read yours: a table
 * keyed `authorId` or `respondentId` is invisible to that scan, and the tables
 * it cannot see are exactly the ones nobody remembers. A lookup or join table
 * holding no personal data is an `excluded` row with a one-line reason — which
 * is the note a DPO wants anyway, and it costs you a line once per table.
 *
 * Full guide: .context/privacy/data-export.md · CUSTOMIZATION.md §4
 */

import { collectFrameworkSubjectData } from '@/lib/framework/privacy/export';
import { initFrameworkSubjectSources } from '@/lib/framework/privacy/export-sources';
import { collectLeafSubjectData, initLeafSubjectSources } from '@/lib/app/leaf-data-export';

/** Identity of the subject being exported. */
export interface AppSubjectQuery {
  /** Id of the data subject. */
  userId: string;
  /** The subject's email — for app tables keyed by address rather than user id. */
  email: string;
}

/**
 * App-owned subject data, keyed by section name. Each section lands under
 * `app.<section>` in the export bundle. Values must be JSON-serialisable.
 */
export type AppSubjectData = Record<string, unknown>;

/**
 * Declare which of your tier's models hold data about a person, and which
 * deliberately do not.
 *
 * **Fork-owned scaffold**, run once and lazily by
 * `lib/privacy/subject-source-registry.ts` before its first read — so the
 * coverage guard and the export both see your declarations with no wiring step.
 *
 * ```ts
 * export function initAppSubjectSources(): void {
 *   registerAppSubjectSources({
 *     tier: 'app',
 *     sources: [
 *       {
 *         model: 'AppInvoice',
 *         section: 'invoices',
 *         disposition: 'export',
 *         description: 'Invoices raised against your account.',
 *       },
 *     ],
 *     excluded: [
 *       { model: 'AppCountry', reason: 'Reference list of countries — holds no personal data.' },
 *     ],
 *   });
 * }
 * ```
 *
 * A framework tier declares from its own init with `tier: 'framework'`; both
 * tiers register independently, so filling this in does not consume the slot a
 * leaf fork is entitled to.
 *
 * **Every `section` you declare must appear in what `collectAppSubjectData()`
 * returns** — `exportUserData()` throws if one is missing. Return the key with
 * an empty array when the subject has no rows rather than omitting it: a bundle
 * short by a section reads exactly like a complete answer. `undefined` counts
 * as missing, because `JSON.stringify` drops the key — so
 * `rows.length ? rows : undefined` is the shape to avoid.
 */
export function initAppSubjectSources(): void {
  // DAYBREAK — the framework tier declares here, NOT from `initFramework()` at
  // boot. Core's registry re-runs only this lazy seam, so a boot-time
  // contribution is lost the first time anything resets the registry — and the
  // coverage guard does exactly that — never to come back. Upstream documents
  // this shape, and it is the same bridge as `bootstrap.ts` → `initFramework()`.
  initFrameworkSubjectSources();
  initLeafSubjectSources();
}

/**
 * Collect Daybreak's data about one subject: the framework tier's sections plus
 * whatever the leaf app contributes — flat, one key of `app` per declared source.
 *
 * Every key returned here is declared in `initAppSubjectSources()` above. That is
 * the contract `exportUserData()` enforces, throwing `DeclaredAppSourceMissingError`
 * on a declared section this fails to produce; on the framework side it holds by
 * construction, because both halves derive from `FRAMEWORK_SUBJECT_DATA_SOURCES`.
 */
export async function collectAppSubjectData(subject: AppSubjectQuery): Promise<AppSubjectData> {
  const [framework, leaf] = await Promise.all([
    collectFrameworkSubjectData(subject),
    collectLeafSubjectData(subject),
  ]);

  // Framework sections spread LAST, so a leaf returning the same key cannot
  // shadow one. It should never reach here: core's registry refuses a section
  // another tier already declared, and a refused declaration fails the coverage
  // guard by name. This is the backstop for the ordering, not the guard itself.
  return { ...leaf, ...framework };
}
