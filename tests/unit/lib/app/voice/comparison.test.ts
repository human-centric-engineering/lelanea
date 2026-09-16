/**
 * The two arms are two arms — and a comparison that would run the bare model
 * twice is refused rather than reported as a clean result.
 *
 * This is the load-bearing file of §05 t-28, and the reason is narrow enough to
 * state in a sentence: **every way this feature fails is silent.** A profile
 * detached from her agent, a control pointed at her profile, both arms resolving
 * to the same agent, a model pinned on one side through the admin form — none of
 * those throws, none logs, and every one of them produces two walls of plausible
 * prose that look exactly like a comparison in which her fingerprint changed
 * nothing. The guard is the only thing standing between that and somebody
 * concluding her voice does not matter.
 *
 * ## The assertions are made on the COMPOSED PROMPT, not on the constants
 *
 * Asserting that `VOICE_AGENT_SLUG !== VOICE_CONTROL_AGENT_SLUG` would pass
 * against a world where the control had been given her profile — which is the
 * whole failure. So the arms are resolved out of a stateful fake world through
 * Sunrise's real `resolveEffectivePrompt` / `composeSystemPromptString`, and the
 * difference is asserted on the strings a model would actually receive.
 *
 * Every absence claim sits after a presence claim, for the reason `fp6` names:
 * "the bare arm carries no version marker" passes for free against an empty
 * prompt, so the fingerprint arm's marker is established first.
 *
 * ## Reverting the implementation fails this file
 *
 * Run rather than reasoned about, because a "reverting fails this" claim nobody
 * executed is decoration. Delete the identical-prompt check and **one** case goes
 * red; delete the two version-marker checks and **three** do; delete the
 * provider/model/temperature check and **three** do; rename
 * `VOICE_CONTROL_AGENT_SLUG` to something `lelanea-`-prefixed and **one** does.
 *
 * ---------------------------------------------------------------------------
 * FORK NOTE — this reads the real `lib/app/content` seam
 * ---------------------------------------------------------------------------
 * The module under test composes Lelañea's authored core and her authored
 * control prompt, so this file needs that seam populated. A fork without one
 * should delete this file with the feature. A fork that keeps the shape should
 * keep the `assertArmsComparable` block above all else: it is the only place
 * anything asserts that an A/B comparison of a system prompt is actually
 * comparing two different prompts.
 *
 * @see lib/app/voice/comparison.ts
 * @see .context/app/voice.md
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

interface FakeAgent {
  id: string;
  slug: string;
  isActive: boolean;
  provider: string;
  model: string;
  temperature: number;
  systemInstructions: string;
  persona: string | null;
  guardrails: string | null;
  brandVoiceInstructions: string | null;
  personaMode: string | null;
  voiceMode: string | null;
  guardrailsMode: string | null;
  kind: string;
  profile: {
    id: string;
    name: string;
    persona: string | null;
    guardrails: string | null;
    brandVoiceInstructions: string | null;
  } | null;
}

const world = {
  agents: [] as FakeAgent[],
  datasets: [] as { id: string; contentHash: string; caseCount: number }[],
  comparisons: [] as { id: string; goldenSetVersion: string; datasetContentHash: string }[],
  runs: [] as Record<string, unknown>[],
  arms: [] as Record<string, unknown>[],
};

let nextId = 0;

vi.mock('@/lib/db/client', () => {
  const tx = {
    appVoiceComparison: {
      create: vi.fn(async ({ data }: { data: Record<string, string> }) => {
        const row = { id: `comparison-${(nextId += 1)}`, ...data } as (typeof world.comparisons)[0];
        world.comparisons.push(row);
        return row;
      }),
    },
    aiEvaluationRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `run-${(nextId += 1)}`, ...data };
        world.runs.push(row);
        return row;
      }),
    },
    appVoiceComparisonArm: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        world.arms.push(data);
        return data;
      }),
    },
  };

  return {
    prisma: {
      aiAgent: {
        findMany: vi.fn(async ({ where }: { where: { slug: { in: string[] } } }) =>
          world.agents.filter((agent) => where.slug.in.includes(agent.slug))
        ),
        findUnique: vi.fn(
          async ({ where }: { where: { slug: string } }) =>
            world.agents.find((agent) => agent.slug === where.slug) ?? null
        ),
      },
      aiDataset: {
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            world.datasets.find((dataset) => dataset.id === where.id) ?? null
        ),
      },
      $transaction: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    },
  };
});

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const noteMaintenanceWork = vi.fn();
vi.mock('@/lib/orchestration/maintenance/idle-gate', () => ({
  noteMaintenanceWork: (...args: unknown[]) => noteMaintenanceWork(...args),
}));

import {
  assertArmsComparable,
  queueVoiceComparison,
  resolveVoiceArms,
  type ResolvedVoiceArm,
} from '@/lib/app/voice/comparison';
import {
  BRAND_VOICE_JUDGE_SLUG,
  VOICE_ARMS,
  VOICE_CONTROL_AGENT_SLUG,
  goldenSetDatasetId,
} from '@/lib/app/voice/golden-set';
import {
  VOICE_AGENT_SLUG,
  VOICE_AGENT_SYSTEM_INSTRUCTIONS,
  composeFingerprintProfileSections,
} from '@/lib/app/voice/fingerprint';
import { isCorpusAgent } from '@/lib/app/voice/corpus-access';
import { getVoiceGoldenSet } from '@/lib/app/content';

/** The world the seeds are supposed to leave behind. */
function seedWorld(): void {
  const sections = composeFingerprintProfileSections();
  const goldenSet = getVoiceGoldenSet();

  world.agents = [
    {
      id: 'agent-her',
      slug: VOICE_AGENT_SLUG,
      isActive: true,
      provider: '',
      model: '',
      temperature: 0.7,
      systemInstructions: VOICE_AGENT_SYSTEM_INSTRUCTIONS,
      // Her agent's own three inheritable columns are NULL so the PROFILE is
      // what speaks — which is what `003-voice-fingerprint.ts` writes.
      persona: null,
      guardrails: null,
      brandVoiceInstructions: null,
      personaMode: null,
      voiceMode: null,
      guardrailsMode: null,
      kind: 'chat',
      profile: { id: 'profile-core', name: 'core', ...sections },
    },
    {
      id: 'agent-control',
      slug: VOICE_CONTROL_AGENT_SLUG,
      isActive: true,
      provider: '',
      model: '',
      temperature: 0.7,
      systemInstructions: goldenSet.control.systemInstructions,
      persona: null,
      guardrails: null,
      brandVoiceInstructions: null,
      personaMode: null,
      voiceMode: null,
      guardrailsMode: null,
      kind: 'chat',
      profile: null,
    },
    {
      id: 'agent-judge',
      slug: BRAND_VOICE_JUDGE_SLUG,
      isActive: true,
      provider: '',
      model: '',
      temperature: 0,
      systemInstructions: 'rubric',
      persona: null,
      guardrails: null,
      brandVoiceInstructions: null,
      personaMode: null,
      voiceMode: null,
      guardrailsMode: null,
      kind: 'judge',
      profile: null,
    },
  ];

  world.datasets = [
    {
      id: goldenSetDatasetId(goldenSet.collection.version),
      contentHash: 'hash-of-the-authored-prompts',
      caseCount: goldenSet.prompts.length,
    },
  ];
  world.comparisons = [];
  world.runs = [];
  world.arms = [];
}

