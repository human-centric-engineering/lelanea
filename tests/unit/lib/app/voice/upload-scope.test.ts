/**
 * The agreement that makes "add material here" and "designate it here" one page.
 *
 * The uploader on `/admin/app/knowledge` is Sunrise's, posting to Sunrise's
 * routes, and the table under it is ours, filtering on `scope: APP_SCOPE`. What
 * joins them is the scope a newly ingested document lands with — and the leaf
 * passes nothing about scope, because there is nothing to pass.
 *
 * **The agreement crosses a tier boundary, which is why it needs a test here.**
 * Sunrise's own suite pins the literal `'app'` against itself; ours pins the
 * whole chain against `APP_SCOPE`, the constant the list and the grant rule
 * read. Nothing in either tier compares the two, and the failure is invisible in
 * review: the upload succeeds, the row exists, and the table is simply short.
 *
 * ## Two things decide where a document lands, and only one is in the code
 *
 * The first version of this file checked only the explicit writes in
 * `document-manager.ts`, and described the risk as "a new ingestion path that
 * forgot the scope". **That risk does not exist**: the column is
 * `@default("app")`, so a create site that omits `scope` still lands in the
 * table. /code-review pushed on the narrowness and the schema settled it the
 * other way — the omission is harmless and the DEFAULT is the unpinned part.
 *
 * So this checks both halves of what actually decides it:
 *
 *  1. **The schema default** — the value an omitted `scope` takes. Nothing else
 *     in either tier pins it, and a Daybreak sync could change it with no diff
 *     in any TypeScript file at all, which is the one change no import graph and
 *     no reviewer's eye would connect to this page.
 *  2. **Every explicit write under `lib/` and `app/`** — checked against what
 *     its file is entitled to write, so the seeder's deliberate `'system'`
 *     stays distinguishable from the ingestion paths' `'app'`. A create site
 *     flipped from one to the other is the change that silently empties her
 *     list, and it is a one-word diff. `app/` is in the scan because a route
 *     handler creating a document directly is precisely the new ingestion path
 *     worth noticing, and it would not be under `lib/`.
 *
 * Read from source rather than exercised through a mocked client on purpose:
 * there are four create sites across two files and a schema line, and no
 * behavioural test reaches the schema line at all.
 *
 * @see components/app/admin/knowledge-workspace.tsx — the uploader on the leaf page
 * @see tests/unit/lib/app/voice/designation-admin.test.ts — the other half: the list's filter
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { APP_SCOPE } from '@/lib/app/voice/corpus-access';

const ROOT = process.cwd();
const SCHEMA = join(ROOT, 'prisma/schema/orchestration-knowledge.prisma');

/**
 * What each file is allowed to write, for the sites that write a literal at all.
 *
 * A map rather than a pinned list of every site, and the difference matters. The
 * first version deep-equalled the whole set, so **the test went red on changes
 * its own docblock calls harmless**: a create site added without a `scope` was
 * recorded as `null` and failed the comparison, and one refactored to
 * `scope: APP_SCOPE` stopped being a literal and dropped out of it. Both are
 * benign — the column defaults to `app` — and both would have turned an
 * always-run, whole-tree test red across the repo on a Daybreak sync. Caught by
 * /code-review.
 *
 * What is left is the property actually worth holding: **no file writes a scope
 * it is not entitled to write.** The seeder's `'system'` is the one deliberate
 * exception, and keeping it named here is what stops a one-word flip in
 * `document-manager.ts` — the change that silently empties her list — from
 * reading as just another create site.
 *
 * `scripts/` is deliberately out of the scan: a smoke script or a dev harness
 * writing its own fixture is not an ingestion path the uploader can reach, and
 * including them would fail this on work that cannot affect her list.
 */
const ALLOWED_SCOPE_BY_FILE: Readonly<Record<string, string>> = {
  // The three ingestion paths — text, binary, and the PDF pending-review row.
  'lib/orchestration/knowledge/document-manager.ts': APP_SCOPE,
  // The bundled Agentic Design Patterns corpus, and the one site that SHOULD
  // differ: a `system` document is searchable by every agent whatever anyone
  // designates it, which is exactly why the table refuses to list one.
  'lib/orchestration/knowledge/seeder.ts': 'system',
};

/** Every `.ts` file under a directory, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** The argument at each `aiKnowledgeDocument.create(` / `.createMany(`, by brace matching. */
function createCalls(source: string): string[] {
  const marker = /aiKnowledgeDocument\.create(Many)?\(/g;
  const calls: string[] = [];

  for (let m = marker.exec(source); m !== null; m = marker.exec(source)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let index = open;
    for (; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(source.slice(open + 1, index));
  }

  return calls;
}

describe('where a newly ingested document lands', () => {
  it('the schema default is the scope the designation table filters on', () => {
    const model = /model AiKnowledgeDocument\s*\{([\s\S]*?)\n\}/.exec(readFileSync(SCHEMA, 'utf8'));

    // Establish the model was actually found before asserting about its fields —
    // a regex that matched nothing would make every claim below vacuous (`fp6`).
    expect(model).not.toBeNull();

    const scopeField = /^\s*scope\s+String\s+@default\("([^"]+)"\)/m.exec(model![1]);
    expect(scopeField).not.toBeNull();

    // The half nothing else pins. Every create site could be correct and this
    // one word could still send every upload somewhere the table cannot see —
    // and it is changed by a schema edit, which reaches this page through no
    // import graph and no TypeScript diff.
    expect(scopeField![1]).toBe(APP_SCOPE);
  });

  it('no ingestion path writes a scope its file is not entitled to write', () => {
    const found = [...sourceFiles(join(ROOT, 'lib')), ...sourceFiles(join(ROOT, 'app'))]
      .flatMap((path) =>
        createCalls(readFileSync(path, 'utf8')).map((call) => ({
          file: path.slice(ROOT.length + 1),
          scope: /\bscope:\s*'([^']+)'/.exec(call)?.[1] ?? null,
        }))
      )
      // Sites that write no string literal are not this test's business: an
      // omitted `scope` takes the schema default, which the case above pins.
      .filter((site): site is { file: string; scope: string } => site.scope !== null);

    // Establish the population BEFORE claiming anything about it. A scan that
    // silently found nothing — a moved file, a changed call spelling — would
    // make the assertion below pass on an empty array, which is the shape of a
    // guard that has quietly stopped guarding (`fp6`).
    for (const file of Object.keys(ALLOWED_SCOPE_BY_FILE)) {
      expect(found.filter((site) => site.file === file).length).toBeGreaterThan(0);
    }

    // `app/` is scanned as well as `lib/`, because a route handler or a server
    // action creating a document directly is exactly the new ingestion path this
    // is here to notice, and it would not be under `lib/`.
    expect(found.filter((site) => ALLOWED_SCOPE_BY_FILE[site.file] !== site.scope)).toEqual([]);
  });
});
