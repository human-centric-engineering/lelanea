/**
 * The voice-fingerprint seed: what it writes, what a re-run must not, and the
 * one column the whole designation feature turns on.
 *
 * Three claims, and the third is the reason this file exists at all.
 *
 * ## 1. `fp4` — idempotent, safe on empty, ownership classified
 *
 * The profile is a pure code projection and is reconciled; the agent is split,
 * with `profileId` and `knowledgeAccessMode` code-owned and everything else
 * written once. A re-run on a current database issues **no write at all**, which
 * is the only shape that could churn `updatedAt` in a harness with no database
 * (`B9`). And a run whose source composed to an empty section aborts rather than
 * blanking a populated one.
 *
 * ## 2. The agent is created `restricted` — proved through the REAL resolver
 *
 * The hard requirement of §05 t-26, and the assertion is deliberately NOT
 * `expect(create).toHaveBeenCalledWith({ knowledgeAccessMode: 'restricted' })`.
 * That would pass against a seed whose row never reached the database, and it
 * would prove nothing about the function that actually decides. So the seed runs
 * against a stateful fake world, and then Sunrise's own
 * `resolveAgentDocumentAccess` is pointed at that same world and asked what it
 * makes of every agent the seed left behind.
 *
 * **Reverting the mode fails this file.** Change `REQUIRED_KNOWLEDGE_ACCESS_MODE`
 * to `'full'`, or drop the column from the create, and the resolver returns
 * `{ mode: 'full' }` — at which point it has already returned *above*
 * `collectAccessContributions()`, t-25's designation rule never executes, and
 * voice-only and `sensitivity-client` material is quotable again while
 * `/admin/app/knowledge` still reports **Agent may quote: No** for it.
 *
 * ## 3. Why a stateful fake rather than sequenced one-shot mocks
 *
 * Because claim 2 needs the seed's writes to be READABLE by a second, unrelated
 * consumer. Sequenced mocks cannot express "and then something else looked at
 * what you wrote".
 *
 * @see prisma/seeds/app-lelanea/003-voice-fingerprint.ts
 * @see lib/orchestration/knowledge/resolveAgentDocumentAccess.ts — the short-circuit
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeProfile {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  persona: string | null;
  guardrails: string | null;
  brandVoiceInstructions: string | null;
  isSystem: boolean;
}

interface FakeAgent {
  id: string;
  slug: string;
  name: string;
  systemInstructions: string;
  knowledgeAccessMode: string;
  profileId: string | null;
  isSystem: boolean;
  persona: string | null;
  guardrails: string | null;
  brandVoiceInstructions: string | null;
}

const world = {
  users: [{ id: 'service-account', accountType: 'SERVICE' }] as {
    id: string;
    accountType: string;
  }[],
  profiles: [] as FakeProfile[],
  agents: [] as FakeAgent[],
};

/** Every write the fake saw, so "a re-run writes nothing" is checkable. */
const writes = { profileCreate: 0, profileUpdate: 0, agentCreate: 0, agentUpdate: 0 };

let nextId = 0;

vi.mock('@/lib/db/client', () => ({
  prisma: {
    user: {
      findFirst: vi.fn(
        async ({ where }: { where: { accountType: string } }) =>
          world.users.find((user) => user.accountType === where.accountType) ?? null
      ),
    },
    aiAgentProfile: {
      findUnique: vi.fn(
        async ({ where }: { where: { slug?: string; id?: string } }) =>
          world.profiles.find(
            (profile) => profile.slug === where.slug || profile.id === where.id
          ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Omit<FakeProfile, 'id'> }) => {
        writes.profileCreate += 1;
        const profile: FakeProfile = { id: `profile-${(nextId += 1)}`, ...data };
        world.profiles.push(profile);
        return profile;
      }),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FakeProfile> }) => {
          writes.profileUpdate += 1;
          const profile = world.profiles.find((candidate) => candidate.id === where.id);
          if (!profile) throw new Error(`No profile ${where.id}`);
          Object.assign(profile, data);
          return profile;
        }
      ),
    },
    aiAgent: {
      findUnique: vi.fn(
        async ({ where }: { where: { slug?: string; id?: string } }) =>
          world.agents.find((agent) => agent.slug === where.slug || agent.id === where.id) ?? null
      ),
      // The three inheritable columns default to NULL in the schema, so a seed
      // that omits them must land NULL here — not `undefined`, which would make
      // "the agent carries none of its own" pass without the seed omitting them.
      create: vi.fn(
        async ({
          data,
        }: {
          data: Omit<FakeAgent, 'id' | 'persona' | 'guardrails' | 'brandVoiceInstructions'> &
            Partial<Pick<FakeAgent, 'persona' | 'guardrails' | 'brandVoiceInstructions'>>;
        }) => {
          writes.agentCreate += 1;
          const agent: FakeAgent = {
            id: `agent-${(nextId += 1)}`,
            ...data,
            persona: data.persona ?? null,
            guardrails: data.guardrails ?? null,
            brandVoiceInstructions: data.brandVoiceInstructions ?? null,
          };
          world.agents.push(agent);
          return agent;
        }
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Partial<FakeAgent> }) => {
          writes.agentUpdate += 1;
          const agent = world.agents.find((candidate) => candidate.id === where.id);
          if (!agent) throw new Error(`No agent ${where.id}`);
          Object.assign(agent, data);
          return agent;
        }
      ),
    },
    // The resolver's own restricted-branch queries, and the corpus
    // contributor's. Empty: her agents carry no operator grants, and this file
    // is about the MODE rather than about which documents it admits — which
    // `tests/unit/lib/app/voice/corpus-access.test.ts` already pins.
    aiAgentKnowledgeDocument: { findMany: vi.fn(async () => []) },
    aiAgentKnowledgeTag: { findMany: vi.fn(async () => []) },
    aiKnowledgeDocumentTag: { findMany: vi.fn(async () => []) },
    aiKnowledgeDocument: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * A lever on the projection, so the seed's emptiness guard is reachable.
 *
 * `vi.mock` with `importOriginal` rather than `vi.spyOn` on the namespace: an ES
 * module namespace is sealed, so a spy on it is a coin toss between throwing and
 * silently doing nothing — and "silently doing nothing" would leave the guard
 * case passing while never running the guard.
 */
