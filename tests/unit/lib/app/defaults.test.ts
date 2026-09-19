/**
 * Tests: lib/app/ seams ship as no-op defaults
 *
 * Every `lib/app/*` file is a fork-owned scaffold that Sunrise ships EMPTY. This
 * file exercises the REAL defaults to lock in that contract — a stray default
 * registration would silently apply to every install (a lint rule every fork
 * inherits, an auth email swapped out, a restricted agent's document access
 * widened).
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — filling a seam is EXPECTED to fail a row here
 * ---------------------------------------------------------------------------
 * This test asserts a property every fork is expected to violate: the seams
 * exist precisely so you fill them. When you fill one, **pin the new value**
 * rather than deleting the row:
 *
 *     // BEFORE (Sunrise default)
 *     assert: () => expect(appEslintConfig).toEqual([]),
 *     // AFTER  (fork spreads its own tier config)
 *     assert: () => expect(appEslintConfig).toEqual(frameworkEslintConfig),
 *
 * Pinning keeps the protection for the seams you have NOT filled; deleting the
 * row loses it silently. The table below is the whole surface — one row per
 * seam — so a fork's diff here is a line, not a rewrite. See CUSTOMIZATION.md §4.
 *
 * ---------------------------------------------------------------------------
 * DAYBREAK — the two bridges this fork fills, pinned rather than deleted
 * ---------------------------------------------------------------------------
 * Daybreak fills four `lib/app/*` bridges, so their rows below assert the FILLED
 * value instead of emptiness:
 *
 * - `lib/app/bootstrap.ts`   → `initFramework()` + framework sync
 * - `lib/app/admin-nav.ts`   → the framework's "Framework" sidebar section
 * - `lib/app/data-export.ts` → the framework tier's Art. 15 manifest
 * - `lib/app/brand.ts`       → Daybreak's product name and legal entity
 *
 * Each delegates to a leaf seam (`leaf-bootstrap.ts`, `leaf-admin-nav.ts`,
 * `leaf-data-export.ts`, `leaf-brand.ts`) which carries the no-op contract
 * forward for leaf forks — those rows are here too. See the Daybreak banner in
 * CLAUDE.md.
 *
 * ---------------------------------------------------------------------------
 * LELAÑEA — the leaf seams this fork has filled, pinned rather than deleted
 * ---------------------------------------------------------------------------
 * `leaf-bootstrap.ts` (the seventeen journey modules and the waitlist's
 * erasure hook), `leaf-data-export.ts` (the
 * waitlist's Art. 15 declaration and collector), `leaf-admin-nav.ts` (the
 * "Lelañea" sidebar section) and `context-contributors.ts` (her voice block)
 * assert the FILLED value. `knowledge-access-contributors.ts` is filled too but
 * its row still asserts only that its init returns cleanly — the resolver
 * exports no way to read its registry back, and adding one would be an edit to a
 * Sunrise-owned file for a test's convenience; it is pinned by registration in
 * `tests/unit/lib/app/knowledge-access-contributors.test.ts` instead. Pinning is what keeps the
 * protection for every seam still empty, and turns each row into a guard on the
 * thing we filled it with — see `HB2`.
 *
 * Filling `leaf-admin-nav.ts` also moves the `lib/app/admin-nav.ts` BRIDGE row,
 * which asserted that exactly one section — Daybreak's — was registered. That is
 * two edits for one seam rather than one, and it is the shape of the contract
 * working: the bridge row still holds the framework section in place and still
 * fails on a stray third, it just now knows ours is there too.
 *
 * @see lib/app/ · CUSTOMIZATION.md §4
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * LELAÑEA — the leaf's filled seams reach Prisma, so the client is stubbed.
 *
 * `leaf-bootstrap.ts` and `leaf-data-export.ts` both import
 * `lib/app/waitlist/service.ts` (and the latter `lib/app/gateway/acknowledgements.ts`),
 * which import `@/lib/db/client`. Importing that
 * module for real builds a `pg.Pool` from `env.DATABASE_URL`, which is undefined
 * in this harness — so the stub is what keeps these rows exercising the REAL
 * seams rather than forcing them into `UNASSERTED_SEAMS`.
 *
 * It is a stub, not a fixture: the rows below assert what the seams REGISTER,
 * and the one that reaches a query asserts only the shape of the section key.
 * What the collector's query actually selects is asserted against a stubbed
 * client in `tests/unit/lib/app/waitlist/service.test.ts`.
 */
