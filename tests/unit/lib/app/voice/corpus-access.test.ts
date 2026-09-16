/**
 * The rule that keeps voice-only material off the tool path — end to end.
 *
 * This is the load-bearing test for §05 t-25, and it deliberately runs the WHOLE
 * chain rather than the leaf's own function in isolation: Sunrise's
 * `resolveAgentDocumentAccess` → the auto-wired seam in
 * `lib/app/knowledge-access-contributors.ts` → this leaf's rule → the database.
 * A test of `resolveQuotableDocumentIds()` alone would pass with the contributor
 * unregistered, which is precisely the failure that would ship her Substack into
 * a reply.
 *
 * ## The population is established before anything is asserted absent (`fp6`)
 *
 * "The voice document is not in the set" passes for free on an empty set, and an
 * empty set is what a mis-wired contributor returns. So every absence assertion
 * here sits after an assertion that the set is NON-EMPTY and contains the
 * documents it should — the presence claims are what make the absence claims mean
 * anything.
 *
 * ## Reverting the rule fails this file
 *
 * Add `'voice'` to `TOOL_PATH_PURPOSES` in `lib/app/voice/designation.ts` and
 * `disqualifyingTagSlugs()` — derived as *the purposes NOT on the tool path* —
 * returns `[]` for purposes, the voice document qualifies, and
 * `excludes the voice-designated document` fails. Remove `'client'` from
 * `UNGRANTABLE_SENSITIVITIES` and the client case fails the same way. That is the
 * property `fp6` asks for, stated so the next person can check it in ten seconds.
 *
 * ## Why a stateful fake rather than per-call `mockResolvedValueOnce`
 *
 * Unit tests here run with no database (`B9`). Sequenced one-shot mocks would let
 * this file pass while the WHERE clause said something else entirely — the thing
 * under test IS the filter. So the fake below evaluates the exact query shape the
 * rule issues, and a separate case pins that evaluation against `isQuotable()`
 * over every combination of the vocabulary, so the SQL and the pure function
 * cannot drift.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

interface FakeDocument {
  id: string;
  /** `'app'` for her uploads, `'system'` for the platform's pre-loaded corpus. */
  scope: string;
  tagSlugs: string[];
}

interface FakeAgent {
  id: string;
  slug: string;
  knowledgeAccessMode: string;
}

const world = {
  agents: [] as FakeAgent[],
  documents: [] as FakeDocument[],
};

/**
 * Evaluate the ONE where-shape `resolveQuotableDocumentIds()` issues:
 *
 *   { scope: 'app',
 *     tags: { some: { tag: { slug: { in: A } } } },
 *     NOT: { tags: { some: { tag: { slug: { in: B } } } } } }
 *
 * Narrow on purpose. A general Prisma emulator would be a second database to get
 * wrong; this one throws on a shape it does not recognise, so a future change to
 * the query fails loudly here instead of being silently mis-evaluated into a
 * green bar.
 */
function evaluateDocumentWhere(where: unknown): FakeDocument[] {
  const clause = where as {
    scope?: string;
    tags?: { some?: { tag?: { slug?: { in?: string[] } } } };
    NOT?: { tags?: { some?: { tag?: { slug?: { in?: string[] } } } } };
  };
  const qualifying = clause.tags?.some?.tag?.slug?.in;
  const disqualifying = clause.NOT?.tags?.some?.tag?.slug?.in;
  // `scope` is required, not optional. Dropping it from the query would silently
  // widen the rule to the platform's seed corpus, and an optional read here would
  // let that change pass — the shape IS the thing under test.
  if (!Array.isArray(qualifying) || !Array.isArray(disqualifying) || !clause.scope) {
    throw new Error(
      `The fake does not understand this where-clause — the rule's query shape changed: ${JSON.stringify(where)}`
    );
  }
  return world.documents.filter(
    (document) =>
      document.scope === clause.scope &&
      document.tagSlugs.some((slug) => qualifying.includes(slug)) &&
      !document.tagSlugs.some((slug) => disqualifying.includes(slug))
  );
}

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiAgent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const agent = world.agents.find((candidate) => candidate.id === where.id);
        return agent ?? null;
      }),
    },
    aiKnowledgeDocument: {
      findMany: vi.fn(async ({ where }: { where: unknown }) =>
        evaluateDocumentWhere(where).map((document) => ({ id: document.id }))
      ),
    },
    // The resolver's own `restricted` queries. Empty throughout: her agents carry
    // NO operator grants, which is the arrangement the rule depends on (a tag
    // grant would UNION past the client exclusion — see designation.ts).
    aiAgentKnowledgeDocument: { findMany: vi.fn(async () => []) },
    aiAgentKnowledgeTag: { findMany: vi.fn(async () => []) },
    aiKnowledgeDocumentTag: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  resolveAgentDocumentAccess,
  invalidateAllAgentAccess,
  __resetAgentAccessContributorsForTests,
} from '@/lib/orchestration/knowledge/resolveAgentDocumentAccess';
import {
  DOCUMENT_PURPOSES,
  DOCUMENT_SENSITIVITIES,
  isQuotable,
  isVoiceExemplar,
  purposeTagSlug,
  sensitivityTagSlug,
} from '@/lib/app/voice/designation';
import {
  APP_SCOPE,
  CORPUS_AGENT_SLUG_PREFIX,
  disqualifyingTagSlugs,
  isCorpusAgent,
  qualifyingTagSlugs,
  resolveVoiceDocumentIds,
  voiceDisqualifyingTagSlugs,
  voiceQualifyingTagSlugs,
} from '@/lib/app/voice/corpus-access';