function agent(slug: string): FakeAgent {
  const found = world.agents.find((candidate) => candidate.slug === slug);
  if (!found) throw new Error(`No agent ${slug} in the fake world`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 0;
  seedWorld();
});

describe('the control agent is outside her corpus by construction', () => {
  it('is not `lelanea-`-prefixed, so the corpus contributor never widens it', () => {
    // A presence claim first, so "the control is not a corpus agent" cannot pass
    // because `isCorpusAgent` returns false for everything.
    expect(isCorpusAgent(VOICE_AGENT_SLUG)).toBe(true);

    expect(isCorpusAgent(VOICE_CONTROL_AGENT_SLUG)).toBe(false);
  });
});

describe('resolveVoiceArms', () => {
  it('composes two different prompts, and only one of them carries her voice', async () => {
    const arms = await resolveVoiceArms();
    const fingerprint = arms.find((arm) => arm.arm === 'fingerprint');
    const bare = arms.find((arm) => arm.arm === 'bare');

    // Presence before absence (`fp6`): both prompts have to be real strings
    // before "they differ" or "one carries no marker" means anything.
    expect(fingerprint?.systemPrompt.length).toBeGreaterThan(0);
    expect(bare?.systemPrompt.length).toBeGreaterThan(0);

    expect(fingerprint?.systemPrompt).not.toBe(bare?.systemPrompt);
    expect(fingerprint?.fingerprintVersion).toBe(getVoiceGoldenSetCoreVersion());
    expect(bare?.fingerprintVersion).toBeNull();
  });

  it('reads the version out of the composed prompt, not off the authored file', async () => {
    // The distinction that makes attribution honest. Detach the profile and the
    // arm must report that it is carrying NO version — not the version the
    // content file happens to hold, which is what a loader-based read would say.
    agent(VOICE_AGENT_SLUG).profile = null;

    const arms = await resolveVoiceArms();
    expect(arms.find((arm) => arm.arm === 'fingerprint')?.fingerprintVersion).toBeNull();
  });

  it('refuses an arm whose agent is missing, naming the remedy', async () => {
    world.agents = world.agents.filter((entry) => entry.slug !== VOICE_CONTROL_AGENT_SLUG);
    await expect(resolveVoiceArms()).rejects.toThrow(/db:seed/);
  });

  it('refuses an arm whose agent is inactive', async () => {
    agent(VOICE_CONTROL_AGENT_SLUG).isActive = false;
    await expect(resolveVoiceArms()).rejects.toThrow(/inactive/i);
  });
});

