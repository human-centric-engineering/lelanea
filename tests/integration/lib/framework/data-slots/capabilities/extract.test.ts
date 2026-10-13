/**
 * Prose→typed extraction fallback (f-slot-capture t-3b). Mocks the DB agent lookup, the
 * provider resolver, and `runStructuredCompletion` so no live provider/DB is touched.
 * Proves: text short-circuits, an orphaned agent returns null, the happy path forwards an
 * object-wrapped schema and returns the extracted value, the parse closure extracts +
 * type-validates `.value`, and any failure degrades to null (never throws).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({ prisma: { aiAgent: { findUnique: vi.fn() } } }));
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({ getProvider: vi.fn() }));
vi.mock('@/lib/orchestration/llm/agent-resolver', () => ({
  resolveAgentProviderAndModel: vi.fn(),
}));
// `runStructuredCompletion` relocated to lib/orchestration/llm (Sunrise #410); mock it there.
// `tryParseJson` stays in parse-structured and is used for real (the parse closure below).
vi.mock('@/lib/orchestration/llm/structured-completion', () => ({
  runStructuredCompletion: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { extractTypedValue } from '@/lib/framework/data-slots/capabilities/extract';
import { prisma } from '@/lib/db/client';
import { getProvider } from '@/lib/orchestration/llm/provider-manager';
import { resolveAgentProviderAndModel } from '@/lib/orchestration/llm/agent-resolver';
import { runStructuredCompletion } from '@/lib/orchestration/llm/structured-completion';

const agentRow = { provider: 'openai', model: 'gpt-x', fallbackProviders: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.aiAgent.findUnique).mockResolvedValue(agentRow as never);
  vi.mocked(resolveAgentProviderAndModel).mockResolvedValue({
    providerSlug: 'openai',
    model: 'gpt-x',
    fallbacks: [],
    provenance: { task: 'chat', primary: 'explicit', fallbacks: 'explicit' },
  });
  vi.mocked(getProvider).mockResolvedValue({ chat: vi.fn() } as never);
  vi.mocked(runStructuredCompletion).mockResolvedValue({
    value: 7,
    tokenUsage: { input: 10, output: 2 },
    costUsd: 0.001,
    // Required since Sunrise 0.9.0 (#593/#602): a completion now reports how it
    // ended, so a truncated extraction is distinguishable from a complete one.
    // 'stop' is the shape of the happy path these cases exercise.
    finishReason: 'stop',
  });
});

describe('extractTypedValue', () => {
  it('short-circuits a text slot with no DB or LLM call', async () => {
    expect(await extractTypedValue('text', 'anything', 'agent-1')).toBeNull();
    expect(prisma.aiAgent.findUnique).not.toHaveBeenCalled();
    expect(runStructuredCompletion).not.toHaveBeenCalled();
  });

  it('returns null for an orphaned agent (no provider to resolve)', async () => {
    vi.mocked(prisma.aiAgent.findUnique).mockResolvedValue(null);
    expect(await extractTypedValue('number', 'about seven', 'ghost')).toBeNull();
    expect(runStructuredCompletion).not.toHaveBeenCalled();
  });

  it('returns the extracted value and forwards an object-wrapped schema', async () => {
    const out = await extractTypedValue('number', 'about seven', 'agent-1');
    expect(out).toBe(7);
    const opts = vi.mocked(runStructuredCompletion).mock.calls[0][0];
    expect(opts.responseSchemaName).toBe('slot_value');
    expect(opts.responseSchema).toEqual({
      type: 'object',
      properties: { value: { type: 'number' } },
      required: ['value'],
      additionalProperties: false,
    });
  });

  it("tells the call-time provider gate which arm chose the agent's provider", async () => {
    // A bare getProvider(slug) is held to BOTH 'primary' and 'explicit' by Sunrise 0.14.0's gate,
    // so a fork rule barring only one would wrongly refuse the extraction.
    await extractTypedValue('number', 'about seven', 'agent-1');
    expect(getProvider).toHaveBeenCalledWith('openai', {
      task: 'chat',
      source: 'explicit',
      primarySlug: null,
    });
  });

  it("tags the completion as the 'slot-extraction' phase, not evaluation (t-1.5)", async () => {
    // Omitting `phase` defaults the runner to `'evaluation'`, which mislabels every slot
    // capture in the OTEL trace and the per-phase cost breakdown.
    await extractTypedValue('number', 'about seven', 'agent-1');
    expect(vi.mocked(runStructuredCompletion).mock.calls[0][0].phase).toBe('slot-extraction');
  });

  it('parse closure extracts and type-validates the wrapped value', async () => {
    await extractTypedValue('number', 'about seven', 'agent-1');
    const parse = vi.mocked(runStructuredCompletion).mock.calls[0][0].parse;
    expect(parse('{"value": 5}')).toBe(5);
    expect(parse('{"value": "not a number"}')).toBeNull(); // wrong type rejected locally
    expect(parse('{"nope": 1}')).toBeNull(); // missing value key
    expect(parse('not json')).toBeNull();
  });

  it('degrades to null (never throws) when the completion fails', async () => {
    vi.mocked(runStructuredCompletion).mockRejectedValue(new Error('provider down'));
    await expect(extractTypedValue('number', 'about seven', 'agent-1')).resolves.toBeNull();
  });

  it('degrades to null when the agent DB lookup itself errors (best-effort contract)', async () => {
    vi.mocked(prisma.aiAgent.findUnique).mockRejectedValue(new Error('pool exhausted'));
    await expect(extractTypedValue('number', 'about seven', 'agent-1')).resolves.toBeNull();
  });
});