const HER_AGENT = 'agent-hers';
const PLATFORM_AGENT = 'agent-platform';

/**
 * A corpus that is not empty and is not all one thing.
 *
 * Six documents spanning what an operator can actually produce through the
 * surface, including the two that must never reach the tool path and the one
 * nobody has answered for.
 */
function seedWorld(): void {
  world.agents = [
    {
      id: HER_AGENT,
      slug: `${CORPUS_AGENT_SLUG_PREFIX}companion`,
      knowledgeAccessMode: 'restricted',
    },
    { id: PLATFORM_AGENT, slug: 'pattern-advisor', knowledgeAccessMode: 'restricted' },
  ];
  world.documents = [
    {
      id: 'doc-knowledge',
      scope: APP_SCOPE,
      tagSlugs: [purposeTagSlug('knowledge'), sensitivityTagSlug('public')],
    },
    {
      id: 'doc-voice',
      scope: APP_SCOPE,
      tagSlugs: [purposeTagSlug('voice'), sensitivityTagSlug('public')],
    },
    {
      id: 'doc-both',
      scope: APP_SCOPE,
      tagSlugs: [purposeTagSlug('both'), sensitivityTagSlug('private')],
    },
    {
      id: 'doc-client',
      scope: APP_SCOPE,
      tagSlugs: [purposeTagSlug('knowledge'), sensitivityTagSlug('client')],
    },
    { id: 'doc-undesignated', scope: APP_SCOPE, tagSlugs: [] },
    // Tagged through the platform's own modal with something unrelated — the rule
    // must not read an unknown tag as an answer.
    { id: 'doc-other-tag', scope: APP_SCOPE, tagSlugs: ['onboarding'] },
    // The platform's own pre-loaded corpus, designated `knowledge` by an operator
    // who did not know it made no difference. See the case below.
    {
      id: 'doc-system',
      scope: 'system',
      tagSlugs: [purposeTagSlug('knowledge'), sensitivityTagSlug('public')],
    },
  ];
}

/** The documents the tool path resolves for one agent. */
async function toolPathDocumentIds(agentId: string): Promise<string[]> {
  const access = await resolveAgentDocumentAccess(agentId);
  if (access.mode !== 'restricted') {
    throw new Error(`Expected a restricted agent, got mode "${access.mode}"`);
  }
  return access.documentIds;
}

beforeEach(() => {
  vi.clearAllMocks();
  invalidateAllAgentAccess();
  __resetAgentAccessContributorsForTests();
  seedWorld();
});

