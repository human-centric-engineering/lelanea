/**
 * Tests: the core → framework import ban and its exemptions (#157).
 *
 * `lib/framework/eslint.config.mjs` bans `@/lib/framework` imports everywhere
 * except the tiers that legitimately touch the framework. The exemptions are an
 * `ignores` list, and **`ignores` is resolved by ESLint's config resolution, not
 * by the rule** — so asserting on the config block's own shape (the approach
 * `eslint-app-boundary.test.ts` can take, because it tests rule OPTIONS) would
 * prove nothing about which files actually receive the ban.
 *
 * So this asks ESLint itself, via `calculateConfigForFile`, for the rule that a
 * representative path really resolves to. A glob typo, a path added to `ignores`
 * that does not match, or a future refactor that drops the block entirely all
 * fail here.
 *
 * Two invariants, and the second is the one that is easy to lose:
 *
 *   1. The right paths are exempt, and — just as important — the WRONG ones are
 *      not. A core seed at `prisma/seeds/NNN-*.ts` must still be banned: "runs in
 *      no build" is not a licence to cross tiers, because that file exists in
 *      upstream Sunrise and in sibling forks with no framework tier.
 *   2. **The `@/`-alias ban survives every exemption.** Flat-config
 *      `no-restricted-imports` REPLACES rather than merges, so dropping a path out
 *      of this block hands it to Sunrise's root block — which must still carry
 *      `aliasBan`. If that ever stops being true, relative imports silently become
 *      legal on exactly the paths a leaf writes most code in.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ESLint } from 'eslint';

const FRAMEWORK_BAN = '@/lib/framework';
const ALIAS_BAN = '../*';
const LEAF_BAN = '@/lib/app';

interface RestrictedImportsOptions {
  patterns?: { group?: string[] }[];
}

let eslint: ESLint;

/** The `no-restricted-imports` groups ESLint really resolves for `filePath`. */
async function bannedGroupsFor(filePath: string): Promise<string[]> {
  const config = (await eslint.calculateConfigForFile(filePath)) as {
    rules?: Record<string, unknown>;
  };
  // The ban lives on base `no-restricted-imports`; `lib/app/**` uses the
  // `@typescript-eslint/` variant. Read both so a future unification of the two
  // does not read as the rule having disappeared.
  const entries = [
    config.rules?.['no-restricted-imports'],
    config.rules?.['@typescript-eslint/no-restricted-imports'],
  ];

  const groups: string[] = [];
  for (const entry of entries) {
    if (!Array.isArray(entry)) continue;
    for (const opt of entry.slice(1) as RestrictedImportsOptions[]) {
      for (const pattern of opt?.patterns ?? []) {
        groups.push(...(pattern.group ?? []));
      }
    }
  }
  return groups;
}

beforeAll(() => {
  eslint = new ESLint({ cwd: process.cwd() });
});

describe('core → framework import ban', () => {
  it.each([
    ['a core lib module', 'lib/orchestration/chat/handler.ts'],
    ['a core API route', 'app/api/v1/admin/orchestration/agents/route.ts'],
    ['a core component', 'components/admin/orchestration/agents-table.tsx'],
    // "Ships in no build" is NOT on its own a licence to cross tiers: a core seed
    // exists in upstream Sunrise and in forks with no lib/framework/ folder.
    ['a CORE seed', 'prisma/seeds/001-system-owner.ts'],
    // A leaf's own vocabulary is not exempt — it overrides via lib/app/eslint.config.mjs.
    ['a leaf route outside the reserved namespace', 'app/(protected)/programme/page.tsx'],
  ])('bans @/lib/framework in %s', async (_label, filePath) => {
    expect(await bannedGroupsFor(filePath)).toContain(FRAMEWORK_BAN);
  });
});