describe('assertArmsComparable — the four silent misconfigurations', () => {
  async function arms(): Promise<ResolvedVoiceArm[]> {
    return resolveVoiceArms();
  }

  it('passes on the world the seeds leave behind', async () => {
    await expect(arms().then((a) => assertArmsComparable(a))).resolves.toBeUndefined();
  });

  it(`refuses anything that is not exactly ${VOICE_ARMS.length} arms`, async () => {
    const resolved = await arms();
    expect(() => assertArmsComparable([])).toThrow(/needs exactly/i);
    expect(() => assertArmsComparable([resolved[0]])).toThrow(/needs exactly/i);
  });

  it('refuses when her agent lost its profile — a bare answer filed as hers', async () => {
    agent(VOICE_AGENT_SLUG).profile = null;
    await expect(arms().then((a) => assertArmsComparable(a))).rejects.toThrow(
      /carries no fingerprint version/i
    );
  });

  it('refuses when the CONTROL wears her profile — her against herself', async () => {
    // The failure the whole file exists for. Both arms answer, both sound like
    // her, the comparison reports no difference, and the conclusion drawn is
    // that her fingerprint does nothing.
    const sections = composeFingerprintProfileSections();
    agent(VOICE_CONTROL_AGENT_SLUG).profile = {
      id: 'profile-core',
      name: 'core',
      ...sections,
    };

    await expect(arms().then((a) => assertArmsComparable(a))).rejects.toThrow(
      /the control is wearing her voice/i
    );
  });

  it('refuses when both arms would run the identical prompt', async () => {
    // Reached by hand rather than through the world: the marker checks above
    // would fire first on any world-level way of producing it, so a case that
    // only mutated the world could never exercise this branch and the check
    // would be decoration.
    const [fingerprint, bare] = await arms();
    expect(fingerprint).toBeDefined();
    expect(bare).toBeDefined();

    expect(() =>
      assertArmsComparable([
        fingerprint,
        { ...bare, systemPrompt: fingerprint.systemPrompt, fingerprintVersion: null },
      ])
    ).toThrow(/identical system prompt/i);
  });

  it.each([
    ['model', { model: 'claude-opus-5' }],
    ['provider', { provider: 'openai' }],
    ['temperature', { temperature: 0.2 }],
  ])(
    'refuses when the arms differ on %s — that compares models, not voices',
    async (_column, patch) => {
      Object.assign(agent(VOICE_CONTROL_AGENT_SLUG), patch);
      await expect(arms().then((a) => assertArmsComparable(a))).rejects.toThrow(
        /different models/i
      );
    }
  );
});

