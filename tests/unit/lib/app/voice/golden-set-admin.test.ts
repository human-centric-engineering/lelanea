/**
 * The golden set as `/admin/app/voice` renders it (f-content-seeds t-88):
 * composed from three places that each own one of its facets — the pointer and
 * provenance from `app_voice_golden_set`, the prompts from the dataset's cases,
 * the control's system instructions from the control agent.
 *
 * `getGoldenSetPointer` is mocked rather than exercised for real — its own
 * behaviour is pinned in `golden-set-store.test.ts`. What this suite proves is
 * the COMPOSITION: the right dataset id is asked for from the pointer's
 * version, cases are kept in position order, a case's metadata gaps are papered
 * over rather than dropping the prompt (the same fallback
 * `comparison-admin.ts` makes), and a missing control agent yields an empty
 * string rather than throwing.
 *
 * @see lib/app/voice/golden-set-admin.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';

vi.mock('@/lib/db/client', () => ({ prisma: {} }));
vi.mock('@/lib/app/content/golden-set-store', () => ({ getGoldenSetPointer: vi.fn() }));

import { ContentNotSeededError } from '@/lib/app/content/document-view';
import { getGoldenSetAdminView } from '@/lib/app/voice/golden-set-admin';
import { getGoldenSetPointer } from '@/lib/app/content/golden-set-store';
import { goldenSetDatasetId, VOICE_CONTROL_AGENT_SLUG } from '@/lib/app/voice/golden-set';
import type { VoiceGoldenSetPointer } from '@/lib/app/content/golden-set-store';

function pointer(overrides: Partial<VoiceGoldenSetPointer> = {}): VoiceGoldenSetPointer {
  return {
    id: 'lelanea_voice_golden_set',
    title: 'The golden set',
    version: '1.2',
    locale: 'en-US',
    provenance: {
      status: 'drafted',
      awaitingSignOffFrom: 'her',
      note: 'A proposal, not yet signed off.',
    },
    status: 'draft',
    revision: 1,
    ...overrides,
  };
}

interface StubCase {
  position: number;
  input: unknown;
  metadata: unknown;
}

function stubClient(
  options: { cases?: StubCase[]; control?: { systemInstructions: string } | null } = {}
) {
  return {
    aiDatasetCase: { findMany: vi.fn(async () => options.cases ?? []) },
    aiAgent: { findUnique: vi.fn(async () => options.control ?? null) },
  } as unknown as PrismaClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getGoldenSetAdminView', () => {
  it('composes the pointer, the cases in position order, and the control’s instructions', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const cases: StubCase[] = [
      {
        position: 0,
        input: 'How do I start?',
        metadata: { key: 'opening', kind: 'warmth', probe: 'Does it land warm?' },
      },
      {
        position: 1,
        input: 'Push past a boundary',
        metadata: { key: 'boundary', kind: 'limits', probe: 'Does it hold the line?' },
      },
    ];
    const client = stubClient({
      cases,
      control: { systemInstructions: 'You are the bare control.' },
    });

    const view = await getGoldenSetAdminView(client);

    expect(view).toMatchObject({
      version: '1.2',
      provenanceNote: 'A proposal, not yet signed off.',
      awaitingSignOffFrom: 'her',
      controlInstructions: 'You are the bare control.',
    });
    expect(view.prompts).toEqual([
      { key: 'opening', kind: 'warmth', prompt: 'How do I start?', probe: 'Does it land warm?' },
      {
        key: 'boundary',
        kind: 'limits',
        prompt: 'Push past a boundary',
        probe: 'Does it hold the line?',
      },
    ]);
    expect(client.aiDatasetCase.findMany).toHaveBeenCalledWith({
      where: { datasetId: goldenSetDatasetId('1.2') },
      orderBy: { position: 'asc' },
      select: { position: true, input: true, metadata: true },
    });
    expect(client.aiAgent.findUnique).toHaveBeenCalledWith({
      where: { slug: VOICE_CONTROL_AGENT_SLUG },
      select: { systemInstructions: true },
    });
  });

  it('keys a case whose metadata lost its key by position, rather than dropping it', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const client = stubClient({
      cases: [{ position: 3, input: 'A prompt with no key left', metadata: { kind: 'warmth' } }],
    });

    const view = await getGoldenSetAdminView(client);

    expect(view.prompts).toEqual([expect.objectContaining({ key: 'position-3', kind: 'warmth' })]);
  });

  it('stringifies a non-string input rather than dropping the case', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const client = stubClient({
      cases: [{ position: 0, input: { unexpected: 'shape' }, metadata: {} }],
    });

    const view = await getGoldenSetAdminView(client);

    expect(view.prompts[0]?.prompt).toBe(JSON.stringify({ unexpected: 'shape' }));
  });

  it('treats a null metadata column the same as an empty one, rather than throwing', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const client = stubClient({ cases: [{ position: 2, input: 'x', metadata: null }] });

    const view = await getGoldenSetAdminView(client);

    expect(view.prompts[0]).toMatchObject({ key: 'position-2', kind: 'unknown', probe: '' });
  });

  it('defaults an absent kind and probe rather than throwing', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const client = stubClient({ cases: [{ position: 0, input: 'x', metadata: {} }] });

    const view = await getGoldenSetAdminView(client);

    expect(view.prompts[0]).toMatchObject({ key: 'position-0', kind: 'unknown', probe: '' });
  });

  it('throws ContentNotSeededError naming the seed unit when the dataset has no cases', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const client = stubClient({ cases: [] });

    await expect(getGoldenSetAdminView(client)).rejects.toBeInstanceOf(ContentNotSeededError);
    await expect(getGoldenSetAdminView(client)).rejects.toThrow(/004-voice-golden-set\.ts/);
  });

  it('serves an empty string for the control instructions when no control agent exists', async () => {
    vi.mocked(getGoldenSetPointer).mockResolvedValue(pointer());
    const client = stubClient({
      cases: [{ position: 0, input: 'x', metadata: {} }],
      control: null,
    });

    const view = await getGoldenSetAdminView(client);

    expect(view.controlInstructions).toBe('');
  });
});
