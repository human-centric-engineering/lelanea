/**
 * Daybreak's own changelog is structurally valid (#239 gap 1).
 *
 * `.context/framework/CHANGELOG.md` is what a leaf fork reads before merging a
 * Daybreak release, and until now **nothing checked its shape**. Sunrise's
 * structure check (`npm run validate`) is hardcoded to the root `CHANGELOG.md`,
 * so a malformed section, a duplicated `###`, or a release heading out of order
 * shipped silently. 0.2.0's own notes record consolidating duplicate `###`
 * headings — found by hand, after the fact.
 *
 * This asserts against the REAL file rather than a fixture, because the fixture
 * version of this test would have passed throughout the period the real file was
 * wrong. It reads the tree, so it is declared in `appAlwaysRunTests`
 * (`lib/app/ci.ts`) — a scoped run selects by module graph, and no import chain
 * reaches a changelog.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { checkChangelogStructure, parseChangelog } from '@/scripts/ci/changelog-structure';
import {
  checkFrameworkChangelogStructure,
  isPermittedCategory,
  EXTRA_CATEGORIES,
  CHANGELOG_PATH,
} from '@/scripts/release/lib';
import { DAYBREAK_VERSION } from '@/lib/daybreak-version';

const source = readFileSync(join(process.cwd(), CHANGELOG_PATH), 'utf8');

describe('the framework changelog is structurally valid', () => {
  it('has no violations Daybreak does not deliberately permit', () => {
    const violations = checkFrameworkChangelogStructure(
      source,
      DAYBREAK_VERSION,
      checkChangelogStructure,
      parseChangelog
    );

    expect(
      violations.map((v) => `${CHANGELOG_PATH}:${v.line}  ${v.message}`),
      'structural problems in the framework changelog'
    ).toEqual([]);
  });
});

describe('the filter removes ONLY category violations', () => {
  it('drops nothing except headings isPermittedCategory accepts', () => {
    // "The result is empty" is satisfied just as well by a filter that swallows
    // everything. This pins WHAT is removed: every violation the filter drops must
    // be a category violation for a heading Daybreak documents. Anything else
    // surviving into the drop set is the filter overreaching.
    const raw = checkChangelogStructure(source, { sunriseVersion: DAYBREAK_VERSION });
    const kept = checkFrameworkChangelogStructure(
      source,
      DAYBREAK_VERSION,
      checkChangelogStructure,
      parseChangelog
    );

    const keptKeys = new Set(kept.map((v) => `${v.line}:${v.message}`));
    const dropped = raw.filter((v) => !keptKeys.has(`${v.line}:${v.message}`));

    for (const v of dropped) {
      expect(v.message, `dropped a non-category violation at line ${v.line}`).toContain(
        'is not a Keep a Changelog category'
      );
      const label = /^"### (.*?)" is not/u.exec(v.message)?.[1] ?? '';
      expect(isPermittedCategory(label), `dropped an unpermitted heading: ${label}`).toBe(true);
    }

    // And the filter is doing real work — if this ever drops to zero, the extras
    // have gone from the file and EXTRA_CATEGORIES should go with them.
    expect(dropped.length).toBeGreaterThan(0);
  });
});

describe('the permitted-category rule', () => {
  it('permits Daybreak’s documented extras', () => {
    for (const { label } of EXTRA_CATEGORIES) {
      expect(isPermittedCategory(label), label).toBe(true);
    }
  });

  it('permits the action-required marker on any standard category', () => {
    expect(isPermittedCategory('⚠️ Changed — action required for existing leaf forks')).toBe(true);
    expect(isPermittedCategory('⚠️ Removed — action required')).toBe(true);
  });

  it('still rejects a typo, which is the whole point of keeping the check', () => {
    // The filter must not become "anything goes". These are the shapes a real
    // mistake takes: a near-miss of a standard category, and a heading that
    // looks like the marker but carries no reason.
    expect(isPermittedCategory('Add')).toBe(false);
    expect(isPermittedCategory('Fixes')).toBe(false);
    expect(isPermittedCategory('Platfrom')).toBe(false);
    expect(isPermittedCategory('⚠️ Changed')).toBe(false);
    expect(isPermittedCategory('⚠️ Nonsense — action required')).toBe(false);
  });
});

describe('the check can still report', () => {
  it('fails a changelog with a genuine structural defect', () => {
    // PROVE IT CAN REPORT. A filter that swallowed everything would make the
    // assertion above pass forever against any file, which is the failure this
    // whole test exists to prevent — so the filter is exercised against known-bad
    // input rather than trusted.
    const broken = source.replace('### Added', '### Addded');

    const violations = checkFrameworkChangelogStructure(
      broken,
      DAYBREAK_VERSION,
      checkChangelogStructure,
      parseChangelog
    );

    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.message.includes('Addded'))).toBe(true);
  });

  it('reports the version mismatch against DAYBREAK_VERSION, not the platform', () => {
    const violations = checkFrameworkChangelogStructure(
      source,
      '99.0.0',
      checkChangelogStructure,
      parseChangelog
    );

    const versionFinding = violations.find((v) => v.message.includes('99.0.0'));
    expect(versionFinding, 'expected a version-mismatch violation').toBeDefined();
    // The rule is Sunrise's; the wording must not send a fork editing
    // `lib/sunrise-version.ts`, which forks are told never to touch.
    expect(versionFinding?.message).toContain('DAYBREAK_VERSION');
    expect(versionFinding?.message).not.toContain('SUNRISE_VERSION');
    expect(versionFinding?.message).not.toContain('sunrise-version.ts');
  });
});

describe('permitting a heading must not exempt it from the OTHER rules', () => {
  const check = (text: string) =>
    checkFrameworkChangelogStructure(
      text,
      DAYBREAK_VERSION,
      checkChangelogStructure,
      parseChangelog
    );

  it('still catches a duplicated ### Platform in one release section', () => {
    // The gap this closes: Sunrise's category loop `return`s after pushing "not a
    // Keep a Changelog category", so a non-canonical label never reaches the
    // duplicate check below it. Filtering that violation out removed the only rule
    // that ever looked at these headings — permitting a heading accidentally
    // exempted it from the split-section rule entirely.
    //
    // A leaf scanning a release for what the Sunrise sync changed reads the first
    // `### Platform` block and stops. 0.2.0's notes record fixing exactly this,
    // by hand.
    const doubled = source.replace('### Platform', '### Platform\n\n- first block\n\n### Platform');

    const violations = check(doubled);

    expect(violations.some((v) => v.message.includes('appears twice'))).toBe(true);
  });

  it('catches a duplicated ⚠️ action-required heading too', () => {
    const marker = '### ⚠️ Changed — action required for existing leaf forks';
    const doubled = source.replace(marker, `${marker}\n\n- a\n\n${marker}`);

    expect(check(doubled).some((v) => v.message.includes('appears twice'))).toBe(true);
  });

  it('does not invent a duplicate across DIFFERENT release sections', () => {
    // `### Platform` legitimately appears in 0.1.0 and 0.2.0. Keying on the label
    // alone rather than on (section, label) would report the real file as broken.
    expect(check(source).some((v) => v.message.includes('appears twice'))).toBe(false);
  });

  it('cannot be suppressed by a heading whose own label mimics the message', () => {
    // The filter used to parse the label back out of Sunrise's rendered message
    // with a lazy `/^"### (.*?)" is not/`. A heading of `Platform" is not` produced
    // `"### Platform" is not" is not a Keep a Changelog category…`, the regex
    // extracted `Platform`, and the violation was dropped — content in the
    // changelog suppressing a check over the changelog. Keyed on line number now,
    // and a heading cannot lie about which line it is on.
    const crafted = source.replace('### Added', '### Platform" is not');

    const violations = check(crafted);

    expect(violations.some((v) => v.message.includes('is not a Keep a Changelog category'))).toBe(
      true
    );
  });
});

describe('a truncated parse stops the cross-heading rules', () => {
  it('does not report a duplicate heading about a file it stopped reading', () => {
    // `checkChangelogStructure` returns early on truncation so no cross-heading rule
    // draws a conclusion from a partial set. The appended duplicate pass had no such
    // guard, so an unclosed code fence produced "### Platform appears twice" about a
    // file read a third of the way through — confident nonsense, which is exactly
    // what the upstream early-return exists to suppress.
    const truncated = `${source}\n\n\`\`\`ts\nconst unclosed = true;\n`;

    const violations = checkFrameworkChangelogStructure(
      truncated,
      DAYBREAK_VERSION,
      checkChangelogStructure,
      parseChangelog
    );

    expect(violations.some((v) => v.message.includes('appears twice'))).toBe(false);
    // …and it still reports the fence itself, which is the actionable finding.
    expect(violations.length).toBeGreaterThan(0);
  });
});