let sectionsOverride: {
  persona: string;
  guardrails: string;
  brandVoiceInstructions: string;
} | null = null;

vi.mock('@/lib/app/voice/fingerprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/voice/fingerprint')>();
  return {
    ...actual,
    composeFingerprintProfileSections: (...args: unknown[]) =>
      sectionsOverride ??
      (actual.composeFingerprintProfileSections as (...a: unknown[]) => unknown)(...args),
  };
});

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import unit, {
  REQUIRED_KNOWLEDGE_ACCESS_MODE,
  sectionsArePopulated,
} from '@/prisma/seeds/app-lelanea/003-voice-fingerprint';
import {
  VOICE_AGENT_SLUG,
  VOICE_PROFILE_SLUG,
  composeFingerprintProfileSections,
  readFingerprintVersion,
} from '@/lib/app/voice/fingerprint';
import { getVoiceFingerprint } from '@/lib/app/content';
import { CORPUS_AGENT_SLUG_PREFIX, isCorpusAgent } from '@/lib/app/voice/corpus-access';
import {
  resolveAgentDocumentAccess,
  invalidateAllAgentAccess,
  __resetAgentAccessContributorsForTests,
} from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';

function ctx() {
  return { prisma: prisma as never, logger: logger as never };
}

async function runSeed(): Promise<void> {
  await unit.run(ctx());
}

beforeEach(() => {
  vi.clearAllMocks();
  world.profiles = [];
  world.agents = [];
  world.users = [{ id: 'service-account', accountType: 'SERVICE' }];
  writes.profileCreate = 0;
  writes.profileUpdate = 0;
  writes.agentCreate = 0;
  writes.agentUpdate = 0;
  nextId = 0;
  sectionsOverride = null;
  invalidateAllAgentAccess();
  __resetAgentAccessContributorsForTests();
});

describe('what a first run writes', () => {
  it('creates the profile with all three sections and the version in it', async () => {
    await runSeed();

    const profile = world.profiles.find((candidate) => candidate.slug === VOICE_PROFILE_SLUG);
    expect(profile).toBeDefined();
    expect(profile?.persona?.length).toBeGreaterThan(0);
    expect(profile?.guardrails?.length).toBeGreaterThan(0);
    expect(profile?.brandVoiceInstructions?.length).toBeGreaterThan(0);
    expect(readFingerprintVersion(profile?.persona ?? '')).toBe(
      getVoiceFingerprint().collection.version
    );
  });

  it('creates one agent, linked to that profile and speaking with none of its own', async () => {
    await runSeed();

    const agent = world.agents.find((candidate) => candidate.slug === VOICE_AGENT_SLUG);
    expect(agent?.profileId).toBe(world.profiles[0].id);
    // NULL, not a copy. A populated agent column overrides the profile by
    // default, so a second copy of her voice here would silently win and then
    // drift.
    expect(agent?.persona).toBeNull();
    expect(agent?.guardrails).toBeNull();
    expect(agent?.brandVoiceInstructions).toBeNull();
  });

  it('sets the access mode explicitly rather than inheriting the column default', async () => {
    await runSeed();

    const [[create]] = vi.mocked(prisma.aiAgent.create).mock.calls as unknown as [
      [{ data: Record<string, unknown> }],
    ];
    // `'restricted'` has to be in the CREATE, not arrived at afterwards: the
    // window between an agent existing on `full` and something correcting it is
    // a window in which her voice material is quotable.
    expect(create.data.knowledgeAccessMode).toBe(REQUIRED_KNOWLEDGE_ACCESS_MODE);
  });

  it('throws rather than writing an unowned profile when the service account is missing', async () => {
    world.users = [];

    await expect(runSeed()).rejects.toThrow(/admin user/i);
    expect(writes.profileCreate).toBe(0);
  });
});

