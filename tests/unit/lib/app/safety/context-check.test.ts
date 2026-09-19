/**
 * The context check may only soften a hard hit, and anything but a clean
 * "figurative" leaves it hard (f-safety t-58).
 *
 * Each failure case asserts the outcome that keeps the hard tier. Were a
 * failure mapped to `softened` — the fallback inverted — its case fails here,
 * and again in `assess.test.ts`, where the outcome becomes a tier.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  defaultModel: vi.fn(),
  getModel: vi.fn(),
  getProvider: vi.fn(),
  chat: vi.fn(),
  logCost: vi.fn(),
}));

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/orchestration/llm/settings-resolver', () => ({
  getDefaultModelForTaskOrNull: mocks.defaultModel,
}));
vi.mock('@/lib/orchestration/llm/model-registry', () => ({ getModel: mocks.getModel }));
vi.mock('@/lib/orchestration/llm/provider-manager', () => ({ getProvider: mocks.getProvider }));
vi.mock('@/lib/orchestration/llm/cost-tracker', () => ({ logCost: mocks.logCost }));

import { checkCrisisContext } from '@/lib/app/safety/context-check';

const INPUT = {
  message: "I'd never kill myself over a spreadsheet",
  userId: 'user-1',
  seat: 'onboarding',
};

function answers(content: string): void {
  mocks.chat.mockResolvedValue({ content, usage: { inputTokens: 90, outputTokens: 2 } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.defaultModel.mockResolvedValue('gpt-4o-mini');
  mocks.getModel.mockReturnValue({ provider: 'openai' });
  mocks.getProvider.mockResolvedValue({ chat: mocks.chat });
  mocks.logCost.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkCrisisContext', () => {
  it('softens only on the one answer that means figurative', async () => {
    answers('FIGURATIVE');
    expect(await checkCrisisContext(INPUT)).toBe('softened');
  });

  it.each(['figurative.', ' Figurative\n'])(
    'forgives case, spacing and a full stop: %j',
    async (a) => {
      answers(a);
      expect(await checkCrisisContext(INPUT)).toBe('softened');
    }
  );

  it.each(['DANGER', '', 'Figurative, probably', 'I cannot help with that'])(
    'keeps the hit hard for any other answer: %j',
    async (a) => {
      answers(a);
      expect(await checkCrisisContext(INPUT)).toBe('confirmed');
    }
  );

  it('asks the routing side model on its own provider, with the message as data', async () => {
    answers('DANGER');
    await checkCrisisContext(INPUT);
    expect(mocks.getProvider).toHaveBeenCalledWith('openai');
    const [messages, options] = mocks.chat.mock.calls[0] as [
      Array<{ role: string; content: string }>,
      { model: string; signal: AbortSignal },
    ];
    expect(options.model).toBe('gpt-4o-mini');
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: INPUT.message });
  });

  it('bills the call to the person under the seat, marked as a crisis check', async () => {
    answers('DANGER');
    await checkCrisisContext(INPUT);
    expect(mocks.logCost).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        model: 'gpt-4o-mini',
        metadata: { seat: 'onboarding', kind: 'crisis_context_check' },
      })
    );
  });

  it('bills nobody before signup, rather than a synthetic id', async () => {
    answers('DANGER');
    await checkCrisisContext({ ...INPUT, userId: null });
    expect(mocks.logCost.mock.calls[0]?.[0]).not.toHaveProperty('userId');
  });

  it('still answers when the cost row cannot be written', async () => {
    answers('FIGURATIVE');
    mocks.logCost.mockRejectedValue(new Error('db down'));
    expect(await checkCrisisContext(INPUT)).toBe('softened');
  });

  describe('every failure leaves the deterministic tier standing', () => {
    it('error: the model call rejects with something that is not an Error', async () => {
      mocks.chat.mockRejectedValue('socket hang up');
      expect(await checkCrisisContext(INPUT)).toBe('error');
    });

    it('unreachable: the provider lookup rejects with something that is not an Error', async () => {
      mocks.getProvider.mockRejectedValue('no row');
      expect(await checkCrisisContext(INPUT)).toBe('unavailable');
    });

    it('error: the model call throws', async () => {
      mocks.chat.mockRejectedValue(new Error('provider 500'));
      expect(await checkCrisisContext(INPUT)).toBe('error');
    });

    it('unreachable: the provider cannot be built (disabled, missing, no key)', async () => {
      mocks.getProvider.mockRejectedValue(new Error('Provider "openai" is disabled'));
      expect(await checkCrisisContext(INPUT)).toBe('unavailable');
      expect(mocks.chat).not.toHaveBeenCalled();
    });

    it('unreachable: no side model is configured', async () => {
      mocks.defaultModel.mockResolvedValue(null);
      expect(await checkCrisisContext(INPUT)).toBe('unavailable');
    });

    it('unreachable: the side model is unknown to the registry', async () => {
      mocks.getModel.mockReturnValue(undefined);
      expect(await checkCrisisContext(INPUT)).toBe('unavailable');
    });

    it('timeout: the model does not answer by the deadline, and its call is aborted', async () => {
      vi.useFakeTimers();
      let signal: AbortSignal | undefined;
      mocks.chat.mockImplementation((_m: unknown, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => {}); // never answers, and ignores the abort
      });

      const pending = checkCrisisContext({ ...INPUT, deadlineMs: 1_000 });
      await vi.advanceTimersByTimeAsync(1_000);

      expect(await pending).toBe('timeout');
      expect(signal?.aborted).toBe(true);
    });

    it('a message too long to read whole is never softened, and never sent', async () => {
      answers('FIGURATIVE');
      const long = `${'a'.repeat(5_000)} I want to kill myself`;
      expect(await checkCrisisContext({ ...INPUT, message: long })).toBe('unavailable');
      expect(mocks.chat).not.toHaveBeenCalled();
    });
  });
});
