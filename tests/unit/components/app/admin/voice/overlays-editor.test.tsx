// @vitest-environment happy-dom

/**
 * The register overlays editor on the Voice page (f-content-seeds t-92).
 *
 * What the admin sees — each overlay's sign-off status, what selects it before
 * a delete — and what the browser sends. What the service decides is its own
 * test (`tests/unit/lib/app/voice/overlays-admin.test.ts`).
 *
 * @see components/app/admin/voice/overlays-editor.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { OverlaysEditor } from '@/components/app/admin/voice/overlays-editor';
import {
  VOICE_OVERLAYS_FILE_ENDPOINTS,
  VOICE_OVERLAY_SITUATIONS_ENDPOINT,
  voiceOverlayEndpoint,
} from '@/lib/app/voice/endpoint';
import { createMockRouter } from '@/tests/types/mocks';
import type { OverlayAdminRow, OverlaysAdminView } from '@/lib/app/voice/overlays-admin';

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

function overlay(over: Partial<OverlayAdminRow> = {}): OverlayAdminRow {
  return {
    situation: 'values',
    position: 1,
    label: 'Values',
    when: 'When values come up.',
    heading: 'Register for this moment — values',
    lines: ['A value is a word someone has lived.'],
    exemplarQuery: 'values, living them',
    status: 'draft',
    signedOffAt: null,
    revision: 3,
    selectedBy: ['the admin chat, when it is asked for this situation'],
    ...over,
  };
}

function view(overlays: OverlayAdminRow[]): OverlaysAdminView {
  return {
    seeded: true,
    unservable: null,
    set: {
      id: 'lelanea_voice_fingerprint_overlays',
      title: 'Overlays',
      version: '1.0',
      locale: 'en-US',
      provenance: { status: 'drafted_from_corpus', awaitingSignOffFrom: 'x', note: 'y' },
      exemplars: {
        heading: 'Examples',
        originLabel: 'Her writing',
        lines: ['Register only.'],
        noneFoundNote: 'None found.',
        unavailableNote: 'Unavailable.',
      },
      coreOnly: { heading: 'Register', lines: ['Plain.'] },
      status: 'draft',
      signedOffAt: null,
      revision: 1,
    },
    overlays,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue(ok({ changed: ['status'] }));
});

describe('status', () => {
  it('shows a signed-off overlay as signed off, and a draft as awaiting sign-off', () => {
    render(
      <OverlaysEditor
        initialView={view([
          overlay({
            situation: 'values',
            label: 'Values',
            status: 'signed_off',
            signedOffAt: new Date('2026-09-20'),
          }),
          overlay({ situation: 'difficulty', label: 'Difficulty', status: 'draft' }),
        ])}
      />
    );

    const [values, difficulty] = screen.getAllByRole('listitem');
    expect(within(values).getByText('Signed off')).toBeInTheDocument();
    expect(within(values).queryByRole('button', { name: 'Sign off' })).toBeNull();
    expect(within(difficulty).getByText(/awaiting sign-off/)).toBeInTheDocument();
  });

  it('signs a draft off at the revision it shows', async () => {
    render(<OverlaysEditor initialView={view([overlay({ situation: 'values', revision: 3 })])} />);

    const row = screen.getAllByRole('listitem')[0];
    await userEvent.click(within(row).getByRole('button', { name: 'Sign off' }));

    expect(sent()).toEqual({
      url: `${voiceOverlayEndpoint('values')}/sign-off`,
      method: 'POST',
      body: { revision: 3 },
    });
    expect(mockRouter.refresh).toHaveBeenCalled();
  });
});

describe('deleting', () => {
  it('names what selects the situation before deleting it, and sends the revision read', async () => {
    const selectedBy = [
      'the onboarding seat, on every turn a person takes there',
      'the admin chat, when it is asked for this situation',
    ];
    render(
      <OverlaysEditor
        initialView={view([
          overlay({ situation: 'first-meeting', label: 'First meeting', revision: 2, selectedBy }),
        ])}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /Delete/ }));

    const dialog = screen.getByRole('dialog');
    for (const selector of selectedBy)
      expect(within(dialog).getByText(selector)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(sent()).toMatchObject({
      url: `${voiceOverlayEndpoint('first-meeting')}?revision=2`,
      method: 'DELETE',
    });
  });
});

describe('editing and adding', () => {
  it('sends one line per beat, dropping blank lines', async () => {
    render(<OverlaysEditor initialView={view([overlay({ revision: 4 })])} />);

    await userEvent.click(
      within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Edit' })
    );
    const lines = screen.getByLabelText('Lines');
    await userEvent.clear(lines);
    await userEvent.type(lines, 'First beat{enter}{enter}Second beat');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(sent()).toMatchObject({
      url: voiceOverlayEndpoint('values'),
      method: 'PUT',
      body: { lines: ['First beat', 'Second beat'], revision: 4 },
    });
  });

  it('adds a situation under the key typed', async () => {
    render(<OverlaysEditor initialView={view([overlay()])} />);
    fetchMock.mockResolvedValue(ok({ situation: 'grief', position: 2 }));

    await userEvent.click(screen.getByRole('button', { name: /Add a situation/ }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Situation key'), 'grief');
    await userEvent.type(within(dialog).getByLabelText('Label'), 'Grief');
    await userEvent.type(within(dialog).getByLabelText('When it applies'), 'After a loss.');
    await userEvent.type(within(dialog).getByLabelText('Heading'), 'Grief');
    await userEvent.type(within(dialog).getByLabelText('Lines'), 'Stay.');
    await userEvent.type(within(dialog).getByLabelText('Exemplar search'), 'loss');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add' }));

    expect(sent()).toMatchObject({
      url: VOICE_OVERLAY_SITUATIONS_ENDPOINT,
      method: 'POST',
      body: { situation: 'grief', label: 'Grief', lines: ['Stay.'] },
    });
  });
});

describe('the file', () => {
  it('previews an import without removal unless the box is ticked', async () => {
    render(<OverlaysEditor initialView={view([overlay()])} />);
    fetchMock.mockResolvedValue(
      ok({
        plan: { collection: 'voice overlays', sections: [], refusals: [], writesNothing: true },
      })
    );
    const file = new File(['{"fingerprint":{}}'], 'overlays.json', { type: 'application/json' });

    await userEvent.upload(screen.getByLabelText('Choose a file to import'), file);
    await userEvent.click(screen.getByRole('button', { name: /Preview import/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Also remove/ }));
    await userEvent.click(screen.getByRole('button', { name: /Preview import/ }));

    expect(sent(0)).toMatchObject({
      url: VOICE_OVERLAYS_FILE_ENDPOINTS.preview,
      body: { removeAbsent: false },
    });
    expect(sent(1)).toMatchObject({ body: { removeAbsent: true } });
  });
});
