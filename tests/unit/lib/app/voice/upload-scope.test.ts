/**
 * The agreement that makes "add material here" and "designate it here" one page.
 *
 * The uploader on `/admin/app/knowledge` is Sunrise's, posting to Sunrise's
 * routes, and the table under it is ours, filtering on `scope: APP_SCOPE`. What
 * joins them is that every ingestion path in
 * `lib/orchestration/knowledge/document-manager.ts` hardcodes `scope: 'app'` —
 * so the leaf passes nothing about scope, because there is nothing to pass.
 *
 * **That agreement crosses a tier boundary, which is why it needs a test here.**
 * Sunrise's own suite pins the literal `'app'` against itself; ours pins it
 * against `APP_SCOPE`, the constant the list and the grant rule read. Nothing in
 * either tier compares the two, so a platform sync that renamed the scope — or
 * added a fourth ingestion path that forgot it — would leave this page silently
 * accepting documents that never appear in the table below the uploader, and no
 * test of ours would say so. The failure is invisible in review: the upload
 * succeeds, the row exists, and the list is simply short.
 *
 * Read from source rather than exercised through a mocked client on purpose.
 * There are three create sites and the leaf page can reach all three — a
 * markdown or text file, a binary the parsers handle, and a PDF, which lands in
 * `pending_review` — so a behavioural test would need three fixtures to say what
 * one pass over the file says about every path at once, including one added
 * tomorrow.
 *
 * @see components/app/admin/knowledge-workspace.tsx — the uploader on the leaf page
 * @see tests/unit/lib/app/voice/designation-admin.test.ts — the other half: the list's filter
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { APP_SCOPE } from '@/lib/app/voice/corpus-access';

const DOCUMENT_MANAGER = join(process.cwd(), 'lib/orchestration/knowledge/document-manager.ts');

/**
 * How many `aiKnowledgeDocument.create` sites the platform has today.
 *
 * Pinned rather than merely iterated, and this is the half that earns the test.
 * Iterating alone passes on a file where a create site was ADDED without the
 * scope — because the loop would still find every site it knew about correct.
 * The count is what turns a new ingestion path into a failure somebody reads on
 * the sync that brings it, rather than a short list somebody reports as a bug in
 * the designation page months later.
 */
const EXPECTED_CREATE_SITES = 3;

/** The `create({ ... })` argument at each call site, by brace matching. */
function createCallArguments(source: string): string[] {
  const marker = 'aiKnowledgeDocument.create(';
  const calls: string[] = [];

  let from = 0;
  for (;;) {
    const start = source.indexOf(marker, from);
    if (start === -1) break;

    let depth = 0;
    let index = start + marker.length - 1;
    for (; index < source.length; index += 1) {
      if (source[index] === '(') depth += 1;
      else if (source[index] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }

    calls.push(source.slice(start + marker.length, index));
    from = index;
  }

  return calls;
}

describe('every ingestion path writes the scope the designation table reads', () => {
  const source = readFileSync(DOCUMENT_MANAGER, 'utf8');
  const calls = createCallArguments(source);

  it('finds the create sites it expects — so a new one is a failure, not a silence', () => {
    expect(calls).toHaveLength(EXPECTED_CREATE_SITES);
  });

  it.each(calls.map((call, index) => [index, call]))(
    'create site %i writes scope: APP_SCOPE',
    (_index, call) => {
      // Establish the extractor actually got a `data` block before claiming
      // anything about what is in it: a regex that silently matched nothing
      // would make the assertion below pass on an empty string (`fp6`).
      expect(call).toContain('data:');
      expect(call).toContain(`scope: '${APP_SCOPE}'`);
    }
  );
});
