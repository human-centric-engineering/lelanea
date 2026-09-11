/**
 * Tests: scripts/release/lib.ts — the changelog guard's decision logic.
 *
 * Table-driven over file lists, because the logic IS a function of the file list;
 * no git, no fs, no fixtures. The cases that matter are the two failure modes a
 * guard can have: firing when it shouldn't (which trains people to bypass it) and
 * staying silent when it should fire (which is the gap it exists to close).
 *
 * @see scripts/release/lib.ts · .context/framework/VERSIONING.md
 */

import { describe, it, expect } from 'vitest';
import {
  checkChangelog,
  formatVerdict,
  CHANGELOG_PATH,
  barrelReason,
  pushEventBeforeSha,
} from '@/scripts/release/lib';

describe('checkChangelog', () => {
  describe('fires on a public-surface change with no entry', () => {
    it('flags a lib/app/* seam — the change that breaks a leaf', () => {
      // The 0.1.0 case exactly: data-export.ts changing hands. A leaf that filled
      // it needs to be told, and nothing else in CI would say so.
      const verdict = checkChangelog(['lib/app/data-export.ts']);

      expect(verdict.violation).toBe(true);
      expect(verdict.triggers).toHaveLength(1);
      expect(verdict.triggers[0]?.path).toBe('lib/app/data-export.ts');
      expect(verdict.triggers[0]?.reason).toContain('changing hands');
    });

    it('flags a framework_* schema change', () => {
      const verdict = checkChangelog(['prisma/schema/framework-facilitation.prisma']);
      expect(verdict.violation).toBe(true);
    });

    it('flags the version constant', () => {
      const verdict = checkChangelog(['lib/daybreak-version.ts']);
      expect(verdict.violation).toBe(true);
    });

    it('collects every trigger, not just the first', () => {
      // The message names all of them; a developer fixing one and re-running
      // should not discover the next one only on the following CI run.
      const verdict = checkChangelog([
        'lib/app/bootstrap.ts',
        'lib/daybreak-version.ts',
        'lib/framework/modules/service.ts',
      ]);

      expect(verdict.triggers.map((t) => t.path)).toEqual([
        'lib/app/bootstrap.ts',
        'lib/daybreak-version.ts',
      ]);
    });
  });

  describe('stays silent when it should', () => {
    it('passes when the changelog was updated alongside', () => {
      const verdict = checkChangelog(['lib/app/data-export.ts', CHANGELOG_PATH]);

      expect(verdict.violation).toBe(false);
      expect(verdict.changelogTouched).toBe(true);
      // Still reports the trigger — "required and satisfied" is distinct from
      // "not required", and the CLI prints the difference.
      expect(verdict.triggers).toHaveLength(1);
    });

    it('passes on framework internals — deliberately outside the gate', () => {
      // The documented public surface includes some of lib/framework/**, but a
      // path cannot tell a documented export from an internal refactor. Gating
      // it all would fire constantly and get the guard bypassed. See lib.ts.
      const verdict = checkChangelog([
        'lib/framework/modules/service.ts',
        'lib/framework/facilitation/map/queries.ts',
      ]);

      expect(verdict.violation).toBe(false);
      expect(verdict.triggers).toEqual([]);
    });

    it('passes on a docs-only change', () => {
      const verdict = checkChangelog([
        '.context/framework/README.md',
        '.context/framework/planning/plan.md',
      ]);
      expect(verdict.violation).toBe(false);
    });

    it('passes on a test-only change to a gated path', () => {
      // Adding a test for a seam does not change the seam.
      const verdict = checkChangelog(['tests/unit/lib/app/defaults.test.ts']);
      expect(verdict.violation).toBe(false);
    });

    it('does not ask a changelog-only PR to edit the changelog', () => {
      // `.context/` is exempt, and the changelog lives there — otherwise a PR
      // that ONLY fixes a changelog typo would trip its own guard.
      const verdict = checkChangelog([CHANGELOG_PATH]);
      expect(verdict.violation).toBe(false);
    });

    it('passes on an empty change list', () => {
      expect(checkChangelog([]).violation).toBe(false);
    });
  });

  describe('path matching is not over-broad', () => {
    it('does not treat a leaf’s nested lib/app code as a seam', () => {
      // `lib/app/programme/**` is a leaf's own product code (reclaim-your-week
      // has exactly this). Only top-level `lib/app/<name>.ts` files are seams.
      const verdict = checkChangelog(['lib/app/programme/service.ts']);
      expect(verdict.violation).toBe(false);
    });

    it('does not treat the leaf-reserved app.prisma as a framework schema', () => {
      const verdict = checkChangelog(['prisma/schema/app.prisma']);
      expect(verdict.violation).toBe(false);
    });

    it('does not treat a core Sunrise schema as a framework schema', () => {
      const verdict = checkChangelog(['prisma/schema/orchestration-agents.prisma']);
      expect(verdict.violation).toBe(false);
    });

    it('matches lib/app/eslint.config.mjs, which is a seam but not a .ts file', () => {
      const verdict = checkChangelog(['lib/app/eslint.config.mjs']);
      expect(verdict.violation).toBe(true);
    });
  });
});

