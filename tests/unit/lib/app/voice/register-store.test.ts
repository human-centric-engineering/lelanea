/**
 * The reads behind a turn's register (f-registers t-125): the person's current
 * module, that module's config, a recent crisis, and the register a running
 * turn was claimed with. Prisma, the journey read and the config read are
 * mocked; the wiring against a real database is `smoke:app-register`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  prisma: {
    appSafetyEvent: { findFirst: vi.fn() },
    appTurn: { findFirst: vi.fn() },
  },
}));
vi.mock('@/lib/app/onboarding/first-run-store', () => ({ readJourneyNodeStates: vi.fn() }));
vi.mock('@/lib/framework/modules/config', () => ({ getModuleConfigForm: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { readJourneyNodeStates } from '@/lib/app/onboarding/first-run-store';
import { getModuleConfigForm } from '@/lib/framework/modules/config';
import { readCurrentModuleSlug, resolveRegister } from '@/lib/app/voice/register-store';

const nodes = vi.mocked(readJourneyNodeStates);
const config = vi.mocked(getModuleConfigForm);
const crisis = vi.mocked(prisma.appSafetyEvent.findFirst);
const running = vi.mocked(prisma.appTurn.findFirst);

const NOW = new Date('2026-10-02T12:00:00Z');

function node(
  nodeKey: string,
  status: string,
  lastActiveAt: string | null,
  progress: unknown = null
) {
  return {
    nodeKey,
    status,
    lastActiveAt: lastActiveAt ? new Date(lastActiveAt) : null,
    firstEnteredAt: null,
    progress,
  } as unknown as Awaited<ReturnType<typeof readJourneyNodeStates>>[number];
}

function storedConfig(values: unknown) {
  return { registered: true, descriptors: [], values } as Awaited<
    ReturnType<typeof getModuleConfigForm>
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  nodes.mockResolvedValue([
    node('onboarding', 'completed', '2026-10-01T10:00:00Z'),
    node('values', 'active', '2026-10-02T09:00:00Z'),
  ]);
  config.mockResolvedValue(storedConfig({}));
  crisis.mockResolvedValue(null);
  running.mockResolvedValue(null);
});

describe('readCurrentModuleSlug', () => {
  it('is the active node the person was in most recently', async () => {
    nodes.mockResolvedValue([
      node('boundaries', 'active', '2026-10-01T09:00:00Z'),
      node('values', 'active', '2026-10-02T09:00:00Z'),
      node('standards', 'completed', '2026-10-02T11:00:00Z'),
    ]);

    await expect(readCurrentModuleSlug('u1')).resolves.toBe('values');
  });

  it('is null with no journey, or nothing active', async () => {
    nodes.mockResolvedValue([]);
    await expect(readCurrentModuleSlug('u1')).resolves.toBeNull();
    nodes.mockResolvedValue([node('onboarding', 'completed', null)]);
    await expect(readCurrentModuleSlug('u1')).resolves.toBeNull();
  });
});

describe('resolveRegister', () => {
  it('has none on a seat with no register, and reads nothing', async () => {
    await expect(resolveRegister('u1', 'onboarding')).resolves.toBeNull();
    await expect(resolveRegister('', 'facilitator')).resolves.toBeNull();
    expect(nodes).not.toHaveBeenCalled();
  });

  it('starts Values at teaching when its config says nothing', async () => {
    await expect(resolveRegister('u1', 'facilitator', { now: NOW })).resolves.toEqual({
      register: 'teaching',
      source: 'module',
      moduleSlug: 'values',
    });
    expect(config).toHaveBeenCalledWith('values');
  });

  it('follows what an admin stored in the module’s config', async () => {
    config.mockResolvedValue(storedConfig({ register: 'guiding' }));

    await expect(resolveRegister('u1', 'facilitator')).resolves.toMatchObject({
      register: 'guiding',
      source: 'module',
    });
  });

  it('reads a stored value it does not recognise as where the module starts', async () => {
    config.mockResolvedValue(storedConfig({ register: 'stern' }));

    await expect(resolveRegister('u1', 'facilitator')).resolves.toMatchObject({
      register: 'teaching',
    });
  });

  it('steers to guiding after a crisis within the hold, and asks for one that recent', async () => {
    crisis.mockResolvedValue({ id: 'e1' } as never);

    await expect(resolveRegister('u1', 'facilitator', { now: NOW })).resolves.toEqual({
      register: 'guiding',
      source: 'safety',
      moduleSlug: 'values',
    });
    expect(crisis).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        kind: 'crisis',
        createdAt: { gte: new Date('2026-10-01T12:00:00Z') },
      },
      select: { id: true },
    });
  });

  it('counts a crisis shown on this very turn without reading the records', async () => {
    await expect(resolveRegister('u1', 'facilitator', { crisisNow: true })).resolves.toMatchObject({
      register: 'guiding',
      source: 'safety',
    });
    expect(crisis).not.toHaveBeenCalled();
  });

  it('fails towards guiding when the crisis check throws, without recording a crisis', async () => {
    crisis.mockRejectedValue(new Error('pool exhausted'));

    // Guiding, as a crisis would be, but `fallback`: the account must not tell
    // the person something hard happened when the record was never read.
    await expect(resolveRegister('u1', 'facilitator')).resolves.toMatchObject({
      register: 'guiding',
      source: 'fallback',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('crisis check failed'),
      expect.objectContaining({ error: 'pool exhausted' })
    );
  });

  it('uses the module’s start when its config cannot be read, and logs it', async () => {
    config.mockRejectedValue(new Error('Module "values" not found'));

    await expect(resolveRegister('u1', 'facilitator')).resolves.toMatchObject({
      register: 'teaching',
      source: 'module',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('module config could not be read'),
      expect.objectContaining({ moduleSlug: 'values' })
    );
  });

  describe('what the person asked for (t-126)', () => {
    const asked = (register: string, askedAt: string) =>
      nodes.mockResolvedValue([
        node('values', 'active', '2026-10-02T09:00:00Z', {
          registerLean: { register, askedAt },
        }),
      ]);

    it('beats the module while it holds, read off the module’s own node', async () => {
      asked('guiding', '2026-10-02T11:00:00Z');

      await expect(resolveRegister('u1', 'facilitator', { now: NOW })).resolves.toEqual({
        register: 'guiding',
        source: 'asked',
        moduleSlug: 'values',
      });
    });

    it('lapses after a sitting, back to the module', async () => {
      asked('guiding', '2026-10-01T23:00:00Z');

      await expect(resolveRegister('u1', 'facilitator', { now: NOW })).resolves.toMatchObject({
        register: 'teaching',
        source: 'module',
      });
    });

    it('is beaten by a crisis, so asking to be pushed never pushes someone struggling', async () => {
      asked('teaching', '2026-10-02T11:00:00Z');
      crisis.mockResolvedValue({ id: 'e1' } as never);

      await expect(resolveRegister('u1', 'facilitator', { now: NOW })).resolves.toMatchObject({
        register: 'guiding',
        source: 'safety',
      });
    });
  });

  it('uses the default with no journey to read, and never throws', async () => {
    nodes.mockRejectedValue(new Error('down'));

    await expect(resolveRegister('u1', 'facilitator')).resolves.toEqual({
      register: 'guiding',
      source: 'module',
      moduleSlug: null,
    });
    expect(config).not.toHaveBeenCalled();
  });
});

describe('the fallbacks a failure takes', () => {
  it('orders by first entry when a node has never been active since', async () => {
    nodes.mockResolvedValue([
      {
        nodeKey: 'boundaries',
        status: 'active',
        lastActiveAt: null,
        firstEnteredAt: new Date('2026-10-02T10:00:00Z'),
        progress: null,
      },
      {
        nodeKey: 'values',
        status: 'active',
        lastActiveAt: null,
        firstEnteredAt: null,
        progress: null,
      },
    ] as never);

    await expect(readCurrentModuleSlug('u1')).resolves.toBe('boundaries');
  });

  it('reads a config that is not an object as saying nothing', async () => {
    config.mockResolvedValue(storedConfig(null));

    await expect(resolveRegister('u1', 'facilitator')).resolves.toMatchObject({
      register: 'teaching',
    });
  });

  it('logs a thrown non-Error as a string, on every read', async () => {
    nodes.mockRejectedValueOnce('journey reset');
    await resolveRegister('u1', 'facilitator');
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), { error: 'journey reset' });

    config.mockRejectedValueOnce('config reset');
    crisis.mockRejectedValueOnce('crisis reset');
    await resolveRegister('u1', 'facilitator');
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), {
      moduleSlug: 'values',
      error: 'config reset',
    });
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), { error: 'crisis reset' });
  });
});