vi.mock('@/lib/db/client', () => ({
  prisma: {
    appWaitlistEntry: {
      findMany: vi.fn(async () => []),
      // The user-created row below dispatches through the real seam; a null
      // here is "no row has that address", the ordinary case, so the pin can
      // assert the hook REACHED the table without pretending a row was linked.
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    appAcknowledgement: { findMany: vi.fn(async () => []) },
    appUserBudget: { findMany: vi.fn(async () => []) },
    // §08 t-54 — the turn record, for the export collector's section key.
    appTurn: { findMany: vi.fn(async () => []) },
    appSafetyEvent: { findMany: vi.fn(async () => []), create: vi.fn(async () => ({})) },
  },
}));
import { registerAppRateLimits } from '@/lib/app/rate-limit';
import { initAppCapabilities } from '@/lib/app/capabilities';
import { initAppContextContributors } from '@/lib/app/context-contributors';
import {
  FACILITATION_CONTEXT_TYPE,
  VOICE_CONTEXT_TYPE,
  loadFacilitationVoiceContext,
  loadVoiceContext,
} from '@/lib/app/voice/context-contributor';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import {
  __resetFacilitationTurnHookForTests,
  getFacilitationTurnHook,
  passThroughFacilitationTurn,
} from '@/lib/framework/facilitation/agents/turn-hook';
import { runRecordedTurn } from '@/lib/app/agent/turns';
import { initAppNav } from '@/lib/app/admin-nav';
import { initLeafAdminNav } from '@/lib/app/leaf-admin-nav';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { getModuleDefinitions, LELANEA_MODULE_COUNT } from '@/lib/app/modules/definitions';
import {
  getRegisteredModules,
  __resetModuleRegistryForTests,
} from '@/lib/framework/modules/registry';
import { WAITLIST_ERASURE_HOOK } from '@/lib/app/waitlist/service';
import {
  getErasureCleanupHooks,
  __resetErasureCleanupHooksForTests,
} from '@/lib/privacy/erasure-hooks';
import { publicNavItems, footerNavItems, footerLegalItems } from '@/lib/app/public-nav';
import { protectedNavItems } from '@/lib/app/protected-nav';
import { appAuthLandingRoute, appAuthLandingLabel } from '@/lib/app/auth-landing';
import InvitationEmail from '@/components/app/emails/invitation';
import WelcomeEmail from '@/components/app/emails/welcome';
import { initApp } from '@/lib/app/bootstrap';
import { initAppKnowledgeAccessContributors } from '@/lib/app/knowledge-access-contributors';
import { initAppGuardFloorContributors } from '@/lib/app/guard-floor-contributors';
import { initAppGuardEventContributors } from '@/lib/app/guard-event-contributors';
import { appAgentFields } from '@/lib/app/agent-fields';
import { appProtectedRoutes } from '@/lib/app/protected-routes';
import { appEnvSchema } from '@/lib/app/env';
import { footerCopyright } from '@/lib/app/footer';
import { APP_API_KEY_SCOPES } from '@/lib/app/api-key-scopes';
import { listValidApiKeyScopes, CORE_API_KEY_SCOPES } from '@/lib/auth/api-key-scopes';
import appEslintConfig from '@/lib/app/eslint.config.mjs';
import { appFrameSrc } from '@/lib/app/csp';
import {
  appCoverageExclusions,
  appAlwaysRunTests,
  appOwnerlessSurfaceExceptions,
} from '@/lib/app/ci';
import {
  leafCoverageExclusions,
  leafAlwaysRunTests,
  leafOwnerlessSurfaceExceptions,
} from '@/lib/app/leaf-ci';
import { occupiedTiers } from '@/lib/app/reserved-tiers';
import { initAppUserCreatedHooks } from '@/lib/app/user-created';
import {
  dispatchUserCreated,
  __resetUserCreatedHooksForTests,
} from '@/lib/auth/user-created-hooks';
import { prisma } from '@/lib/db/client';
import { collectLeafSubjectData, initLeafSubjectSources } from '@/lib/app/leaf-data-export';
import {
  getAppSubjectSources,
  getAppExcludedSubjectSources,
  __resetAppSubjectSourceRegistryForTests,
} from '@/lib/privacy/subject-source-registry';
import { getAppJobs, __resetAppJobsForTests } from '@/lib/orchestration/maintenance/app-jobs';
import { getEffectiveRateLimitPolicy, RATE_LIMIT_POLICY } from '@/lib/security/rate-limit-policy';
import {
  hasProviderEligibilityResolver,
  resolveEligibleProviders,
} from '@/lib/orchestration/llm/provider-eligibility';
import { getRegisteredNavSections, __resetNavRegistryForTests } from '@/lib/admin-nav/registry';
import {
  listAppMcpResourceTypes,
  listAllowedMcpResourceUriSchemes,
  __resetAppMcpResourcesForTests,
} from '@/lib/orchestration/mcp/resource-registry';
import {
  listGraders,
  __resetGraderRegistryForTests,
} from '@/lib/orchestration/evaluations/graders/registry';
import {
  ACCOUNT_SURFACES,
  getRegisteredAccountSections,
  __resetAccountSectionRegistryForTests,
} from '@/lib/account-sections/registry';
import { initAppAuthorizationPolicy } from '@/lib/app/authorization';
import {
  DEFAULT_AUTHORIZATION_POLICY,
  getAuthorizationPolicy,
  hasAppAuthorizationPolicy,
  __resetAuthorizationPolicyForTests,
} from '@/lib/auth/authorization';

/**
 * One row per `lib/app/*` seam.
 *
 * - `seam` — the file a fork edits, and the test name.
 * - `risk` — what a stray default here would do to every install. This is the
 *   reason the row exists; keep it accurate if you pin a fork value.
 * - `assert` — runs the REAL default and asserts it registers/overrides nothing.
 *   May be async.
 */
interface SeamDefault {
  seam: string;
  risk: string;
  assert: () => void | Promise<void>;
}

/**
 * Seam files deliberately absent from the table below, with the reason. The
 * drift guard at the bottom of this file allows exactly these two.
 */
/** This file's own repo-relative path — the one place importActual is allowed. */
const THIS_FILE = path.join('tests', 'unit', 'lib', 'app', 'defaults.test.ts');

const UNASSERTED_SEAMS = new Set([
  // Asserted behaviourally instead — see tests/unit/lib/db/drift-probes.test.ts.
  'lib/app/db-drift.ts',
  // The one seam that ships real logic (a classifier) rather than an empty
  // value, so "registers nothing" is not the contract. Covered by its own tests.
  'lib/app/surface.ts',
  // Daybreak's reserved leaf drift seam — asserted behaviourally alongside the
  // bridge that calls it, in tests/unit/lib/db/drift-probes.test.ts.
  'lib/app/leaf-db-drift.ts',
  // A bridge Daybreak FILLS, and the only one whose body issues real database
  // queries — running it here would need a full Prisma stub for the whole file.
  // Asserted behaviourally instead, against a stubbed client, in
  // tests/unit/lib/framework/privacy/export.test.ts. Its leaf seam
  // (`leaf-data-export.ts`) is pinned to this fork's own declaration in a row
  // below.
  'lib/app/data-export.ts',
]);

/**
 * Every `model X {` declared in the schema files matching `predicate`.
 *
 * Two rows below diff the subject-source registry against the schema on disk —
 * the framework bridge against `framework-*.prisma`, this leaf against
 * `app.prisma`. Reading the schema, rather than a manifest constant, is what
 * makes each assertion say "every table is accounted for" instead of "the
 * manifest agrees with itself".
 */
function modelsInSchemaFiles(predicate: (file: string) => boolean): string[] {
  const schemaDir = path.join(process.cwd(), 'prisma', 'schema');
  return readdirSync(schemaDir)
    .filter((file) => file.endsWith('.prisma') && predicate(file))
    .flatMap((file) => [
      ...readFileSync(path.join(schemaDir, file), 'utf8').matchAll(/^model\s+(\w+)\s*\{/gm),
    ])
    .map((match) => match[1])
    .sort();
}

const SEAM_DEFAULTS: SeamDefault[] = [
  {
    seam: 'lib/app/authorization.ts',
    risk: 'a stray policy would replace the authorization decision at every guarded request and every admin page — the one seam whose default registration would change who can reach what, on every install',
    assert: () => {
      initAppAuthorizationPolicy();
      expect(hasAppAuthorizationPolicy()).toBe(false);
      // BY IDENTITY: what runs must be Sunrise's own object, not something
      // equivalent-looking. `getAuthorizationPolicy()` also runs the fork gate,
      // so this covers the wiring as well as the value.
      expect(getAuthorizationPolicy()).toBe(DEFAULT_AUTHORIZATION_POLICY);
    },
  },
  {
    seam: 'lib/app/llm-providers.ts',
    risk: 'a stray eligibility rule would silently drop provider fallbacks on every install',
    assert: async () => {
      // `importActual`, NOT a plain import: tests/setup.ts pins this seam for
      // every other file, and asserting the pin would prove nothing about what
      // Sunrise actually ships. This is the file that must see the real one.
      const seam =
        await vi.importActual<typeof import('@/lib/app/llm-providers')>('@/lib/app/llm-providers');
      await seam.registerAppProviderEligibility();
      expect(hasProviderEligibilityResolver()).toBe(false);
      // BY IDENTITY, not by deep equality: the default has to be the input
      // array itself, which is what makes "byte-identical at single" a fact
      // rather than a claim about equivalent-looking output.
      const candidates = ['anthropic', 'openai'];
      await expect(
        resolveEligibleProviders(candidates, {
          task: 'chat',
          source: 'system',
          primarySlug: 'anthropic',
        })
      ).resolves.toBe(candidates);
    },
  },
  {
    seam: 'lib/app/rate-limit.ts',
    risk: 'a stray tier or rule would re-cap every install',
    assert: () => {
      registerAppRateLimits();
      // No app rules → the effective policy is the base policy BY IDENTITY.
      expect(getEffectiveRateLimitPolicy()).toBe(RATE_LIMIT_POLICY);
    },
  },
  {
    // PINNED, not deleted (`HB2`). f-safety t-60 fills this with ONE
    // registration: her search, mounted OVER the built-in slug so each result
    // says whose material it is. What is pinned is the handler the dispatcher
    // ends up holding for that slug after the real lazy registration pass. A
    // registration under any other slug, or a built-in flush that ran after
    // ours, fails here. A stray second capability is caught by the count.
    seam: 'lib/app/capabilities.ts',
    risk: 'a stray capability would be dispatchable on every install',
    assert: async () => {
      const { registerBuiltInCapabilities, __resetRegistrationForTests } =
        await import('@/lib/orchestration/capabilities/registry');
      const { capabilityDispatcher } = await import('@/lib/orchestration/capabilities/dispatcher');
      const { LabelledSearchKnowledgeCapability } =
        await import('@/lib/app/safety/labelled-search');
      const registerSpy = vi.spyOn(capabilityDispatcher, 'register');
      __resetRegistrationForTests();
      registerBuiltInCapabilities();
      const handler = capabilityDispatcher.getHandler('search_knowledge_base');
      const ours = registerSpy.mock.calls.filter(
        ([capability]) => capability instanceof LabelledSearchKnowledgeCapability
      );
      registerSpy.mockRestore();
      expect(handler).toBeInstanceOf(LabelledSearchKnowledgeCapability);
      expect(ours).toHaveLength(1);
      expect(initAppCapabilities()).toBeUndefined();
    },
  },
  {
    // PINNED, not deleted (`HB2`). §05 t-27 fills this with ONE contributor: her
    // voice block — the register a moment calls for, plus real passages of her
    // writing labelled by origin.
    //
    // The registry is core's and core exports no getter for it, so this reads
    // the `globalThis` store the context-builder docblock says it deliberately
    // keeps there. A DELTA rather than a snapshot, because the same store is
    // shared with the framework's own `module` registration and with whatever a
    // sibling row's `initApp()` has already put in it: what is pinned is that
    // OUR seam adds exactly one type, and which function is behind it.
    //
    // Behavioural reach into `buildContext` is
    // tests/unit/lib/app/voice/context-contributor.test.ts; the registration
    // itself, against a mocked registrar, is
    // tests/unit/lib/app/context-contributors.test.ts.
    seam: 'lib/app/context-contributors.ts',
    risk: 'a stray contributor would inject prompt context into every chat turn',
    assert: () => {
      const registry = (globalThis as { sunriseChatContextContributors?: Map<string, unknown> })
        .sunriseChatContextContributors;
      registry?.delete(VOICE_CONTEXT_TYPE);
      registry?.delete(FACILITATION_CONTEXT_TYPE);
      const before = new Set(registry?.keys() ?? []);

      expect(initAppContextContributors()).toBeUndefined();

      // §08 t-54 adds the second: her block on Daybreak's facilitation turns,
      // under the type Daybreak's surface pins — held equal to its constant here.
      expect(FACILITATION_CONTEXT_TYPE).toBe(FACILITATION_SURFACE_CONTEXT_TYPE);
      const added = [...(registry?.keys() ?? [])].filter((type) => !before.has(type));
      expect(added).toEqual([VOICE_CONTEXT_TYPE, FACILITATION_CONTEXT_TYPE]);
      expect(registry?.get(VOICE_CONTEXT_TYPE)).toBe(loadVoiceContext);
      expect(registry?.get(FACILITATION_CONTEXT_TYPE)).toBe(loadFacilitationVoiceContext);
    },
  },
  {
    seam: 'lib/app/admin-nav.ts',
    // PINNED TWICE OVER. Daybreak fills this bridge to register the framework's
    // own section, and §03 t-8 filled the leaf seam it then delegates to — so
    // what this row asserts is the COMPOSITION: the framework's section, ours
    // after it, and nothing else. The order is part of the contract (the sidebar
    // renders registration order), and a stray third section from either tier
    // still fails here.
    risk: 'a stray section here would appear in every Daybreak leaf’s admin sidebar',
    assert: () => {
      __resetNavRegistryForTests();
      initAppNav();
      expect(getRegisteredNavSections().map((section) => section.title)).toEqual([
        'Framework',
        'Lelañea',
      ]);
    },
  },
  {
    // PINNED, not deleted (`HB2`). §03 t-8 fills this so the waitlist t-7 writes
    // to is reachable — a row nobody can see is indistinguishable from a row that
    // was never written (`HB9`). The row still guards the shape: a second section
    // registered from the leaf, a renamed title that would collide with a core
    // section's React key, or a moved href all fail here.
    seam: 'lib/app/leaf-admin-nav.ts',
    risk: 'a stray section would appear in every Daybreak leaf’s admin sidebar',
    assert: () => {
      __resetNavRegistryForTests();
      initLeafAdminNav();
      const sections = getRegisteredNavSections();
      expect(sections).toHaveLength(1);
      expect(sections[0]?.title).toBe('Lelañea');
      expect(sections[0]?.items?.map((item) => item.href)).toEqual([
        '/admin/app/waitlist',
        '/admin/app/knowledge',
        '/admin/app/voice',
        // §08 t-53 — the agent's deadlines and the monthly limits.
        '/admin/app/agent',
      ]);
    },
  },
  {
    seam: 'lib/app/public-nav.ts',
    risk: 'a stray non-null list would silently REPLACE the marketing nav',
    assert: () => {
      expect(publicNavItems).toBeNull();
      expect(footerNavItems).toBeNull();
      expect(footerLegalItems).toBeNull();
    },
  },
  {
    // PINNED, not deleted (`HB2`). §04 t-9 fills this so the platform header on
    // `/profile` and `/settings` stops pointing at the abandoned `/dashboard`.
    // The row still guards the shape: an accidental extra entry, a dropped
    // `adminOnly`, or a re-introduced `/dashboard` all fail here.
    seam: 'lib/app/protected-nav.ts',
    risk: 'a stray non-null list would silently REPLACE the authenticated nav',
    assert: () => {
      expect(protectedNavItems?.map((item) => item.href)).toEqual([
        '/app',
        '/profile',
        '/settings',
        '/admin',
      ]);
      expect(protectedNavItems?.map((item) => item.label)).toEqual([
        'Lelañea',
        'Profile',
        'Settings',
        'Admin',
      ]);
      // The product has no `/dashboard`. This is the defect the row was pinned
      // for, so it is asserted directly rather than implied by the list above.
      expect(protectedNavItems?.some((item) => item.href === '/dashboard')).toBe(false);
      expect(protectedNavItems?.filter((item) => item.adminOnly).map((i) => i.href)).toEqual([
        '/admin',
      ]);
    },
  },
  {
    // PINNED, not deleted (`HB2`). §04 t-9 lands every door into the app at the
    // shell. Route and label are pinned together: a route without its label is
    // how a fork ends up sending users to `/app` behind a button still saying
    // "Dashboard", which is the same mismatch, only quieter.
    seam: 'lib/app/auth-landing.ts',
    risk: 'a stray value would send every install somewhere else after login',
    assert: () => {
      expect(appAuthLandingRoute).toBe('/app');
      expect(appAuthLandingLabel).toBe('Lelañea');
      // The label names the PRODUCT, not a view. "Your journey" is a nav item
      // pointing at `/app/journey`, so using it here made one phrase mean two
      // destinations. Owner ruling, 10 September 2026.
      expect(appAuthLandingLabel).not.toBe('Your journey');
    },
  },
  {
    seam: 'lib/app/footer.ts',
    risk: 'a stray value would rewrite — or silently remove — the attribution line on every install, on both the public and authenticated footers',
    assert: () => expect(footerCopyright).toBeNull(),
  },
  {
    // PINNED, not deleted (`HB2`). §06 t-41 fills this seam with Lelañea's
    // welcome and invitation. Upstream this row asserts the seam overrides
    // NOTHING; here it asserts it overrides EXACTLY those two, so a third
    // template swapped without a decision — or one of these two silently
    // dropped — still fails here. `verifyEmail`, `resetPassword` and
    // `changeEmailApproval` stay on the platform default on purpose.
    seam: 'lib/app/emails.ts',
    risk: 'a stray override would swap an auth email for every install',
    // `importActual`, for the reason the brand row gives: tests/setup.ts pins
    // this seam to `{}` for the whole suite, and asserting against the mock
    // would be true by construction.
    assert: async () => {
      const seam = await vi.importActual<typeof import('@/lib/app/emails')>('@/lib/app/emails');
      expect(Object.keys(seam.emailOverrides).sort()).toEqual(['invitation', 'welcome']);
      expect(seam.emailOverrides.welcome).toBe(WelcomeEmail);
      expect(seam.emailOverrides.invitation).toBe(InvitationEmail);
    },
  },
  {
    // PINNED, not deleted (`HB2`). §03 t-7 fills this seam with the waitlist,
    // §06 t-15 with the acknowledgement ledger. Upstream this row asserts the
    // seam contributes NOTHING; here it asserts it contributes EXACTLY those two
    // and nothing else, which keeps every property the empty version protected:
    // a third table declared without a decision, a section name colliding with
    // the framework tier's, or a collector returning a key nothing declared all
    // still fail here.
    //
    // The two halves are pinned together on purpose. A declared section MUST
    // appear in what the collector returns — `exportUserData()` throws if one is
    // missing — so asserting the declaration alone would leave the half that
    // actually reaches the data subject unguarded.
    seam: 'lib/app/leaf-data-export.ts',
    risk: 'a stray collector would leak leaf rows into every subject-access export, and a stray declaration would pre-account for a table nobody decided about',
    assert: async () => {
      // Derived from `prisma/schema/app.prisma` on disk rather than written out,
      // so this says "EVERY leaf table is accounted for" — the property core's
      // coverage guard enforces — and a table added without a decision fails
      // here rather than only in that guard.
      const appModels = modelsInSchemaFiles((file) => file === 'app.prisma');
      expect(appModels).toEqual([
        'AppAcknowledgement',
        'AppAgentSettings',
        'AppKnowledgeDesignation',
        'AppSafetyEvent',
        'AppTurn',
        'AppUserBudget',
        'AppVoiceComparison',
        'AppVoiceComparisonArm',
        'AppWaitlistEntry',
      ]);

      // Reading the registry triggers the lazy init, which runs the bridge:
      // framework tier first, then this seam. `initLeafSubjectSources()` is
      // idempotent by model, so it cannot be measured as a delta after that —
      // what is asserted instead is the state it is responsible for producing.
      __resetAppSubjectSourceRegistryForTests();
      initLeafSubjectSources();
      const sources = getAppSubjectSources();
      const excluded = getAppExcludedSubjectSources();

      const accounted = new Set([
        ...sources.map((entry) => entry.model),
        ...excluded.map((entry) => entry.model),
      ]);
      expect(appModels.filter((model) => !accounted.has(model))).toEqual([]);

      const waitlist = sources.find((entry) => entry.model === 'AppWaitlistEntry');
      expect(waitlist).toMatchObject({ section: 'waitlist', disposition: 'export' });
      const acknowledgements = sources.find((entry) => entry.model === 'AppAcknowledgement');
      expect(acknowledgements).toMatchObject({
        section: 'acknowledgements',
        disposition: 'export',
      });
      // §08 t-53 — a spending limit an admin set for one person is about that
      // person, so it is exported to them, never excluded.
      const budget = sources.find((entry) => entry.model === 'AppUserBudget');
      expect(budget).toMatchObject({ section: 'budget', disposition: 'export' });
      // §08 t-54 — a person's turn records (what model and version answered,
      // what it cost) are about that person, so exported to them.
      const turns = sources.find((entry) => entry.model === 'AppTurn');
      expect(turns).toMatchObject({ section: 'turns', disposition: 'export' });
      // f-safety t-58 — that the crisis path answered someone is about them, so
      // it is exported to them (the words never were stored).
      const safety = sources.find((entry) => entry.model === 'AppSafetyEvent');
      expect(safety).toMatchObject({ section: 'safety', disposition: 'export' });
      // THREE of ours are excluded, and only those three. `AppKnowledgeDesignation`
      // holds a note about a FILE she uploaded — what it is for, and on what terms
      // we may use it; the two `AppVoiceComparison*` tables hold which version of
      // her voice was heard, when, and what it was told. `AppWaitlistEntry` and
      // `AppAcknowledgement` hold personal data and must never join this list.
      // (The registry also holds the framework tier's exclusions, so filter to
      // ours.)
      expect(excluded.map((entry) => entry.model).filter((m) => appModels.includes(m))).toEqual([
        'AppKnowledgeDesignation',
        'AppVoiceComparison',
        'AppVoiceComparisonArm',
        // §08 t-53 — the settings singleton: deadlines and the default limit.
        // Who changed it is in the admin audit log, not on the row.
        'AppAgentSettings',
      ]);
      // The reason is shown to the data subject VERBATIM in `meta.excluded`, and
      // is what lets them tell "we hold nothing about you" apart from "we decided
      // not to give it to you". An empty or placeholder reason would pass the
      // coverage guard and fail that reader.
      //
      // It has to be true for EVERY subject who could read it, and this row was
      // pinned on a sentence that was not: "it holds nothing about you" is false
      // for an administrator, because `designatedBy` retains the id of whoever
      // last set the designation — deliberately without an FK, so the note
      // survives that person's account. Raised by /code-review on t-25. The
      // assertion now pins the disclosure rather than the reassurance, because
      // the reassurance is the half that was wrong.
      const designation = excluded.find((entry) => entry.model === 'AppKnowledgeDesignation');
      expect(designation?.reason).toMatch(/says nothing about you/i);
      expect(designation?.reason).toMatch(/administrator/i);
      expect(designation?.reason).toMatch(/account id/i);

      // Same reader, same rule, opposite fact: these two really do hold nothing
      // about anybody, so the reason is allowed to say so — and the assertion
      // pins the sentence rather than the presence, because a placeholder reason
      // passes the coverage guard and fails the person reading the bundle. The
      // admin who queued a comparison is on the platform's own evaluation-run
      // row; copying it here would have made this reason untrue the same way the
      // designation's first one was.
      for (const model of ['AppVoiceComparison', 'AppVoiceComparisonArm', 'AppAgentSettings']) {
        const row = excluded.find((entry) => entry.model === model);
        expect(row?.reason).toMatch(/no (information about any person|answer or account)/i);
      }

      // The collector's half of the same contract: every section this seam
      // DECLARES must appear in what it RETURNS, as an array, even when the
      // subject has no rows. `undefined` counts as missing — `JSON.stringify`
      // drops the key — so the assertion is on the key set, not on truthiness.
      const collected = await collectLeafSubjectData({
        userId: 'user-1',
        email: 'user@example.com',
      });
      const leafSections = sources
        .filter((entry) => appModels.includes(entry.model))
        .map((entry) => entry.section)
        .sort();
      expect(Object.keys(collected).sort()).toEqual(leafSections);
      expect(collected.waitlist).toEqual([]);
      expect(collected.acknowledgements).toEqual([]);
      expect(collected.budget).toEqual([]);
    },
  },
  {
    seam: 'lib/app/data-export.ts',
    // PINNED (Daybreak fills this bridge): it contributes the framework tier's
    // manifest and delegates the rest to `leaf-data-export.ts` (row above). The
    // empty contract moved there; what is pinned here is that the bridge declares
    // EXACTLY the framework manifest — nothing extra, and nothing missing.
    //
    // Only the declaration half runs. `collectAppSubjectData()` reaches real
    // Prisma through the framework collector, and proving those queries execute
    // is `npm run smoke:export`'s job against a live database — a unit test
    // mocking Prisma could only assert what the mock returned.
    risk: 'a stray declaration would pre-account for a table nobody decided about, silencing the fork-accounting rule in export-sources.test.ts for that model',
    // Derived from `prisma/schema/framework-*.prisma` on disk, NOT from the
    // framework manifest — the ESLint boundary forbids app-shell code importing
    // `@/lib/framework`, and this file is app-shell. Reading the schema is also
    // the stronger pin: it says the bridge accounts for EVERY framework model,
    // which is the property core's coverage guard enforces, rather than that it
    // agrees with a constant it derives from anyway.
    assert: () => {
      const frameworkModels = modelsInSchemaFiles((file) => file.startsWith('framework-'));
      // LELAÑEA: the bridge accounts for BOTH tiers — it calls the framework's
      // declaration and then the leaf's. Upstream this row compares against the
      // framework models alone; a leaf that filled `leaf-data-export.ts` has to
      // add its own schema file to the expected side rather than loosening the
      // comparison, or the row stops noticing an unaccounted framework table.
      const appModels = modelsInSchemaFiles((file) => file === 'app.prisma');
      const expected = [...frameworkModels, ...appModels].sort();

      // A regex that quietly stopped matching would make the comparison below
      // vacuously true on both sides.
      expect(frameworkModels.length).toBeGreaterThan(5);

      __resetAppSubjectSourceRegistryForTests();
      // Reading triggers the lazy init, so this exercises the REAL seam.
      const accounted = [
        ...getAppSubjectSources().map((entry) => entry.model),
        ...getAppExcludedSubjectSources().map((entry) => entry.model),
      ].sort();

      expect(accounted).toEqual(expected);
    },
  },
  {
    seam: 'lib/app/bootstrap.ts',
    // PINNED (Daybreak fills this bridge): it boots the framework tier and runs
    // the module sync. Both are isolated in try/catch inside the seam, so the
    // contract this row still holds is that boot NEVER rejects into
    // instrumentation — a framework or DB failure must degrade, not crash the
    // server. The empty contract moves to `leaf-bootstrap.ts` (row below).
    risk: 'a rejection here would take down server startup for every Daybreak leaf',
    // That instrumentation calls this in all envs, try/catch-isolated, is
    // covered by tests/unit/instrumentation.test.ts.
    assert: async () => {
      await expect(initApp()).resolves.toBeUndefined();
    },
  },
  {
    // PINNED, not deleted (`HB2`). Two things are registered here, and both
    // are pinned by count as well as by name.
    //
    // §05 t-12: the seventeen journey modules, each a `ModuleDefinition` with
    // an empty interior. The framework's boot sync upserts a `framework_module`
    // row per registered slug, so an eighteenth registration here would grow
    // the admin list and the map without a decision, and a missing one would
    // leave a module the drawer names with no row to point at.
    //
    // §03 t-7: the waitlist's Art. 17 erasure hook, because `app_waitlist_entry`
    // is keyed by email and the FK cascade cannot reach the rows of anyone who
    // joined before signing up. A hook registered TWICE under different names
    // would run the same delete twice inside the erasure transaction.
    seam: 'lib/app/leaf-bootstrap.ts',
    risk: 'a stray registration would run one-time work on every boot; a MISSING one would leave an erased user’s email on the waitlist table, or a journey module with no row',
    assert: async () => {
      __resetErasureCleanupHooksForTests();
      __resetModuleRegistryForTests();
      await expect(initLeafApp()).resolves.toBeUndefined();

      const modules = getRegisteredModules();
      expect(modules).toHaveLength(LELANEA_MODULE_COUNT);
      expect(modules.map((m) => m.slug)).toEqual(getModuleDefinitions().map((d) => d.slug));

      const hooks = getErasureCleanupHooks();
      expect(hooks.map((hook) => hook.name)).toEqual([WAITLIST_ERASURE_HOOK]);
      // In-transaction phase, not the best-effort external one: a throw must
      // roll the erasure back rather than being logged and swallowed.
      expect(hooks[0]?.scrubInTransaction).toBeTypeOf('function');
      expect(hooks[0]?.cleanupExternal).toBeUndefined();

      // §08 t-54: the facilitation turn hook (divergences Row 18) — her turns
      // claimed by id and recorded. By identity, and not the pass-through the
      // framework falls back to when nothing registered.
      __resetFacilitationTurnHookForTests();
      expect(getFacilitationTurnHook()).toBe(passThroughFacilitationTurn);
      await initLeafApp();
      expect(getFacilitationTurnHook()).toBe(runRecordedTurn);
    },
  },
  {
    // PINNED, not deleted (`HB2`). §05 t-25 fills this with ONE contributor — the
    // rule that keeps voice-designated material off `search_knowledge_base`.
    //
    // The row keeps asserting only that init returns cleanly, which is all it
    // ever asserted: the resolver exports no way to READ back its registry, and
    // adding one would be an edit to a Sunrise-owned file for a test's
    // convenience. WHICH contributor is registered, and that there is exactly
    // one, is pinned in tests/unit/lib/app/voice/corpus-access.test.ts against a
    // mocked registry — named here so the pin is findable from the seam.
    seam: 'lib/app/knowledge-access-contributors.ts',
    risk: 'a stray contributor would widen every restricted agent’s document access',
    assert: () => expect(initAppKnowledgeAccessContributors()).toBeUndefined(),
  },
  {
    seam: 'lib/app/guard-floor-contributors.ts',
    risk: 'a stray contributor would raise the guard floor on every install',
    assert: () => expect(initAppGuardFloorContributors()).toBeUndefined(),
  },
  {
    // PINNED, not deleted (`HB2`). f-safety t-60 fills this with ONE observer: a
    // guard flagging a message on one of her seats writes a `misuse` safety
    // event. Driven through the real emitter, so the pin is on what the
    // registration DOES: her seat is recorded, and a turn on any other surface
    // is not. The observer's own branches are in
    // tests/unit/lib/app/safety/misuse.test.ts.
    seam: 'lib/app/guard-event-contributors.ts',
    risk: 'a stray observer would receive every install’s inline-chat guard events',
    assert: async () => {
      const { emitGuardEvent, __resetGuardEventContributorsForTests } =
        await import('@/lib/orchestration/chat/guard-events');
      const { prisma } = await import('@/lib/db/client');
      const create = vi.mocked(prisma.appSafetyEvent.create);
      create.mockClear();
      __resetGuardEventContributorsForTests();
      const turn = { agentId: 'a', userId: 'u', conversationId: 'c' };

      emitGuardEvent({ ...turn, contextType: 'chat' }, 'input', 'log_only');
      emitGuardEvent(
        { ...turn, contextType: 'facilitation', contextId: 'onboarding' },
        'input',
        'log_only'
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(create).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'misuse', seat: 'onboarding', guard: 'input' }),
      });
      expect(initAppGuardEventContributors()).toBeUndefined();
    },
  },
  {
    seam: 'lib/app/agent-fields.ts',
    risk: 'a stray descriptor would add a field to every install’s agent form',
    assert: () => expect(appAgentFields).toEqual([]),
  },
  {
    // PINNED, not deleted (`HB2`). §04 t-9 puts the shell behind the edge gate.
    // Exactly one entry: `/profile` and `/settings` are core protected routes
    // that the platform merges in, and re-listing them here would read as this
    // fork owning them.
    seam: 'lib/app/protected-routes.ts',
    risk: 'a stray path would put a public route behind auth on every install',
    assert: () => expect(appProtectedRoutes).toEqual(['/app']),
  },
  {
    seam: 'lib/app/env.ts',
    risk: 'a stray key would make an unset env var fail boot on every install',
    // An empty z.object() accepts (and strips) anything → parses {} to {}.
    assert: () => expect(appEnvSchema.parse({})).toEqual({}),
  },
  {
    seam: 'lib/app/eslint.config.mjs',
    risk: 'a stray flat-config block would apply lint rules to every fork',
    // FILLED BY THIS LEAF. Upstream this row asserts `[]`. Lelañea spreads two
    // blocks — the `content/*.json` import boundary that keeps authored content
    // reachable only through `lib/app/content`, and the block that lets a
    // leaf test under `tests/**/lib/app/**` import the framework it exercises
    // — so the row is PINNED to those two rather than deleted: deleting it
    // would stop noticing the NEXT block, and a lint block added here applies
    // to the whole repo.
    //
    // Pin the count, the names, the file globs and the rule, not the message
    // text, so rewording a lint message is not a test change. The second
    // block's `files` is pinned because that is the whole risk: widened to
    // `app/**` it would lift the framework ban from the shell. Both blocks'
    // behaviour is asserted in `tests/unit/lib/app/content/eslint-boundary.test.ts`;
    // this row only asserts that the seam still holds exactly what we think.
    //
    // The root eslint.config.mjs spreads this array last; that spread itself is
    // exercised by every `npm run lint` run.
    assert: () => {
      expect(appEslintConfig).toHaveLength(2);
      expect(appEslintConfig[0]).toMatchObject({
        name: 'lelanea/content-json-boundary',
        ignores: ['lib/app/content/**'],
        rules: { 'no-restricted-syntax': expect.arrayContaining(['error']) },
      });
      expect(appEslintConfig[1]).toMatchObject({
        name: 'lelanea/leaf-tests-may-import-framework',
        files: ['tests/**/lib/app/**/*.{ts,tsx}'],
        rules: { 'no-restricted-imports': expect.arrayContaining(['error']) },
      });
    },
  },
  {
    seam: 'lib/app/jobs.ts',
    risk: 'a stray job would run on every install\u2019s maintenance tick',
    assert: () => {
      __resetAppJobsForTests();
      // getAppJobs() triggers the lazy init, so this exercises the REAL seam.
      expect(getAppJobs()).toEqual([]);
    },
  },
  {
    // PINNED, not deleted (`HB2`). §03 t-46 fills this with ONE hook — the
    // waitlist entry whose address matches the new account becomes that
    // account. The registry exports no way to READ back its keys, so the pin
    // is the dispatch: one signup reaches the waitlist table exactly once,
    // with the address lower-cased. A second registration under another key
    // would read it twice; a missing one, never. WHAT the hook does with a row
    // is pinned in tests/unit/lib/app/waitlist/service.test.ts.
    seam: 'lib/app/user-created.ts',
    risk: 'a stray hook would run on every signup on every install; a MISSING one would leave every invited person on the waitlist after they joined',
    assert: async () => {
      __resetUserCreatedHooksForTests();
      expect(initAppUserCreatedHooks()).toBeUndefined();

      const findUnique = vi.mocked(prisma.appWaitlistEntry.findUnique);
      findUnique.mockClear();
      await dispatchUserCreated({
        userId: 'user-1',
        email: 'Ada@Example.com',
        name: 'Ada',
        signupMethod: 'email',
        viaInvitation: true,
      });

      expect(findUnique).toHaveBeenCalledTimes(1);
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'ada@example.com' } })
      );
    },
  },
  {
    seam: 'lib/app/mcp-resources.ts',
    risk: 'a stray handler would expose app data over MCP to every install\u2019s connected clients',
    assert: () => {
      __resetAppMcpResourcesForTests();
      // Both readers trigger the lazy init, so this exercises the REAL seam.
      expect(listAppMcpResourceTypes()).toEqual([]);
      // Core's own scheme, and nothing else.
      expect(listAllowedMcpResourceUriSchemes()).toEqual(['sunrise']);
    },
  },
  {
    seam: 'lib/app/evaluations.ts',
    risk: 'a stray grader would appear in every install\u2019s metric picker \u2014 and, on a slug core already uses, would silently rescore every run',
    assert: () => {
      // The registry module is driven directly, so core's barrel has not
      // side-effect-registered anything: whatever listGraders() returns here
      // came from the seam. The read triggers the lazy init, so this exercises
      // the REAL file.
      __resetGraderRegistryForTests();
      expect(listGraders()).toEqual([]);
    },
  },
  {
    seam: 'lib/app/account-sections.ts',
    risk: 'a stray section would appear on every install\u2019s /profile and /settings',
    assert: () => {
      __resetAccountSectionRegistryForTests();
      // The read triggers the lazy init, so this exercises the REAL seam.
      for (const surface of ACCOUNT_SURFACES) {
        expect(getRegisteredAccountSections(surface)).toEqual([]);
      }
    },
  },
  {
    seam: 'lib/app/api-key-scopes.ts',
    risk: 'a stray scope would be mintable on every install \u2014 and a name colliding with a core scope would change what an existing key satisfies',
    assert: () => {
      expect(APP_API_KEY_SCOPES).toEqual([]);
      // …and the union it feeds is exactly core, by value not just by length.
      expect(listValidApiKeyScopes()).toEqual([...CORE_API_KEY_SCOPES]);
    },
  },
  {
    seam: 'lib/app/reserved-tiers.ts',
    // PINNED (Lelañea is a LEAF on Daybreak, which is itself a framework-layer
    // fork of Sunrise), so this checkout occupies tiers at both levels:
    // `lib/framework` + `.context/framework` are Daybreak's, inherited full of
    // its code and docs; `.context/app` is ours.
    //
    // `components/app` joined the list in §02 t-4, with the first component to
    // land there (`components/app/content/authored-document.tsx`). It could not
    // be declared before that: this row fails a tier declared but left empty.
    //
    // Pinned exactly, not loosened to a `toContain`: the value of this row is
    // that the tiers we have NOT filled keep guarding. `components/framework` is
    // the one still free, and it is Daybreak's — an entry for it appearing here
    // would mean we had occupied a tier we do not own.
    risk: 'a stray entry would switch OFF the guard that keeps a reserved tier empty — for Lelañea that means silently permitting core or Daybreak to occupy leaf surface, and permitting us to occupy a tier we do not own',
    assert: () =>
      expect(occupiedTiers).toEqual([
        'lib/framework',
        '.context/framework',
        '.context/app',
        'components/app',
      ]),
  },
  {
    seam: 'lib/app/brand.ts',
    risk: 'a stray value would rebrand every install — page titles, both footers’ copyright line, the root meta description and every transactional email — and the legal-entity field is a legal-attribution surface, not a cosmetic one',
    // `importActual`, NOT a plain import: tests/setup.ts pins this seam to null
    // for the whole suite so that no core test reads a fork's brand. Importing
    // it normally here would therefore assert the MOCK ships null, which is true
    // by construction and would keep passing in a fork that had filled the real
    // file — turning the one row that tells a fork to pin its value into a row
    // that can never fail.
    // PINNED TO THE RESOLVED IDENTITY, WHICH IN THIS LEAF IS OURS.
    //
    // Note this is a row for a seam we did NOT fill — `brand.ts` is Daybreak's
    // bridge and we leave it alone. It changed answer because filling
    // `leaf-brand.ts` (row below) is precisely what the bridge reads: it resolves
    // `leafBrandName ?? 'Daybreak'`, so a leaf that sets its name correctly makes
    // this row report the leaf's name. That is the override working, not a
    // regression — the upstream row's own comment anticipates the override and
    // pins Daybreak's value anyway, so it fails for any leaf that actually does it.
    //
    // Worth knowing on a sync: `building-on-daybreak.md` names TWO tests a leaf
    // must adjust and this row is a third, reached second-hand. If a future
    // Daybreak release changes its own fallbacks, this row keeps passing (we
    // override all three), which is correct — we would only notice, and only
    // need to care, if we cleared a value back to `null`.
    assert: async () => {
      const seam = await vi.importActual<typeof import('@/lib/app/brand')>('@/lib/app/brand');
      expect(seam.appBrandName).toBe('Lelañea');
      expect(seam.appBrandLegalName).toBe('All Too Human Ltd');
      expect(seam.appBrandDescription).toBe(
        'Lelañea — an application built on the Daybreak framework.'
      );
    },
  },
  {
    seam: 'lib/app/leaf-brand.ts',
    risk: 'a stray value would rebrand every surface — page titles, both footers’ copyright line, the root meta description and every transactional email — and the legal-entity field is a legal-attribution surface, not a cosmetic one',
    // FILLED BY THIS LEAF. Upstream this row asserts all three are `null`,
    // because in Daybreak the seam is reserved-empty for its forks. Lelañea IS
    // that fork, so the row is PINNED to our values rather than deleted:
    // deleting it would switch the guard off for the one seam most likely to be
    // edited by accident, and the risk line above is why that matters — this is
    // where a wrong string becomes a wrong copyright notice in production.
    //
    // `.context/framework/building-on-daybreak.md` ("Two tests you are expected
    // to adjust") calls for exactly this: change the row, keep the file, so
    // every seam still left empty keeps its protection.
    //
    // Update these three literals whenever `lib/app/leaf-brand.ts` changes —
    // that coupling is the point, not an annoyance. A rebrand should have to be
    // stated twice.
    //
    // `importActual` for the same reason the row above uses it: tests/setup.ts
    // pins the brand seam for the whole suite, and asserting against the mock
    // would be true by construction.
    assert: async () => {
      const seam =
        await vi.importActual<typeof import('@/lib/app/leaf-brand')>('@/lib/app/leaf-brand');
      expect(seam.leafBrandName).toBe('Lelañea');
      expect(seam.leafBrandLegalName).toBe('All Too Human Ltd');
      expect(seam.leafBrandDescription).toBe(
        'Lelañea — an application built on the Daybreak framework.'
      );
    },
  },
  {
    seam: 'lib/app/csp.ts',
    risk: 'a stray origin would widen the iframe policy on every install',
    // These values are spliced straight into a response header, so an
    // accidental default here is a security change, not a cosmetic one.
    assert: () => expect(appFrameSrc).toEqual([]),
  },
  {
    // PINNED (Daybreak fills this bridge). Upstream ships all three lists empty
    // and asserts exactly that; Daybreak declares the FRAMEWORK tier's entries
    // here and spreads the reserved leaf lists after them, so "registers
    // nothing" is not this checkout's contract — "registers the framework's
    // entries, and nothing else" is. The third list (ownerless-surface
    // exceptions, Sunrise 0.12.0) carries the framework's five by-design reads —
    // the evaluation family (scoped by surface, not owner), the module
    // workflow-binding dispatcher, and the framework's Art. 15 manifest.
    //
    // Pinned by VALUE rather than by length, because the risk below is about
    // WHICH path is exempted, and a count cannot see a pattern that changed.
    // A leaf filling `leaf-ci.ts` will break this row as well as its own — the
    // bridge-above-the-leaf-seam gap in #234, of which this is the fourth
    // instance. Pin the leaf's additions here when that happens; do not delete
    // the row.
    seam: 'lib/app/ci.ts',
    risk: 'a stray coverage exclusion would switch the per-file 80% floor OFF for that path on every install, a stray always-run entry would make every scoped run load a test whose file the install may not even have, and a stray ownerless-surface exception would let a route read rows nobody owns without the policy being asked — the first silences a gate, the second breaks the gate that replaced it, the third exempts a file from the authorization seam',
    assert: () => {
      expect(appCoverageExclusions.map((entry) => entry.pattern)).toEqual([
        'scripts/boundary/check.ts',
        'scripts/release/changelog-check.ts',
      ]);
      expect(appAlwaysRunTests.map((entry) => entry.path)).toEqual([
        // Daybreak's two, declared in the bridge itself.
        'tests/unit/prisma/framework-boot-seed.test.ts',
        'tests/unit/scripts/release/changelog-structure.test.ts',
        // LELAÑEA's six, spread after them from `leaf-ci.ts`. Pinned here as
        // well as on the row below because this row is what proves the bridge
        // actually REACHES the leaf seam — the leaf row alone would still pass
        // if the spread were dropped, and every scoped run would then silently
        // stop loading these six.
        'tests/unit/components/app/ui/tokens-only.test.ts',
        'tests/unit/app/public/authored-provenance.test.ts',
        'tests/unit/context/app-docs-paths.test.ts',
        'tests/unit/app/shell-not-found-streaming.test.ts',
        'tests/unit/components/app/shell/chrome.test.tsx',
        'tests/unit/lib/app/voice/upload-scope.test.ts',
      ]);
      expect(appOwnerlessSurfaceExceptions.map((entry) => entry.path)).toEqual([
        'lib/framework/facilitation/evaluation/conversation.ts',
        'lib/framework/facilitation/evaluation/recent-conversations.ts',
        'lib/framework/facilitation/evaluation/turns.ts',
        'lib/framework/modules/workflow-bindings/dispatch.ts',
        'lib/framework/privacy/export-sources.ts',
        // LELAÑEA's two, spread after them from `leaf-ci.ts` — pinned here too,
        // for the same reason as the always-run tests above (§08 t-54, t-56).
        'lib/app/agent/turn-record.ts',
        'lib/app/agent/metering.ts',
      ]);
      // Every entry is a settled design, not a gap awaiting a fix.
      expect(appOwnerlessSurfaceExceptions.map((entry) => entry.disposition)).toEqual(
        Array<'by-design'>(7).fill('by-design')
      );
    },
  },
  {
    // Daybreak's reserved leaf CI seam — the one a LEAF fills. Daybreak keeps it
    // empty, which is the whole reason the bridge above exists: Sunrise's seam is
    // built for two tiers, and filling `ci.ts` directly would put Daybreak's
    // entries in the file a leaf is invited to edit.
    seam: 'lib/app/leaf-ci.ts',
    risk: "a value here is Daybreak occupying the surface it reserves for a leaf, so the leaf's own entries would collide with it on every upgrade — the conflict Sunrise #759 removed one tier up, re-created one tier down",
    // PINNED (Lelañea fills this seam) — `HB2`. Daybreak keeps it empty; we do
    // not. Pinned rather than deleted so the row still guards the two lists we
    // have NOT filled: a coverage exclusion appearing here would switch the
    // per-file 80% floor off for that path — and nothing else would notice. The
    // ownerless-surface list is filled too (§08 t-54, t-56) and pinned by value, so a
    // second exemption from the authorization seam still fails here.
    assert: () => {
      expect(leafCoverageExclusions).toEqual([]);
      expect(leafAlwaysRunTests.map((entry) => entry.path)).toEqual([
        'tests/unit/components/app/ui/tokens-only.test.ts',
        'tests/unit/app/public/authored-provenance.test.ts',
        'tests/unit/context/app-docs-paths.test.ts',
        'tests/unit/app/shell-not-found-streaming.test.ts',
        'tests/unit/components/app/shell/chrome.test.tsx',
        'tests/unit/lib/app/voice/upload-scope.test.ts',
      ]);
      // §08 t-54 — the turn record's two owner-scoped message reads, by design.
      // §08 t-56 — the meter's seat-only conversation join, by design.
      expect(
        leafOwnerlessSurfaceExceptions.map((entry) => [entry.path, entry.disposition])
      ).toEqual([
        ['lib/app/agent/turn-record.ts', 'by-design'],
        ['lib/app/agent/metering.ts', 'by-design'],
      ]);
    },
  },
];

