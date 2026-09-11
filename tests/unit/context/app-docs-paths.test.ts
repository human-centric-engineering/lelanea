/**
 * Every repo path our own documentation names still exists.
 *
 * ## Why this is a test and not a review habit
 *
 * `.context/app/shell.md` alone names dozens of paths. A doc that points at a
 * file which has moved is worse than no doc: it reads as authoritative, and the
 * reader who follows it loses more time than the one who went looking. Nothing
 * else in the suite can see it — a renamed component fails type-check, and its
 * mention in prose fails nothing at all.
 *
 * ## Why it is in `ALWAYS_RUN_TESTS`
 *
 * Its inputs are FILES, and it imports none of them. A branch that renames a
 * component reaches this through no module graph, and a branch that only edits
 * markdown reaches it through none either — so a scoped run would skip it on
 * exactly the two branches that break it. That is the condition
 * `scripts/ci/scoped-tests.ts` describes for appending, and this is the third
 * leaf entry (see `.context/app/divergences.md` row 4).
 *
 * `.test.ts`, deliberately, and not `.tsx`: `validateAlwaysRun` rejects a
 * `.test.tsx` path outright and aborts the runner — `sunrise#763`.
 *
 * ## What it checks, and what it deliberately does not
 *
 * Only backticked strings CONTAINING A SLASH, plus relative markdown link
 * targets. A bare `` `waitlist.md` `` inside link text is skipped, because the
 * link's own target is checked instead and resolving bare filenames would mean
 * guessing which directory the author meant. Prose about a path that does not
 * exist yet — a planned file — should not be in backticks as though it did.
 *
 * `planning/` is out of scope: it holds the product description and the design
 * prompt, which describe an intended product rather than this tree.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const APP_DOCS = path.join(process.cwd(), '.context', 'app');

/** The maintained docs — top level only, so `planning/` is excluded. */
function docFiles(): string[] {
  return readdirSync(APP_DOCS, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort();
}

/** Fenced blocks are shell and code samples, not claims about this tree. */
function stripFences(source: string): string {
  return source.replace(/```[\s\S]*?```/g, '');
}

/**
 * Backticked repo paths: a slash, and either an extension we ship or a trailing
 * slash marking a directory.
 *
 * `js` is deliberately NOT in the extension list. Adding it would newly flag
 * `divergences.md`'s `next/dist/lib/metadata/resolvers/resolve-url.js`, which
 * is a `node_modules` path — a real thing to name and not a claim about this
 * tree.
 */
const BACKTICKED_PATH =
  /`([A-Za-z0-9_\-.[\]()]+(?:\/[A-Za-z0-9_\-.[\]()*]+)+(?:\.(?:tsx?|mjs|css|json|prisma|md|html)|\/))`/g;

/**
 * Markdown link targets, including `#fragment` and bare `sibling.md`.
 *
 * The first version required a `./` or `../` prefix and forbade `#`, so
 * `[x](shell.md)` and `[x](./shell.md#the-frame)` were both skipped in
 * silence — the second because backtracking can only shorten the match, so
 * hitting the `#` killed the whole link rather than trimming it. Both are
 * spellings this tree invites: `shell.md` is heading-dense and the See-also
 * convention wants anchors.
 *
 * Absolute URLs and same-page anchors are filtered in the loop rather than
 * excluded here, so the pattern stays readable.
 */
const MARKDOWN_LINK = /\]\(([^)\s#]+)(?:#[^)\s]*)?\)/g;

/**
 * A glob stands for a set, so its nearest fixed ANCESTOR is what has to exist.
 *
 * `path.dirname` was wrong: it strips one segment, so
 * `components/app/**\/*.tsx` became `components/app/**` — a directory that
 * never exists, and a bogus failure. Cut at the first segment containing a
 * star instead.
 */
function resolveClaim(raw: string): string {
  const segments = raw.split('/');
  const star = segments.findIndex((segment) => segment.includes('*'));
  const cleaned = star === -1 ? raw : segments.slice(0, star).join('/');
  return path.join(process.cwd(), cleaned);
}

/**
 * Paths a doc names on purpose that this tree does not contain.
 *
 * Appended to with a REASON, never silently. Both of these are real categories
 * rather than one-offs, and both were found by the first run of this file.
 */
interface Exemption {
  reason: string;
  /**
   * The path is not in this repository at all, so "it came back" is not a state
   * that can be checked. Without this flag the staleness guard below would have
   * to special-case a literal prefix, which is what it did first — and the
   * second out-of-tree entry would have had to add another one.
   */
  outsideTree?: true;
}

const NOT_IN_THIS_TREE: Record<string, Exemption> = {
  // `divergences.md` records the two public pages the fork DELETED. Naming a
  // removed file is the entry's whole content; it is not a claim the file is
  // there.
  'app/(public)/about/page.tsx': { reason: 'named by divergences.md as deleted' },
  'app/(public)/contact/page.tsx': { reason: 'named by divergences.md as deleted' },
  // A separate checkout (`~/code/dev-proxy`).
  'dev-proxy/apps.json': { reason: 'lives in the dev-proxy repo', outsideTree: true },
};

describe('every path our docs name resolves', () => {
  it.each(docFiles())('%s', (name) => {
    const source = stripFences(readFileSync(path.join(APP_DOCS, name), 'utf8'));

    const missing: string[] = [];

    for (const [, claim] of source.matchAll(BACKTICKED_PATH)) {
      // A backticked path starting with `.` is doc-RELATIVE — the markdown link
      // beside it is the same target, and the loop below resolves that one
      // correctly. Resolving these from the repo root reported four healthy
      // links as broken on the first run, which is how this branch was found.
      if (claim.startsWith('.')) continue;
      if (claim in NOT_IN_THIS_TREE) continue;
      if (!existsSync(resolveClaim(claim))) missing.push(claim);
    }

    for (const [, href] of source.matchAll(MARKDOWN_LINK)) {
      // Off-tree targets and same-page anchors are not claims about this repo.
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href)) continue;
      if (!existsSync(path.resolve(APP_DOCS, href))) missing.push(href);
    }

    expect(missing, `${name} points at files that do not exist`).toEqual([]);
  });

  it('still needs every exemption it carries', () => {
    // An exemption that has stopped being true is a hole. The deleted-page
    // entries must stay deleted, and if one comes back the row recording its
    // deletion is wrong too.
    for (const [claim, { reason, outsideTree }] of Object.entries(NOT_IN_THIS_TREE)) {
      if (outsideTree) continue;
      expect(existsSync(resolveClaim(claim)), `${claim} exists again — ${reason}`).toBe(false);
    }
  });

  it('is looking at the docs it thinks it is', () => {
    // Without this, a rename of `.context/app/` would empty `docFiles()` and
    // every case above would vanish rather than fail — the shape of clean
    // result that means "could not look" rather than "found nothing".
    const docs = docFiles();
    expect(docs.length).toBeGreaterThanOrEqual(7);
    expect(docs).toContain('shell.md');
  });
});