describe('formatVerdict', () => {
  it('names the offending file AND why it is gated', () => {
    // A failure message that says only "add a changelog entry" makes the reader
    // guess what tripped it. Both halves are the actionable part.
    const message = formatVerdict(checkChangelog(['lib/app/data-export.ts']));

    expect(message).toContain('lib/app/data-export.ts');
    expect(message).toContain('changing hands');
    expect(message).toContain(CHANGELOG_PATH);
    expect(message).toContain('VERSIONING.md');
  });
});

describe('framework barrel surface gating (#239 gap 3)', () => {
  const deltaOf = (file: string, added: string[] = [], removed: string[] = []) => ({
    file,
    added,
    removed,
  });

  it('gates on a symbol ADDED to a framework barrel', () => {
    const verdict = checkChangelog(
      ['lib/framework/facilitation/journey/create.ts'],
      [deltaOf('lib/framework/facilitation/journey/index.ts', ['createJourney'])]
    );

    expect(verdict.violation).toBe(true);
    expect(verdict.triggers[0]?.reason).toContain('createJourney');
  });

  it('calls a REMOVAL breaking, and says so first', () => {
    // A removal and an addition are not the same news. The reason string leads
    // with the removal because that is the half that breaks a leaf on upgrade.
    const reason = barrelReason(deltaOf('lib/framework/x/index.ts', ['newThing'], ['oldThing']));

    expect(reason.indexOf('REMOVED')).toBeLessThan(reason.indexOf('+newThing'));
    expect(reason).toContain('breaking for any leaf importing them');
  });

  it('does NOT gate a barrel whose symbols are unchanged', () => {
    // The objection the old floor rationale raised: a path rule would fire on
    // every internal refactor. This is the answer to it, asserted.
    const verdict = checkChangelog(
      ['lib/framework/facilitation/journey/create.ts'],
      [deltaOf('lib/framework/facilitation/journey/index.ts')]
    );

    expect(verdict.violation).toBe(false);
    expect(verdict.triggers).toEqual([]);
  });

  it('ignores barrels outside lib/framework', () => {
    // `lib/app/*` is the leaf's own surface and already has a path rule; core's
    // barrels are Sunrise's to announce, not Daybreak's.
    const verdict = checkChangelog(
      [],
      [deltaOf('lib/orchestration/index.ts', ['somethingCore']), deltaOf('lib/app/index.ts', ['x'])]
    );

    expect(verdict.violation).toBe(false);
  });

  it('is satisfied when the changelog was touched', () => {
    const verdict = checkChangelog(
      [CHANGELOG_PATH],
      [deltaOf('lib/framework/x/index.ts', ['thing'])]
    );

    expect(verdict.violation).toBe(false);
    expect(verdict.changelogTouched).toBe(true);
  });

  it('treats "no deltas supplied" as no information, not as proof of no change', () => {
    // The wrapper passes `[]` only when it could read both revisions; when it
    // cannot it warns PARTIAL. This pins that the default is inert rather than
    // silently exonerating — the path rules still stand on their own.
    const verdict = checkChangelog(['lib/app/ci.ts']);

    expect(verdict.violation).toBe(true);
    expect(verdict.triggers).toHaveLength(1);
  });
});

describe('pushEventBeforeSha', () => {
  // Context: on a `push` to main, `origin/main` IS HEAD, so the guard had no base
  // and failed every merge — main was red for three of them, and any leaf merging
  // that release would have gone red on its own main the same way. The fix reads
  // the previous tip out of the push payload; these are the rules for trusting it.

  const SHA = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0';

  it('returns the previous tip from a well-formed push payload', () => {
    expect(pushEventBeforeSha({ before: SHA, after: 'z'.repeat(40) })).toBe(SHA);
  });

  it('rejects the all-zeros SHA a ref creation reports', () => {
    // THE CASE THIS FUNCTION EXISTS FOR. A created branch has no previous tip;
    // letting the zeros through sends the caller off to fetch a commit that cannot
    // exist, and it would then report "could not look" for the wrong reason.
    expect(pushEventBeforeSha({ before: '0'.repeat(40) })).toBeNull();
  });

  it.each([
    ['missing before', {}],
    ['null payload', null],
    ['a non-object payload', 'refs/heads/main'],
    ['a non-string before', { before: 12345 }],
    ['a short SHA', { before: 'a1b2c3d' }],
    ['an uppercase SHA', { before: SHA.toUpperCase() }],
    ['a non-hex string', { before: 'g'.repeat(40) }],
  ])('returns null for %s', (_label, payload) => {
    // Strict by intent: anything unrecognised falls through to the rest of the
    // ladder rather than being guessed at. A guard that diffs against a base
    // nobody chose is worse than one that says it could not look.
    expect(pushEventBeforeSha(payload)).toBeNull();
  });
});