afterEach(() => {
  __resetNavRegistryForTests();
  __resetAccountSectionRegistryForTests();
  __resetAuthorizationPolicyForTests();
});

describe('lib/app/ seams ship empty', () => {
  it.each(SEAM_DEFAULTS)('$seam registers nothing by default', async ({ assert }) => {
    await assert();
  });

  it('nothing but this file escapes the suite-wide brand-seam pin', () => {
    // tests/setup.ts mocks `@/lib/app/brand` to null for EVERY test file, so
    // that no core test can read a fork's brand and fail for a reason the fork
    // cannot fix (#660/#661). That guarantee holds across all ~1095 test files
    // by construction, but only while nothing escapes the mock.
    //
    // `vi.importActual` is legitimate here and nowhere else: it is what makes
    // the brand row above assert the REAL scaffold rather than the mock, which
    // is what keeps "seams ship empty" able to fail in a fork.
    //
    // `vi.doUnmock` is never right. It REMOVES the pin instead of restoring it,
    // so every later case in that file sees the real seam. That is not
    // hypothetical: it shipped twice during this change — once in this suite's
    // own brand tests (13 cases failed against a filled seam) and once in
    // layout-metadata, where it was invisible only because every remaining case
    // happened to re-stub first. To go back to the null default mid-file,
    // re-`doMock` it; do not unmock it.
    //
    // Matched by REGEX over vitest's whole unmocking surface, not by two string
    // literals. The literal version missed `vi.unmock` — a third escape route —
    // and was also defeated by double quotes or a line-wrapped call. That is the
    // enumerating-guard failure mode this repo keeps meeting: it fails one
    // instance per round. vitest exposes exactly `unmock` and `doUnmock` for
    // removing a mock, so anchoring on `(?:do)?unmock` is exhaustive over the API
    // rather than over the spellings someone happened to think of.
    const seamPath = String.raw`['"\`]@/lib/app/brand['"\`]`;
    const unmockRe = new RegExp(String.raw`\bvi\s*\.\s*(?:do)?[Uu]nmock\s*\(\s*` + seamPath);
    const actualRe = new RegExp(String.raw`importActual[\s\S]{0,80}?` + seamPath);

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, 'utf8');
        const rel = path.relative(process.cwd(), full);
        if (unmockRe.test(src)) {
          offenders.push(`${rel}: unmocks the pin instead of restoring it`);
        }
        if (actualRe.test(src) && rel !== THIS_FILE) {
          offenders.push(`${rel}: reads the real seam past the pin`);
        }
      }
    };
    walk(path.join(process.cwd(), 'tests'));

    expect(
      offenders,
      'These test files escape the brand-seam pin in tests/setup.ts. A fork that ' +
        'fills lib/app/brand.ts would see its own brand here and fail a core test ' +
        'it cannot fix — the exact class #660 is about. Re-doMock the null values ' +
        'instead of unmocking, and leave importActual to this file.'
    ).toEqual([]);
  });

  it('has a row for every seam file in lib/app/', () => {
    // Drift guard: adding a `lib/app/*` seam without adding a row above would
    // leave it silently unprotected. Reads the directory rather than trusting
    // the table to be complete.
    const dir = path.join(process.cwd(), 'lib/app');
    const onDisk = readdirSync(dir)
      .filter((f) => /\.(ts|mjs)$/.test(f) && !f.endsWith('.d.ts'))
      .map((f) => `lib/app/${f}`);

    const covered = new Set(SEAM_DEFAULTS.map((s) => s.seam));
    const missing = onDisk.filter((f) => !covered.has(f) && !UNASSERTED_SEAMS.has(f));
    const stale = [...covered].filter((f) => !onDisk.includes(f));

    expect(missing, 'lib/app/ seam with no row in SEAM_DEFAULTS').toEqual([]);
    expect(stale, 'SEAM_DEFAULTS row for a file that no longer exists').toEqual([]);
  });
});
