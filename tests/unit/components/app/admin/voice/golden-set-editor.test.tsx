// @vitest-environment happy-dom

/**
 * The golden set editor on the Voice page (f-content-seeds t-92).
 *
 * A version that has been run says why it is locked before anyone tries to
 * edit it, and offers the way on; an open one sends the hash it read with
 * every save. What the editor refuses is the service's test.
 *
 * @see components/app/admin/voice/golden-set-editor.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GoldenSetEditor } from '@/components/app/admin/voice/golden-set-editor';
import { GOLDEN_SET_VERSIONS_ENDPOINT, goldenPromptEndpoint } from '@/lib/app/voice/endpoint';
import { createMockRouter } from '@/tests/types/mocks';
import type { GoldenSetEditorView } from '@/lib/app/voice/golden-set-editor';

const mockRouter = createMockRouter();
vi.mock('next/navigation', () => ({ useRouter: () => mockRouter }));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sent(index = 0) {
  const call = fetchMock.mock.calls[index] as [string, RequestInit & { body?: string }];
  return {
    url: call[0],
    method: call[1].method,
    body: call[1].body === undefined ? undefined : (JSON.parse(call[1].body) as unknown),
  };
}

const HASH = 'a'.repeat(64);

function view(over: Partial<GoldenSetEditorView> = {}): GoldenSetEditorView {
  return {
    seeded: true,
    pointer: {
      title: 'The golden set',
      version: '1.1',
      locale: 'en-US',
      provenance: { status: 'drafted_from_corpus', awaitingSignOffFrom: 'x', note: 'y' },
      status: 'draft',
      revision: 2,
    },
    datasetId: 'lelanea-voice-golden-set-v1.1',
    contentHash: HASH,
    runCount: 0,
    frozen: false,
    prompts: [
      {
        key: 'first-hello',
        kind: 'greeting',
        probe: 'The opening register.',
        prompt: 'Hi. I just got here.',
      },
    ],
    malformed: [],
    nextVersion: '1.2',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(ok({ changed: ['probe'] }));
});

describe('a version that has been run', () => {
  it('says why it is locked, offers no edit, and names the next version', () => {
    render(<GoldenSetEditor initialView={view({ frozen: true, runCount: 3 })} />);

    expect(screen.getByText(/has been run 3 times, so its prompts are locked/)).toBeInTheDocument();
    expect(
      screen.getByText(/only readable beside the question that produced it/)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add a prompt/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start v1.2' })).toBeInTheDocument();
  });

  it('starts the next version at the pointer revision it read', async () => {
    fetchMock.mockResolvedValue(ok({ from: '1.1', to: '1.2' }));
    render(<GoldenSetEditor initialView={view({ frozen: true, runCount: 1 })} />);

    await userEvent.click(screen.getByRole('button', { name: 'Start v1.2' }));

    expect(sent()).toEqual({
      url: GOLDEN_SET_VERSIONS_ENDPOINT,
      method: 'POST',
      body: { revision: 2 },
    });
    expect(mockRouter.refresh).toHaveBeenCalled();
  });
});

describe('a version nothing has run', () => {
  it('saves a prompt with the hash it read', async () => {
    render(<GoldenSetEditor initialView={view()} />);

    await userEvent.click(
      within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Edit' })
    );
    const probe = screen.getByLabelText('What it tests');
    await userEvent.clear(probe);
    await userEvent.type(probe, 'Whether it sounds like a person.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent()).toEqual({
      url: goldenPromptEndpoint('first-hello'),
      method: 'PUT',
      body: {
        kind: 'greeting',
        probe: 'Whether it sounds like a person.',
        prompt: 'Hi. I just got here.',
        contentHash: HASH,
      },
    });
  });
});