describe('queueVoiceComparison', () => {
  it('queues one run per arm over the SAME dataset, and records which arm each was', async () => {
    const queued = await queueVoiceComparison('admin-1');

    expect(queued.arms).toHaveLength(2);
    expect(world.runs).toHaveLength(2);
    expect(world.arms).toHaveLength(2);

    // Same questions, different agents. Both halves matter: a shared dataset is
    // what makes the answers comparable, and different agents are what makes
    // there be two arms at all.
    expect(new Set(world.runs.map((run) => run.datasetId)).size).toBe(1);
    expect(new Set(world.runs.map((run) => run.agentId)).size).toBe(2);

    expect(world.arms.map((arm) => arm.arm).sort()).toEqual(['bare', 'fingerprint']);
    const fingerprintArm = world.arms.find((arm) => arm.arm === 'fingerprint');
    const bareArm = world.arms.find((arm) => arm.arm === 'bare');
    expect(fingerprintArm?.fingerprintVersion).toBe(getVoiceGoldenSetCoreVersion());
    expect(bareArm?.fingerprintVersion).toBeNull();

    // The prompt is stored whole, and it is the evidence behind the version
    // string beside it — so it must be the prompt, not a summary of one.
    expect(String(fingerprintArm?.systemPrompt)).toContain('Voice fingerprint:');
    expect(String(bareArm?.systemPrompt)).not.toContain('Voice fingerprint:');
  });

  it('pins HER brand voice onto the judge for both arms', async () => {
    // Sunrise's own route pins the SUBJECT's brand voice, which for the control
    // is null — the judge would fall back to a generic rubric and score the bare
    // arm against nothing in particular, producing a number that cannot be
    // compared with the other arm's.
    const brandVoice = composeFingerprintProfileSections().brandVoiceInstructions;
    expect(brandVoice.length).toBeGreaterThan(0);

    await queueVoiceComparison('admin-1');

    for (const run of world.runs) {
      expect(run.metricConfigs).toEqual([
        {
          slug: 'judge_agent',
          config: { agentSlug: BRAND_VOICE_JUDGE_SLUG, subjectBrandVoice: brandVoice },
        },
      ]);
    }
  });

  it('un-arms the idle gate, or the runs sit queued until its cap expires', async () => {
    await queueVoiceComparison('admin-1');
    expect(noteMaintenanceWork).toHaveBeenCalledWith('voice-comparison-queued');
  });

  it('writes NOTHING when the arms are not comparable', async () => {
    agent(VOICE_CONTROL_AGENT_SLUG).profile = {
      id: 'profile-core',
      name: 'core',
      ...composeFingerprintProfileSections(),
    };

    await expect(queueVoiceComparison('admin-1')).rejects.toThrow();

    // The half that matters. A refusal that had already created the runs would
    // have spent real money on a comparison nothing could read back.
    expect(world.runs).toHaveLength(0);
    expect(world.arms).toHaveLength(0);
    expect(world.comparisons).toHaveLength(0);
    expect(noteMaintenanceWork).not.toHaveBeenCalled();
  });

  it('refuses when the golden set for the authored version is not seeded', async () => {
    world.datasets = [];
    await expect(queueVoiceComparison('admin-1')).rejects.toThrow(/is not in this install/i);
    expect(world.runs).toHaveLength(0);
  });

  it('refuses when the brand-voice judge is inactive, rather than queueing unscored', async () => {
    agent(BRAND_VOICE_JUDGE_SLUG).isActive = false;
    await expect(queueVoiceComparison('admin-1')).rejects.toThrow(/brand-voice judge/i);
    expect(world.runs).toHaveLength(0);
  });
});

/** The version the authored core carries, read the way the prompt carries it. */
function getVoiceGoldenSetCoreVersion(): string {
  const marker = /Voice fingerprint:\s+\S+\s+v(\d+\.\d+(?:\.\d+)?)/.exec(
    composeFingerprintProfileSections().persona
  );
  if (!marker) throw new Error('The authored core composed no version marker');
  return marker[1];
}