describe('the tool-path document set for one of her agents', () => {
  it('is composed from a non-empty corpus, and includes her quotable material', async () => {
    // fp6: establish the population BEFORE asserting anything is absent from it.
    // Every absence claim below is worthless if this one does not hold.
    expect(world.documents.length).toBeGreaterThan(0);

    const documentIds = await toolPathDocumentIds(HER_AGENT);

    expect(documentIds.length).toBeGreaterThan(0);
    expect(documentIds).toContain('doc-knowledge');
    expect(documentIds).toContain('doc-both');
  });

  it('excludes the voice-designated document', async () => {
    const documentIds = await toolPathDocumentIds(HER_AGENT);

    // Guarded by the presence assertion, so this cannot pass on an empty set.
    expect(documentIds).toContain('doc-knowledge');
    expect(documentIds).not.toContain('doc-voice');
  });

  it('admits nothing marked `sensitivity: client`, whatever its purpose', async () => {
    const documentIds = await toolPathDocumentIds(HER_AGENT);

    // `doc-client` is designated `purpose: knowledge`. It is excluded anyway,
    // which is the half a tag grant could not express.
    expect(documentIds).toContain('doc-knowledge');
    expect(documentIds).not.toContain('doc-client');
  });

  it('contributes no `system`-scoped document, whatever it is designated', async () => {
    // `doc-system` carries `purpose: knowledge`, so the tag filter alone would
    // admit it. It is excluded by scope instead — and the point is not tidiness:
    // the resolver returns `includeSystemScope: true` unconditionally, so that
    // document is searchable by every agent regardless of what this returns.
    // Contributing it would add nothing while making the set look as though it
    // governed material it does not (`B31`).
    const documentIds = await toolPathDocumentIds(HER_AGENT);

    expect(documentIds).toContain('doc-knowledge');
    expect(documentIds).not.toContain('doc-system');
  });

  it('admits nothing nobody has designated', async () => {
    const documentIds = await toolPathDocumentIds(HER_AGENT);

    expect(documentIds).toContain('doc-knowledge');
    expect(documentIds).not.toContain('doc-undesignated');
    expect(documentIds).not.toContain('doc-other-tag');
  });
});

describe('who the rule widens', () => {
  it('contributes nothing to a restricted agent that is not hers', async () => {
    // The platform seeds several restricted agents of its own. Widening those
    // would hand her corpus to the pattern advisor because it happens to be
    // restricted — the leak this participation test exists to prevent.
    const hers = await toolPathDocumentIds(HER_AGENT);
    expect(hers.length).toBeGreaterThan(0);

    const theirs = await toolPathDocumentIds(PLATFORM_AGENT);
    expect(theirs).toEqual([]);
  });

  it('recognises her agents by slug prefix and nothing else', () => {
    expect(isCorpusAgent(`${CORPUS_AGENT_SLUG_PREFIX}companion`)).toBe(true);
    expect(isCorpusAgent('pattern-advisor')).toBe(false);
    expect(isCorpusAgent('not-lelanea-companion')).toBe(false);
    expect(isCorpusAgent(null)).toBe(false);
    expect(isCorpusAgent(undefined)).toBe(false);
  });

  it('leaves a `full` agent alone — a contributor can only widen a restricted one', async () => {
    world.agents.push({ id: 'agent-full', slug: 'lelanea-open', knowledgeAccessMode: 'full' });

    await expect(resolveAgentDocumentAccess('agent-full')).resolves.toEqual({ mode: 'full' });
  });
});

describe('the voice-path document set — the other half of the same vocabulary', () => {
  it('holds her voice material, and the `both` document with it', async () => {
    // fp6: non-empty first, so every absence below is a decision rather than an
    // empty world.
    const documentIds = await resolveVoiceDocumentIds();

    expect(documentIds.length).toBeGreaterThan(0);
    expect(documentIds).toContain('doc-voice');
    expect(documentIds).toContain('doc-both');
  });

  it('is the set the tool path is NOT — the property t-25 shipped and t-27 must not weaken', async () => {
    const voicePath = await resolveVoiceDocumentIds();
    const toolPath = await toolPathDocumentIds(HER_AGENT);

    // The same document, on one path and off the other. Read together, these two
    // lines are the feature: her register reaches the prompt labelled as hers,
    // and the tool that could quote it never sees it.
    expect(voicePath).toContain('doc-voice');
    expect(toolPath).not.toContain('doc-voice');
    // And the reverse, so this is a partition rather than a widening.
    expect(toolPath).toContain('doc-knowledge');
    expect(voicePath).not.toContain('doc-knowledge');
  });

  it('shows the model nothing marked `sensitivity: client`, on this path either', async () => {
    world.documents.push({
      id: 'doc-client-voice',
      scope: APP_SCOPE,
      tagSlugs: [purposeTagSlug('voice'), sensitivityTagSlug('client')],
    });

    const documentIds = await resolveVoiceDocumentIds();

    expect(documentIds).toContain('doc-voice');
    expect(documentIds).not.toContain('doc-client-voice');
  });

  it('offers no `system`-scoped document as an example of how she writes', async () => {
    world.documents.push({
      id: 'doc-system-voice',
      scope: 'system',
      tagSlugs: [purposeTagSlug('voice'), sensitivityTagSlug('public')],
    });

    const documentIds = await resolveVoiceDocumentIds();

    expect(documentIds).toContain('doc-voice');
    expect(documentIds).not.toContain('doc-system-voice');
  });

  it('admits nothing nobody has designated', async () => {
    const documentIds = await resolveVoiceDocumentIds();

    expect(documentIds).toContain('doc-voice');
    expect(documentIds).not.toContain('doc-undesignated');
    expect(documentIds).not.toContain('doc-other-tag');
  });
});

