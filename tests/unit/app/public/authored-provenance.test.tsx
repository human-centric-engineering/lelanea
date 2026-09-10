/**
 * No sentence of Lelañea Fulton's is typed into the public site's source.
 *
 * The owner's t-6 ruling is that the authored documents win outright: the
 * prototype supplies layout, eyebrows and rules, and every sentence a visitor
 * reads is rendered from `content/lelanea_foundational_documents.json` at run
 * time. This is the test that makes that a property of the tree rather than an
 * intention, and it is the done-when line the task asks for.
 *
 * ## Why a rule needs a test at all
 *
 * The rule is easy to keep and impossible to notice breaking. A retyped
 * sentence looks identical on the page, passes type-check, passes lint, renders
 * in both themes and reads correctly to every reviewer — right up until the
 * authored file is edited and one of the two copies moves. Then the site says
 * two different things and neither is wrong-looking.
 *
 * t-5 is the proof. It shipped the home page's `h1`, its lede and its quote
 * band as string literals lifted from `the_heart_behind_lelanea`, and nothing
 * in the tree noticed for a whole task. That is what this catches.
 *
 * ## Sentinel PHRASES, not whole strings
 *
 * Comparing whole paragraphs would miss the failure that actually happens. The
 * prototype's mission headline is "The journey inward should never be reserved
 * for the privileged." — which is her sentence with "Coach Lelañea Fulton
 * believes that" trimmed off the front. It is not equal to any authored string;
 * it is a re-cut of one, and a re-cut is the same second copy with the same
 * drift.
 *
 * So every run of {@link WINDOW} consecutive words in every authored paragraph
 * is a sentinel, and none of them may appear in source. Six words is short
 * enough to catch a trimmed clause and long enough that an accidental collision
 * with ordinary code or chrome copy does not happen — the suite would say so
 * immediately if it did.
 *
 * ## What is deliberately NOT scanned
 *
 * **Headings.** `/data` selects three sections of the disclaimer by their
 * authored headings, so `'What Lelañea Is Not'` is necessarily a literal in
 * that file — as a SELECTOR. Heading drift is guarded a different way and
 * better: `selectSection` throws when a heading is not found, so a renamed
 * heading fails loudly at render and in `sections.test.ts` rather than
 * rendering stale words. Only paragraph and list-item text goes into the pool.
 *
 * **Everything outside the public site.** The scan is the public surface, which
 * is where her documents are published. A future authoring or admin surface
 * that legitimately handles this text would be a different rule.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { listFoundationalDocuments, getFoundationalDocument } from '@/lib/app/content';

/** Consecutive words per sentinel. See the header for why six. */
const WINDOW = 6;

const REPO_ROOT = path.resolve(__dirname, '../../../..');

/**
 * The directories a visitor's words are rendered from.
 *
 * `app/(public)` is the pages; `components/app/site` is the header, footer and
 * waitlist card, which are just as capable of carrying a retyped sentence and
 * would carry it on every page at once.
 */
const SCANNED_DIRS = ['app/(public)', 'components/app/site'];

function sourceFilesIn(dir: string): string[] {
  const absolute = path.join(REPO_ROOT, dir);

  return readdirSync(absolute, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/**
 * Source as comparable words.
 *
 * Comments are stripped FIRST and this is the load-bearing step: these files
 * explain at length which authored sentences they render and why, quoting them
 * to do it. Without stripping, every one of those explanations would fail as
 * the defect it is explaining — and the fix a reader would reach for is to
 * delete the explanation.
 *
 * Then everything that is not a letter, digit or space becomes a space, which
 * collapses JSX line wrapping, string concatenation (`'…' + '…'`), curly versus
 * straight quotes, and en dashes versus hyphens into one shape. A retyped
 * sentence survives all of those transformations; that is what makes it a
 * retyped sentence.
 */
function comparableSource(file: string): string {
  const raw = readFileSync(file, 'utf8');

  const withoutComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  return normalise(withoutComments);
}

/** The same shape, for authored text. */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Every run of `WINDOW` words in a string, as space-joined phrases. */
function sentinels(text: string): string[] {
  const words = normalise(text).split(' ').filter(Boolean);
  if (words.length < WINDOW) return [];

  return Array.from({ length: words.length - WINDOW + 1 }, (_, i) =>
    words.slice(i, i + WINDOW).join(' ')
  );
}

/** Every authored paragraph and list item, across every document. */
function authoredProse(): { documentId: string; text: string }[] {
  return listFoundationalDocuments().documents.flatMap((summary) => {
    const document = getFoundationalDocument(summary.id);
    if (!document) throw new Error(`Document "${summary.id}" is indexed but does not resolve.`);

    return document.blocks.flatMap((block) => {
      if (block.type === 'paragraph') return [{ documentId: document.id, text: block.text }];
      if (block.type === 'list') {
        return block.items.map((item) => ({ documentId: document.id, text: item }));
      }
      return [];
    });
  });
}

describe('authored provenance on the public site', () => {
  const files = SCANNED_DIRS.flatMap(sourceFilesIn);

  it('scans the files it claims to', () => {
    // Guards the guard. `sourceFilesIn` walking the wrong directory, or a
    // rename moving the pages out from under it, produces an empty file list
    // and a test that passes by looking at nothing — the failure mode every
    // filesystem-driven check has, and the reason this case is first.
    const relative = files.map((file) => path.relative(REPO_ROOT, file));

    expect(relative).toContain('app/(public)/page.tsx');
    expect(relative).toContain('app/(public)/lelanea/page.tsx');
    expect(relative).toContain('app/(public)/mission/page.tsx');
    expect(relative).toContain('app/(public)/data/page.tsx');
    expect(relative).toContain('app/(public)/disclaimer/page.tsx');
    expect(relative).toContain('app/(public)/terms/page.tsx');
    expect(relative).toContain('components/app/site/site-footer.tsx');
  });

  it('has sentinels to look for', () => {
    // The other half of guarding the guard: a loader change that returned no
    // documents would empty the pool and pass everything below.
    const prose = authoredProse();

    expect(prose.length).toBeGreaterThan(200);
    expect(prose.flatMap((entry) => sentinels(entry.text)).length).toBeGreaterThan(2000);
  });

  it('never inlines an authored sentence, or a cut of one', () => {
    const sources = files.map((file) => ({
      file: path.relative(REPO_ROOT, file),
      text: comparableSource(file),
    }));

    const found: string[] = [];

    for (const { documentId, text } of authoredProse()) {
      for (const phrase of sentinels(text)) {
        for (const source of sources) {
          if (source.text.includes(phrase)) {
            found.push(`${source.file} carries "${phrase}…" from the "${documentId}" document`);
          }
        }
      }
    }

    // Deduplicated: one retyped paragraph produces a sentinel hit per window,
    // so a single mistake would otherwise report forty times and bury any
    // second one under it.
    expect([...new Set(found)].slice(0, 10)).toEqual([]);
  });
});
