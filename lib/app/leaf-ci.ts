/**
 * Leaf-app CI declarations — RESERVED, empty by default.
 *
 * A leaf app (a fork of Daybreak) declares its **own** coverage exclusions,
 * whole-tree always-run tests and ownerless-surface exceptions here. Daybreak
 * keeps all three lists empty: this is the
 * leaf's CI seam, reserved so a leaf's entries merge cleanly on a Daybreak
 * upgrade — the CI analogue of `lib/app/leaf-bootstrap.ts`,
 * `lib/app/leaf-admin-nav.ts` and `lib/app/leaf-db-drift.ts`.
 *
 * ## Why this file exists at all
 *
 * Sunrise's seam (#759, `lib/app/ci.ts`) is built for **two** tiers — a platform
 * and a fork — and hands the fork one file to fill. Daybreak is the middle of
 * **three**, so `lib/app/ci.ts` is a surface Daybreak is supposed to keep empty
 * *for its own forks*. Filling it directly would put Daybreak's entries in the
 * file a leaf is invited to edit, and the two would collide on every upgrade —
 * precisely the conflict #759 removed one tier up.
 *
 * So `lib/app/ci.ts` becomes one of Daybreak's `lib/app/*` **bridges** (rostered
 * in CLAUDE.md's banner): it declares the
 * framework tier's entries and spreads these three lists after them. All three
 * are append-shaped, so the tiers compose rather than override — unlike
 * `lib/app/brand.ts`, where a leaf replaces Daybreak's value because brand
 * identity is single-valued.
 *
 * ## What your entries are judged by
 *
 * They are spread into `lib/app/ci.ts`, which is spread into Sunrise's own core
 * lists — so every guard Sunrise wrote over those lists judges your entries too,
 * in your checkout. A coverage entry needs a `reason` of at least 20 characters
 * and a pattern nothing else already declares. An always-run entry additionally
 * has to name a file that **exists**, be something the runner can pass to
 * `vitest` as an argument, and sit in a directory `vitest.config.ts` actually
 * collects (`tests/e2e/**` is excluded there, so a spec declared inside it would
 * pass every other check and then silently never run). An ownerless-surface
 * entry has to name a file that exists and still reads one of the three models
 * outside `lib/orchestration/access/`, carry a reason of at least 20
 * characters, and — if it is a `'known-gap'` — say what tracks the fix.
 *
 * See `lib/app/ci.ts` for the three worked examples and the types.
 */

// RELATIVE for the same reason as the import in `ci.ts` — this module is reached
// from `vitest.config.ts` at config-load time, before the `@/` alias exists.
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- see above; the @/ alias does not exist at vitest config-load time.
import type { AppCoverageExclusion, AppAlwaysRunTest, AppOwnerlessSurfaceException } from './ci';

/** Coverage exclusions this LEAF adds. Daybreak ships this empty. */
export const leafCoverageExclusions: AppCoverageExclusion[] = [
  {
    // The leaf's smoke harnesses, the same tier as Sunrise's `scripts/smoke/`
    // and the same shape as its exclusion — the extglob spares any
    // `*-assertions.ts` a harness extracts, so pure logic pulled out of one
    // stays gated. Filled by §10 t-64, the first task to run the per-file gate
    // with one of these in its diff: `smoke-turn.ts` landed at 0% and the run
    // failed on a file vitest never executes.
    pattern: 'scripts/app/smoke-!(*-assertions).ts',
    reason:
      'standalone tsx entry points run by `npm run smoke:app-*` against a ' +
      'live server and the dev database (`.context/app/agent.md`, ' +
      '`safety.md`). Nothing imports them, so vitest never executes them and ' +
      'their coverage is structurally 0% — the per-file gate would fail every ' +
      'edit to one. Their proof is the smoke run itself, which each task ' +
      'names in its done-when.',
  },
];

/**
 * Whole-tree always-run tests this LEAF adds.
 *
 * Every entry here shares one property, and it is the only thing that earns a
 * place on this list: **the test's inputs are files rather than modules**, so no
 * import chain reaches it and `--changed` never selects it. The branch that
 * breaks each one is precisely the branch a scoped run would not have chosen.
 *
 * The first four lived in `scripts/ci/scoped-tests.ts` until Daybreak 0.3.0 — a
 * Sunrise-owned file, carried as Row 4 of `.context/app/divergences.md`. The
 * seam arriving is what retired that row; the entries and their reasons did not
 * change.
 */
