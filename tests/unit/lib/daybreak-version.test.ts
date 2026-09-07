/**
 * Tests: lib/daybreak-version.ts — the Daybreak framework version constant.
 *
 * Two things are worth testing about a constant, and only two: that it is
 * well-formed, and that it agrees with the other place the same number is
 * written down. The second is the substance of this file.
 *
 * @see lib/daybreak-version.ts · .context/framework/VERSIONING.md
 */

import { describe, it, expect } from 'vitest';
import { DAYBREAK_VERSION } from '@/lib/daybreak-version';
import { SUNRISE_VERSION } from '@/lib/sunrise-version';
import { APP_VERSION } from '@/lib/app-version';

describe('DAYBREAK_VERSION', () => {
  it('is a bare semver string', () => {
    // No `v` prefix and no range specifier — the `daybreak-v` prefix belongs to
    // the git tag, not the constant, and a range here would be meaningless.
    expect(DAYBREAK_VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  // REMOVED IN THIS LEAF — deliberately, on Daybreak's own instruction.
  //
  // Upstream this file carries a case asserting
  // `DAYBREAK_VERSION === packageJson.version`, which is the parity that makes
  // bumping BOTH files mandatory when Daybreak cuts a release. In Lelañea that
  // assertion is not merely inconvenient, it is false by design: `package.json`
  // carries OUR version (0.1.0) while `DAYBREAK_VERSION` keeps reporting the
  // framework's (0.2.0). Those two numbers are supposed to diverge — it is the
  // whole reason the three versions are separately sourced constants rather
  // than one derived from another.
  //
  // `.context/framework/building-on-daybreak.md` ("Two tests you are expected to
  // adjust") names this case specifically and says to delete it and keep the
  // rest of the file. Recorded here rather than deleted silently, so nobody
  // "restores" it on a later sync and reds the suite for a correct tree.
  //
  // Deliberately NOT replaced with the inverse assertion (`!==`). Divergence
  // today is a fact about where the two version lines happen to sit, not an
  // invariant: Lelañea climbing to 0.2.0 while Daybreak sits there would fail a
  // test that nothing had broken. Same reasoning the case below gives for not
  // asserting DAYBREAK_VERSION !== SUNRISE_VERSION.

  it('exposes all three tiers as distinct, independently sourced constants', () => {
    // The three-tier contract in one assertion: every tier answers, and each is
    // a real string rather than an empty default. In Daybreak's own repo
    // APP_VERSION and DAYBREAK_VERSION coincide (the parity test above); in a
    // leaf they diverge, which is exactly why all three are exported separately.
    //
    // There is deliberately NO assertion that DAYBREAK_VERSION !== SUNRISE_VERSION.
    // "Separately sourced" is a structural property — three constants in three
    // modules, owned by three parties — and no runtime assertion can express it.
    // Asserting the values differ would encode a coincidence instead: Daybreak is
    // at 0.1.0 climbing and Sunrise at 0.8.0, so the two WILL cross, and the test
    // would then fail on a release that did nothing wrong.
    for (const [name, value] of Object.entries({
      APP_VERSION,
      DAYBREAK_VERSION,
      SUNRISE_VERSION,
    })) {
      expect(value, `${name} must be a non-empty version string`).toMatch(/^\d+\.\d+\.\d+/);
    }
  });
});
