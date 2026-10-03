/**
 * `set_register` (f-registers t-126): the person's ask, written as their own
 * lean on the module they are in, from the facilitator seat only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/app/voice/register-store', () => ({ readCurrentModuleSlug: vi.fn() }));
vi.mock('@/lib/app/voice/register-lean', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/voice/register-lean')>()),
  recordRegisterLean: vi.fn(),
}));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { readCurrentModuleSlug } from '@/lib/app/voice/register-store';
import { recordRegisterLean } from '@/lib/app/voice/register-lean';
import { SetRegisterCapability } from '@/lib/app/voice/register-capability';
import type { CapabilityContext } from '@/lib/orchestration/capabilities/types';

const current = vi.mocked(readCurrentModuleSlug);
const record = vi.mocked(recordRegisterLean);
const tool = new SetRegisterCapability();

const onSeat = (seat: string, userId: string | null = 'u1'): CapabilityContext => ({
  userId,
  agentId: 'agent-1',
  costLogMetadata: { turnId: 't1', seat },
});

beforeEach(() => {
  vi.clearAllMocks();
  current.mockResolvedValue('values');
  record.mockResolvedValue('recorded');
});

describe('set_register', () => {
  it('records the caller’s own lean on the module they are in, and says until when', async () => {
    const result = await tool.execute({ register: 'guiding' }, onSeat('facilitator'));

    expect(result.success).toBe(true);
    expect(record).toHaveBeenCalledWith('u1', 'values', 'guiding', expect.any(Date));
    expect(result.data).toMatchObject({ register: 'guiding', holdsUntil: expect.any(String) });
  });

  it('clears it when the person asks to go back', async () => {
    const result = await tool.execute({ register: 'default' }, onSeat('facilitator'));

    expect(record).toHaveBeenCalledWith('u1', 'values', null, expect.any(Date));
    expect(result.data).toEqual({ register: 'default', holdsUntil: null });
  });

  it('writes against the caller only: the user comes from the context, never the arguments', async () => {
    await tool.execute({ register: 'teaching' }, onSeat('facilitator', 'someone-else'));

    expect(current).toHaveBeenCalledWith('someone-else');
    expect(record.mock.calls[0][0]).toBe('someone-else');
    // The arguments carry no user at all, so there is nothing a model can name.
    expect(Object.keys(tool.functionDefinition.parameters.properties as object)).toEqual([
      'register',
    ]);
  });

  it.each([
    ['the onboarding seat', onSeat('onboarding'), 'wrong_seat'],
    ['no turn at all', { userId: 'u1', agentId: 'agent-1' }, 'wrong_seat'],
    ['no person', onSeat('facilitator', null), 'no_person'],
  ] as const)('refuses from %s, and writes nothing', async (_case, context, code) => {
    const result = await tool.execute({ register: 'guiding' }, context);

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe(code);
    expect(record).not.toHaveBeenCalled();
  });

  it('answers, rather than throwing, when there is no module or the write fails', async () => {
    current.mockResolvedValue(null);
    expect((await tool.execute({ register: 'guiding' }, onSeat('facilitator'))).error?.code).toBe(
      'no_module'
    );

    current.mockResolvedValue('values');
    record.mockResolvedValue('no_module');
    expect((await tool.execute({ register: 'guiding' }, onSeat('facilitator'))).error?.code).toBe(
      'no_module'
    );

    record.mockRejectedValue(new Error('down'));
    expect((await tool.execute({ register: 'guiding' }, onSeat('facilitator'))).error?.code).toBe(
      'not_recorded'
    );
  });

  it('accepts only a register or default', () => {
    expect(tool.functionDefinition.parameters).toMatchObject({
      properties: { register: { enum: ['guiding', 'teaching', 'default'] } },
    });
  });
});
