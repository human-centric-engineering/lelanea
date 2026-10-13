/**
 * The framework tier's platform agents (Hub t-142): the rubric judge's definition, and its
 * registration into core's platform-agent registry through the `lib/app/platform-agents.ts` bridge.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { PlatformAgentDefinition } from '@/lib/orchestration/agents/platform-agents';

// The leaf seam, controllable per test. `vi.mock` takes a path, not an import, so the framework
// tier's ban on importing `@/lib/app` is not crossed.
const leaf = vi.hoisted(() => ({ register: null as null | (() => void) }));
vi.mock('@/lib/app/leaf-platform-agents', () => ({
  initLeafPlatformAgents: () => leaf.register?.(),
}));
const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));
import {
  FRAMEWORK_PLATFORM_AGENTS,
  initFrameworkPlatformAgents,
} from '@/lib/framework/platform-agents';
import {
  FRAMEWORK_RUBRIC_JUDGE_AGENT,
  FRAMEWORK_RUBRIC_JUDGE_SLUG,
  RUBRIC_STEPS,
} from '@/lib/framework/facilitation/evaluation/rubric-judge';
import { buildJudgePrompt } from '@/lib/orchestration/evaluations/judge-driver';
import {
  CORE_PLATFORM_AGENTS,
  getPlatformAgent,
  listPlatformAgents,
  platformAgentRegistryHash,
  platformAgentsForOrg,
  registerPlatformAgent,
  __resetPlatformAgentsForTests,
} from '@/lib/orchestration/agents/platform-agents';

beforeEach(() => {
  leaf.register = null;
  vi.clearAllMocks();
  __resetPlatformAgentsForTests();
});

describe('the framework-rubric judge definition', () => {
  it('is a deterministic, knowledge-restricted judge every org gets', () => {
    expect(FRAMEWORK_RUBRIC_JUDGE_AGENT).toMatchObject({
      slug: 'eval-judge-framework-rubric',
      audience: 'every-org',
      agent: {
        kind: 'judge',
        temperature: 0.2,
        maxTokens: 1000,
        knowledgeAccessMode: 'restricted',
      },
      capabilities: [],
      knowledgeTags: [],
    });
  });

  it('keeps the slug the rubric scorer drives', () => {
    expect(FRAMEWORK_RUBRIC_JUDGE_SLUG).toBe(FRAMEWORK_RUBRIC_JUDGE_AGENT.slug);
  });

  it('pins the judge output contract the grader parses (score in 0–1, reasoning)', () => {
    const prompt = FRAMEWORK_RUBRIC_JUDGE_AGENT.agent.systemInstructions;
    expect(prompt).toContain('"score": <number from 0.0 to 1.0 inclusive>');
    expect(prompt).toContain('"reasoning"');
  });

  it('asks for one labelled evaluation_steps entry per numbered EVALUATION STEP', () => {
    // A judge told to walk N steps but given a schema with M != N entries either emits the wrong
    // count or mislabels them, so the stored steps disagree with the rubric (Hub t-144).
    const prompt = FRAMEWORK_RUBRIC_JUDGE_AGENT.agent.systemInstructions;
    const stepsBlock = prompt.slice(
      prompt.indexOf('EVALUATION STEPS'),
      prompt.indexOf('SCORING SCALE')
    );
    const numbered = [...stepsBlock.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
    const schemaBlock = prompt.slice(
      prompt.indexOf('"evaluation_steps"'),
      prompt.indexOf('"score"')
    );
    const labelled = [...schemaBlock.matchAll(/"Step (\d+) \(/g)].map((m) => Number(m[1]));

    expect(numbered).toEqual(RUBRIC_STEPS.map((_, i) => i + 1));
    expect(labelled).toEqual(numbered);
    // And each entry is labelled with its own step's topic, in order.
    RUBRIC_STEPS.forEach((step, i) =>
      expect(schemaBlock).toContain(`"Step ${i + 1} (${step.label}): <${step.report}>"`)
    );
  });

  it('names only input sections the judge driver actually sends', () => {
    // The judge is told what it will receive; a heading it is told about that never arrives makes it
    // skip a step (the grounding step once looked for CITATIONS while the driver sent CITED SOURCES).
    const prompt = FRAMEWORK_RUBRIC_JUDGE_AGENT.agent.systemInstructions;
    const receiveBlock = prompt.slice(
      prompt.indexOf('You will receive:'),
      prompt.indexOf('EVALUATION STEPS')
    );
    const headings = [...receiveBlock.matchAll(/^- ([A-Z][A-Z ]+?)(?: \(optional\))?:/gm)].map(
      (m) => m[1]
    );
    expect(headings).toEqual(['QUESTION', 'ANSWER', 'CITED SOURCES']);

    const sent = buildJudgePrompt({
      question: 'q',
      answer: 'a',
      citations: [{ marker: 1, documentName: 'doc', excerpt: 'x' }],
      toolCalls: [],
    });
    for (const heading of headings) expect(sent).toMatch(new RegExp(`^${heading}: `, 'm'));
    expect(prompt).not.toMatch(/\bCITATIONS\b/);
  });

  it('does not take a core slug', () => {
    const coreSlugs = new Set(CORE_PLATFORM_AGENTS.map((d) => d.slug));
    for (const definition of FRAMEWORK_PLATFORM_AGENTS) {
      expect(coreSlugs.has(definition.slug)).toBe(false);
    }
  });
});

describe('registration through the bridge', () => {
  it('lands after core’s definitions, and every org gets an instance', () => {
    const registered = listPlatformAgents();
    expect(registered.slice(0, CORE_PLATFORM_AGENTS.length)).toEqual(CORE_PLATFORM_AGENTS);
    expect(getPlatformAgent(FRAMEWORK_RUBRIC_JUDGE_SLUG)).toBe(FRAMEWORK_RUBRIC_JUDGE_AGENT);
    expect(platformAgentsForOrg('some-customer-org').map((d) => d.slug)).toContain(
      FRAMEWORK_RUBRIC_JUDGE_SLUG
    );
  });

  it('passes core’s registration checks and is idempotent', () => {
    listPlatformAgents();
    const hash = platformAgentRegistryHash();
    expect(() => initFrameworkPlatformAgents()).not.toThrow();
    expect(getPlatformAgent(FRAMEWORK_RUBRIC_JUDGE_SLUG)).toBe(FRAMEWORK_RUBRIC_JUDGE_AGENT);
    expect(platformAgentRegistryHash()).toBe(hash);
  });

  it('lets a leaf replace the framework judge by slug, and names it at warn', () => {
    const replacement: PlatformAgentDefinition = {
      ...FRAMEWORK_RUBRIC_JUDGE_AGENT,
      agent: { ...FRAMEWORK_RUBRIC_JUDGE_AGENT.agent, systemInstructions: 'A leaf rubric.' },
    };
    leaf.register = () => registerPlatformAgent(replacement);
    expect(getPlatformAgent(FRAMEWORK_RUBRIC_JUDGE_SLUG)).toBe(replacement);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'platform-agents: a leaf definition replaced a framework platform agent',
      { slug: FRAMEWORK_RUBRIC_JUDGE_SLUG }
    );
  });

  it('does not warn when the leaf leaves the framework’s agents alone', () => {
    listPlatformAgents();
    expect(mockLogger.warn).not.toHaveBeenCalledWith(
      'platform-agents: a leaf definition replaced a framework platform agent',
      expect.anything()
    );
  });

  it('a throwing leaf init rolls the framework’s agents back too (core’s gate is one unit)', () => {
    leaf.register = () => {
      throw new Error('leaf init broke');
    };
    const registered = listPlatformAgents();
    expect(registered).toEqual(CORE_PLATFORM_AGENTS);
    expect(getPlatformAgent(FRAMEWORK_RUBRIC_JUDGE_SLUG)).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });
});