describe('a re-run', () => {
  it('writes nothing at all when the database is already current', async () => {
    await runSeed();
    const after = { ...writes };

    await runSeed();

    // Not "writes the same thing again" — no write is issued, so `updatedAt`
    // never moves. That is the property `fp4` asks for and the reason this is
    // not an upsert with an empty update.
    expect(writes).toEqual(after);
    expect(writes.profileUpdate).toBe(0);
    expect(writes.agentUpdate).toBe(0);
  });

  it('reconciles the profile text when the authored core has moved on', async () => {
    await runSeed();
    world.profiles[0].persona = 'something an operator typed into the admin';

    await runSeed();

    expect(writes.profileUpdate).toBe(1);
    expect(world.profiles[0].persona).toBe(composeFingerprintProfileSections().persona);
  });

  it('puts the access mode back when something has flipped it to full', async () => {
    // `SYSTEM_AGENT_PROTECTED_FIELDS` does not cover `knowledgeAccessMode`, so an
    // admin PATCH can do exactly this after the seed has run. Re-seeding is the
    // remedy, which is why the column is reconciled rather than set once.
    await runSeed();
    world.agents[0].knowledgeAccessMode = 'full';

    await runSeed();

    expect(world.agents[0].knowledgeAccessMode).toBe(REQUIRED_KNOWLEDGE_ACCESS_MODE);
    expect(writes.agentUpdate).toBe(1);
  });

  it('leaves the operator-owned columns alone', async () => {
    await runSeed();
    world.agents[0].name = 'Lelañea (renamed by an operator)';
    world.agents[0].knowledgeAccessMode = 'full';

    await runSeed();

    expect(world.agents[0].name).toBe('Lelañea (renamed by an operator)');
  });
});

describe('safe on empty', () => {
  it('recognises a projection with a blank section', () => {
    expect(sectionsArePopulated(composeFingerprintProfileSections())).toBe(true);
    expect(
      sectionsArePopulated({ persona: 'a', guardrails: '', brandVoiceInstructions: 'c' })
    ).toBe(false);
    expect(
      sectionsArePopulated({ persona: '   ', guardrails: 'b', brandVoiceInstructions: 'c' })
    ).toBe(false);
  });

  it('never blanks a populated section — the guard is on the write, not on the type', async () => {
    // The source composing to nothing is not reachable through today's strict
    // schema, but the loader's own docblock says this file moves behind a
    // database the day copy has to change without a deploy. On that day this
    // guard is the only thing between a bad read and a profile with no voice
    // in it.
    await runSeed();

    // The profile is now STALE, so a run that reached the write would update it.
    // Without this the assertions below pass on a database that was simply
    // already current, and the guard is never exercised at all (`fp6`).
    const operatorText = 'something an operator typed into the admin';
    world.profiles[0].persona = operatorText;

    sectionsOverride = { persona: '', guardrails: '', brandVoiceInstructions: '' };
    await runSeed();

    expect(writes.profileUpdate).toBe(0);
    expect(world.profiles[0].persona).toBe(operatorText);
    expect(vi.mocked(logger.warn)).toHaveBeenCalled();

    // And the counterfactual: the same stale row, the same second run, with the
    // real projection back. This is what proves the no-write above was the guard
    // rather than the state.
    sectionsOverride = null;
    await runSeed();

    expect(writes.profileUpdate).toBe(1);
    expect(world.profiles[0].persona).not.toBe(operatorText);
  });
});

describe('the mode, through the resolver that actually decides', () => {
  it('leaves at least one of her agents behind to ask about', async () => {
    // fp6: every assertion below is a `for` over this set, and an empty set
    // would make all of them pass while proving nothing.
    await runSeed();

    const hers = world.agents.filter((agent) => isCorpusAgent(agent.slug));
    expect(hers.length).toBeGreaterThan(0);
    expect(hers.map((agent) => agent.slug)).toContain(
      `${CORPUS_AGENT_SLUG_PREFIX}${VOICE_AGENT_SLUG.slice(CORPUS_AGENT_SLUG_PREFIX.length)}`
    );
  });

  it('resolves every lelanea- agent to restricted, so the designation rule runs', async () => {
    await runSeed();

    for (const agent of world.agents.filter((candidate) => isCorpusAgent(candidate.slug))) {
      const access = await resolveAgentDocumentAccess(agent.id);

      // Asked of Sunrise's resolver against the row the seed left behind — not
      // of the object the seed passed to `create`. A `full` answer here means
      // the resolver returned above `collectAccessContributions()` and t-25's
      // rule never ran.
      expect(access.mode).toBe('restricted');
    }
  });

  it('would answer full for the same agent on the platform default, which is the failure', async () => {
    // The counterfactual, stated rather than trusted: this is what a seed that
    // omitted the column would produce, and it passes silently everywhere else.
    await runSeed();
    world.agents[0].knowledgeAccessMode = 'full';
    invalidateAllAgentAccess();

    expect((await resolveAgentDocumentAccess(world.agents[0].id)).mode).toBe('full');
  });
});