export const leafAlwaysRunTests: AppAlwaysRunTest[] = [
  {
    path: 'tests/unit/components/app/ui/tokens-only.test.ts',
    reason:
      'walks `components/app/ui/` off disk and fails on any colour literal, ' +
      'and separately checks that every `var(--color-…)` those components ' +
      'name is actually declared in a stylesheet. Both inputs are files, not ' +
      'modules: the change it exists to catch is a NEW component with a hex ' +
      'in it, or a token deleted from `app/brand-theme.css` — and neither ' +
      'reaches this test through any import chain. A branch touching only the ' +
      'stylesheet would not select it, which is exactly when a token ' +
      'disappears out from under a component that still references it.',
  },
  {
    path: 'tests/unit/app/public/authored-provenance.test.ts',
    reason:
      'reads every file under `app/(public)/` and `components/app/site/` off ' +
      "disk and fails if any of Lelañea Fulton's authored sentences — or a " +
      'trimmed cut of one — appears in the source. It imports only the ' +
      'content loader, so the module graph connects it to NOTHING it scans: a ' +
      'branch that retypes a sentence into a page edits that page and selects ' +
      'every test that imports it, which is not this one. That is the whole ' +
      'blind spot, and it is the exact change the guard exists to catch. It ' +
      'found four such violations already shipped when it was added. Named ' +
      '`.test.ts` because the file has no JSX — which is the correct name on ' +
      'its own merits. It was ALSO forced at the time by sunrise#763, and ' +
      'Daybreak 0.3.0 fixed that: validateAlwaysRun now matches ' +
      '`.(test|spec).[cm]?[jt]sx?`, so a `.test.tsx` entry is accepted. Do ' +
      'not split or rename a component test to get onto this list.',
  },
  {
    path: 'tests/unit/context/app-docs-paths.test.ts',
    reason:
      'checks that every repo path `.context/app/*.md` names still exists. Its ' +
      'inputs are files and it imports none of them, so BOTH branches that ' +
      'break it are invisible to a scoped run: one that renames a component ' +
      'reaches this through no module graph, and one that only edits markdown ' +
      'reaches it through none either. A doc pointing at a moved file is worse ' +
      'than no doc — it reads as authoritative — and nothing else in the suite ' +
      'can see it, since a rename fails type-check while its mention in prose ' +
      'fails nothing. §04 t-22, when `shell.md` arrived naming dozens of ' +
      'paths. `.test.ts` because it has no JSX. sunrise#763 also forced the ' +
      'suffix when this was written; Daybreak 0.3.0 fixed it, so `.tsx` is ' +
      'accepted now and no longer constrains the name.',
  },
  {
    path: 'tests/unit/app/shell-not-found-streaming.test.ts',
    reason:
      'asserts that no `loading` file and no `<Suspense>` wrapping ' +
      '`{children}` sits between the root and a page under `/app`. Next sets ' +
      'a 404 only on a response that has not begun streaming, so breaking ' +
      'either turns every mistyped URL under `/app` into a soft 200 with ' +
      'nothing else failing. Its inputs are files and it imports none of ' +
      'them: the branch that adds a loading state touches no module this ' +
      'would be selected by. Split out of `shell-not-found.test.tsx` in t-22 ' +
      'because validateAlwaysRun then rejected `.test.tsx` (sunrise#763). ' +
      'Daybreak 0.3.0 fixed that, so the split is no longer FORCED — it is ' +
      'kept because separating the file-scanning assertions from the render ' +
      'cases is worth keeping on its own. A future test needs no such split.',
  },
  {
    path: 'tests/unit/components/app/shell/chrome.test.tsx',
    reason:
      'scans every file in `components/app/shell/` for a hard-coded corner ' +
      'radius. Its inputs are the directory LISTING rather than any import, ' +
      'so a scoped run would select it only when a file it already covers ' +
      'changes — and the failure it exists to catch is a NEW control arriving ' +
      'with a radius of its own, which reaches this through no module graph at ' +
      'all. The four radii it replaced each looked deliberate alone; the owner ' +
      'saw them together as a shell that could not decide. t-43.',
  },
  {
    path: 'tests/unit/lib/app/voice/upload-scope.test.ts',
    reason:
      'reads `prisma/schema/orchestration-knowledge.prisma` and every `.ts` ' +
      'under `lib/` and `app/` off disk, to pin the two things that decide where an ' +
      'uploaded document lands: the `@default` on ' +
      '`AiKnowledgeDocument.scope`, and the scope each ' +
      '`aiKnowledgeDocument.create` site writes. The SCHEMA half is why this ' +
      'is on the list — a Daybreak sync can change that one word with no diff ' +
      'in any TypeScript file, so no module graph connects it to anything, and ' +
      'every upload from `/admin/app/knowledge` would then land somewhere the ' +
      'designation table cannot see while the uploads themselves still ' +
      'succeed. (An omitted `scope` is NOT the risk — it defaults to `app` and ' +
      'shows up fine. /code-review pushed on this guard being too narrow; the ' +
      'schema settled which half was actually unpinned.) t-44.',
  },
];

/**
 * Files this LEAF allows to read `AiWorkflowExecution`, `AiConversation` or
 * `AiMessage` outside the access helpers. A file that starts to should import
 * the helper first, and land here only when the helper cannot express it.
 */
export const leafOwnerlessSurfaceExceptions: AppOwnerlessSurfaceException[] = [
  {
    path: 'lib/app/agent/turn-record.ts',
    disposition: 'by-design',
    reason:
      'the turn record reads two message rows of ONE turn — the reply it ' +
      'links at completion and replays later — on behalf of the member who took ' +
      'it. It runs inside the facilitation turn hook, which is handed a user id ' +
      'and no session, so `conversationVisibilityWhere` has nothing to take. ' +
      'Both reads name the conversation the platform reported for this turn AND ' +
      '`conversation: { userId }` of the turn row, so they can only ever match ' +
      'that member’s own messages — never an ownerless or shared thread, which ' +
      'is the set the helper exists to decide about. §08 t-54.',
  },
  {
    path: 'lib/app/agent/metering.ts',
    disposition: 'by-design',
    reason:
      'the meter joins the conversation table only to SEAT a cost row written before ' +
      'rows were tagged: it reads `contextType` and `contextId` of the ' +
      'conversation a cost row already points at, and nothing else — no ' +
      'message, no title, no other column. Which rows are read is decided on ' +
      'the COST LOG: a member route passes its own session id and the SQL ' +
      'filters `ai_cost_log.userId` on it; the only callers passing none are ' +
      'behind `withAdminAuth`. The access helper answers "which conversations ' +
      'may this caller see", which is not the question — the caller never sees ' +
      'the conversation, only the seat label of their own spend. §08 t-56.',
  },
];
