/**
 * The synopsis seat tells the provider gate who chose its provider.
 *
 * Since Sunrise 0.14.0 a call is checked at call time against the provider
 * eligibility rule, and a bare `getProvider(slug)` is held to both 'primary'
 * and 'explicit'. The seat forwards its binding's provenance, as Daybreak's own
 * calls do, so a rule that treats the two differently judges it correctly.
 *
 * @see lib/app/journey-record/synopsis/seat.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  getProvider: vi.fn(),
  complete: vi.fn(),
  logCost: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/orchestration/llm/cost-tracker', () => ({ logCost: mocks.logCost }));
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({ getProvider: mocks.getProvider }));
vi.mock('@/lib/orchestration/llm/agent-resolver', () => ({
  resolveAgentProviderAndModel: mocks.resolve,
}));
vi.mock('@/lib/orchestration/llm/structured-completion', () => ({
  runStructuredCompletion: mocks.complete,
}));
vi.mock('@/lib/framework/facilitation/agents/binding-queries', () => ({
  getFacilitationBindingByRole: vi.fn(),
}));
vi.mock('@/lib/app/agent/availability', () => ({ isGenerationPaused: vi.fn() }));
vi.mock('@/lib/app/agent/ceiling', () => ({ mayStartGeneratedTurn: vi.fn() }));
vi.mock('@/lib/app/voice/comparison', () => ({
  AGENT_SELECT: {},
  composeAgentPrompt: vi.fn(),
}));

import { askSeat, type SeatAgent } from '@/lib/app/journey-record/synopsis/seat';

const AGENT: SeatAgent = {
  id: 'agent-1',
  provider: '',
  model: '',
  fallbackProviders: [],
  temperature: 0.4,
  systemPrompt: 'You are the synopsis seat.',
};

const CALL = {
  kind: 'synopsis',
  messages: [{ role: 'user' as const, content: 'Summarise.' }],
  responseSchema: { type: 'object' },
  responseSchemaName: 'synopsis',
  parse: (value: unknown) => value,
  retryUserMessage: 'Again, as JSON.',
  maxTokens: 400,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProvider.mockResolvedValue({ name: 'openai' });
  mocks.complete.mockResolvedValue({ value: { ok: true }, tokenUsage: { input: 10, output: 5 } });
  mocks.logCost.mockResolvedValue(undefined);
});

describe('askSeat', () => {
  it.each([
    ['primary', 'a blank provider, so Sunrise chose it'],
    ['explicit', 'a provider an operator named'],
  ] as const)(
    "passes the binding's provenance to the provider gate: %s (%s)",
    async (source, _why) => {
      mocks.resolve.mockResolvedValue({
        providerSlug: 'openai',
        model: 'gpt-4o-mini',
        fallbacks: [],
        provenance: { task: 'chat', primary: source, fallbacks: 'explicit' },
      });

      await expect(askSeat('user-1', AGENT, CALL)).resolves.toEqual({ ok: true });

      expect(mocks.getProvider).toHaveBeenCalledWith('openai', {
        task: 'chat',
        source,
        primarySlug: null,
      });
    }
  );
});