describe('the query and the pure rule agree', () => {
  it('matches `isQuotable()` on every combination of the vocabulary', async () => {
    // The rule exists twice — once as SQL in `resolveQuotableDocumentIds`, once as
    // `isQuotable()` for the admin surface's `Agent may quote` column. Two
    // implementations of one sentence drift, and the drift is invisible: the
    // column would say "No" while the agent quoted it anyway. This walks the
    // whole cartesian product instead of trusting they were written together.
    const combinations = [...DOCUMENT_PURPOSES, null].flatMap((purpose) =>
      [...DOCUMENT_SENSITIVITIES, null].map((sensitivity) => ({ purpose, sensitivity }))
    );

    world.documents = combinations.map(({ purpose, sensitivity }) => ({
      id: `doc-${purpose ?? 'none'}-${sensitivity ?? 'none'}`,
      scope: APP_SCOPE,
      tagSlugs: [
        ...(purpose ? [purposeTagSlug(purpose)] : []),
        ...(sensitivity ? [sensitivityTagSlug(sensitivity)] : []),
      ],
    }));

    const documentIds = await toolPathDocumentIds(HER_AGENT);

    for (const { purpose, sensitivity } of combinations) {
      const id = `doc-${purpose ?? 'none'}-${sensitivity ?? 'none'}`;
      expect({ id, inSet: documentIds.includes(id) }).toEqual({
        id,
        inSet: isQuotable({ purpose, sensitivity, licensing: null }),
      });
    }

    // And the walk was not vacuous: at least one combination is quotable and at
    // least one is not.
    expect(documentIds.length).toBeGreaterThan(0);
    expect(documentIds.length).toBeLessThan(combinations.length);
  });

  it('matches `isVoiceExemplar()` on every combination of the vocabulary', async () => {
    // Same reasoning as the case above, for the other path: the voice rule also
    // exists twice — as SQL here and as `isVoiceExemplar()` — and two
    // implementations of one sentence drift silently.
    const combinations = [...DOCUMENT_PURPOSES, null].flatMap((purpose) =>
      [...DOCUMENT_SENSITIVITIES, null].map((sensitivity) => ({ purpose, sensitivity }))
    );

    world.documents = combinations.map(({ purpose, sensitivity }) => ({
      id: `doc-${purpose ?? 'none'}-${sensitivity ?? 'none'}`,
      scope: APP_SCOPE,
      tagSlugs: [
        ...(purpose ? [purposeTagSlug(purpose)] : []),
        ...(sensitivity ? [sensitivityTagSlug(sensitivity)] : []),
      ],
    }));

    const documentIds = await resolveVoiceDocumentIds();

    for (const { purpose, sensitivity } of combinations) {
      const id = `doc-${purpose ?? 'none'}-${sensitivity ?? 'none'}`;
      expect({ id, inSet: documentIds.includes(id) }).toEqual({
        id,
        inSet: isVoiceExemplar({ purpose, sensitivity, licensing: null }),
      });
    }

    expect(documentIds.length).toBeGreaterThan(0);
    expect(documentIds.length).toBeLessThan(combinations.length);
  });

  it('derives the disqualifiers rather than listing them, so a new purpose is excluded by default', () => {
    // `disqualifyingTagSlugs()` is "every purpose NOT on the tool path" plus the
    // ungrantable sensitivities. Written out by hand it would silently admit a
    // purpose added to the vocabulary later; derived, the safe direction is the
    // default. This is also the revert that must fail the cases above.
    expect(disqualifyingTagSlugs()).toContain(purposeTagSlug('voice'));
    expect(disqualifyingTagSlugs()).toContain(sensitivityTagSlug('client'));
    expect(qualifyingTagSlugs()).toEqual([purposeTagSlug('knowledge'), purposeTagSlug('both')]);
    expect(qualifyingTagSlugs()).not.toContain(purposeTagSlug('voice'));
  });

  it('derives the voice path’s disqualifiers the same way, from the same two sources', () => {
    expect(voiceDisqualifyingTagSlugs()).toContain(purposeTagSlug('knowledge'));
    expect(voiceDisqualifyingTagSlugs()).toContain(sensitivityTagSlug('client'));
    expect(voiceQualifyingTagSlugs()).toEqual([purposeTagSlug('voice'), purposeTagSlug('both')]);
    expect(voiceQualifyingTagSlugs()).not.toContain(purposeTagSlug('knowledge'));
  });
});