describe('exemptions — the tiers that legitimately import the framework', () => {
  it.each([
    // Pre-existing exemptions, pinned so a refactor of the ignores list cannot
    // quietly drop one.
    ['the framework itself', 'lib/framework/facilitation/journey/create.ts'],
    ['the leaf lib surface', 'lib/app/bootstrap.ts'],
    ['a framework test', 'tests/unit/lib/framework/init.test.ts'],
    ['a smoke script', 'scripts/smoke/engine.ts'],
    // #157, rationale 1 — framework/leaf-tier seeds, which run via tsx and never
    // in a build.
    ['a framework boot seed', 'prisma/seeds/_framework/000-framework-boot.ts'],
    ['a framework seed', 'prisma/seeds/framework/001-framework-rubric-judge.ts'],
    ['a leaf seed', 'prisma/seeds/app-reclaim/002-reclaim-surface.ts'],
    // #157, rationale 2 — the reserved leaf surfaces, which DO ship in a build but
    // exist only in a leaf, and a leaf always has a framework tier.
    ['a leaf API route', 'app/api/v1/app/runs/route.ts'],
    ['a leaf authenticated page', 'app/(protected)/app/dashboard/page.tsx'],
    ['a leaf public page', 'app/(public)/app/landing/page.tsx'],
    ['a leaf auth-flow page', 'app/(auth)/app/onboarding/page.tsx'],
    ['a leaf admin page', 'app/admin/app/settings/page.tsx'],
    ['a leaf component', 'components/app/run-card.tsx'],
  ])('allows @/lib/framework in %s', async (_label, filePath) => {
    expect(await bannedGroupsFor(filePath)).not.toContain(FRAMEWORK_BAN);
  });

  it.each([
    ['a framework boot seed', 'prisma/seeds/_framework/000-framework-boot.ts'],
    ['a leaf seed', 'prisma/seeds/app-reclaim/002-reclaim-surface.ts'],
    ['a leaf API route', 'app/api/v1/app/runs/route.ts'],
    ['a leaf authenticated page', 'app/(protected)/app/dashboard/page.tsx'],
    ['a leaf admin page', 'app/admin/app/settings/page.tsx'],
  ])('still bans relative imports in %s — replace-not-merge holds', async (_label, filePath) => {
    expect(await bannedGroupsFor(filePath)).toContain(ALIAS_BAN);
  });
});

describe('the boundary fixture', () => {
  it('stays globally ignored, so a normal lint is not broken by the deliberate violation', async () => {
    // The fixture imports @/lib/framework on purpose. It is globally ignored so
    // `npm run lint` stays green, and `scripts/boundary/check.ts` lints it with
    // `--no-ignore` to prove the ban still bites — that assertion lives there, in
    // CI, and is not duplicated here.
    //
    // What IS worth pinning here is the ignore itself: widening the exemption
    // globs above until they swallow `scripts/boundary/fixtures/**` would lift the
    // ban for the one file whose job is to violate it, and the boundary check
    // would then report a healthy "no violation" for a rule that had been switched
    // off for it. (`calculateConfigForFile` cannot see this — an ignored path
    // resolves to no config at all, which is how this test was first written and
    // why it failed.)
    await expect(
      eslint.isPathIgnored('scripts/boundary/fixtures/core-imports-framework.ts')
    ).resolves.toBe(true);
  });

  it('is not swallowed by any exemption glob — a non-fixture script stays linted', async () => {
    // The paired half: prove the ignore is scoped to the fixtures directory rather
    // than to `scripts/` at large.
    await expect(eslint.isPathIgnored('scripts/boundary/check.ts')).resolves.toBe(false);
  });
});

describe('exempting a path must not cost it the LEAF ban too', () => {
  // The subtle half of `ignores`: it removes a path from the ban block ENTIRELY,
  // so the path falls through to Sunrise's root block — which carries `aliasBan`
  // and nothing else. A framework-tier file exempted only that way would silently
  // lose `leafBan` and could import `@/lib/app`, inverting the tier order with
  // nothing to flag it. Framework-tier seeds are therefore also named in the
  // framework-tier block's `files`.
  it.each([
    ['the framework itself', 'lib/framework/facilitation/journey/create.ts'],
    ['a framework seed', 'prisma/seeds/framework/001-framework-rubric-judge.ts'],
  ])('keeps the leaf ban on %s (framework tier)', async (_label, filePath) => {
    expect(await bannedGroupsFor(filePath)).toContain(LEAF_BAN);
  });

  it('exempts the boot seed from the leaf ban — it is a BRIDGE, not framework code', async () => {
    // `prisma/seeds/_framework/000-framework-boot.ts` composes the two tiers: it
    // calls the framework's boot sequence with the leaf's `initLeafApp` passed in.
    // That is the seed-time twin of `lib/app/bootstrap.ts`, and like that file it
    // has to see both sides — `leafBan` would forbid the one import it exists to
    // make. Distinct from `prisma/seeds/framework/**` above, which is ordinary
    // framework code and keeps the ban.
    const groups = await bannedGroupsFor('prisma/seeds/_framework/000-framework-boot.ts');
    expect(groups).not.toContain(LEAF_BAN);
    expect(groups).not.toContain(FRAMEWORK_BAN);
    // …but the alias ban still applies, as everywhere.
    expect(groups).toContain(ALIAS_BAN);
  });

  it.each([
    // The leaf surface may import itself — `@/lib/app` is the leaf's OWN code.
    ['a leaf seed', 'prisma/seeds/app-reclaim/002-reclaim-surface.ts'],
    ['a leaf API route', 'app/api/v1/app/runs/route.ts'],
    ['a leaf component', 'components/app/run-card.tsx'],
  ])('does not impose the leaf ban on %s (leaf tier)', async (_label, filePath) => {
    expect(await bannedGroupsFor(filePath)).not.toContain(LEAF_BAN);
  });
});
