// @vitest-environment happy-dom

/**
 * The leaning bounds editor on the Voice page (f-leanings t-138).
 *
 * What the admin reads of the bounds, what the controls let them express, and
 * what the browser sends. What a save does to the stored set and to every
 * reader of it is `tests/unit/lib/app/voice/leaning-bounds-admin.test.ts`.
 *
 * @see components/app/admin/voice/leaning-bounds-editor.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  LeaningBoundsEditor,
  LeaningBoundsSummary,
} from '@/components/app/admin/voice/leaning-bounds-editor';
import { VOICE_OVERLAY_LEANINGS_ENDPOINT } from '@/lib/app/voice/endpoint';
import { readVoiceOverlaysFile } from '@/lib/app/content/seed-input/voice-overlay-seed';
import type { LeaningBounds } from '@/lib/app/voice/leanings';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sentBody(): { leanings: LeaningBounds; revision: number } {
  const call = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
  expect(call[0]).toBe(VOICE_OVERLAY_LEANINGS_ENDPOINT);
  expect(call[1].method).toBe('PUT');
  return JSON.parse(call[1].body) as { leanings: LeaningBounds; revision: number };
}

const drafted = (): LeaningBounds => readVoiceOverlaysFile().leanings!;

async function openEditor(bounds = drafted(), onDone = vi.fn()) {
  render(<LeaningBoundsEditor bounds={bounds} revision={7} onDone={onDone} />);
  await userEvent.click(screen.getByRole('button', { name: 'Edit leaning bounds' }));
  return onDone;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('the summary', () => {
  it('names a locked dial, a narrowed one, and one the AI may not suggest', () => {
    const bounds = drafted();
    render(
      <LeaningBoundsSummary
        bounds={{
          ...bounds,
          dials: {
            ...bounds.dials,
            devotion: { min: 0, max: 0, suggest: true },
            questions: { min: -2, max: 1, suggest: true },
            length: { min: -2, max: 2, suggest: false },
          },
        }}
      />
    );

    expect(
      screen.getByText(/Spiritual and devotional ↔ Secular and plain/).parentElement
    ).toHaveTextContent(/: locked$/);
    expect(screen.getByText(/Question-led ↔ Guidance-led/).parentElement).toHaveTextContent(
      'up to strongly toward Question-led; up to one stop toward Guidance-led'
    );
    expect(
      screen.getByText(/Verbose and exploratory ↔ Concise and spare/).parentElement
    ).toHaveTextContent('not suggested');
  });

  it('says when suggestions are off for every dial', () => {
    render(<LeaningBoundsSummary bounds={{ ...drafted(), suggest: false }} />);

    expect(screen.getByText('no, for every dial')).toBeInTheDocument();
  });
});

describe('editing', () => {
  it('sends every dial, with the one changed, at the revision read', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { success: true, data: { changed: ['leanings'], revision: 8 } })
    );
    const onDone = await openEditor();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'How far toward Energetic' }),
      'One stop'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const body = sentBody();
    expect(body.revision).toBe(7);
    expect(body.leanings).toEqual({
      ...drafted(),
      dials: { ...drafted().dials, pace: { min: -1, max: 2, suggest: true } },
    });
    expect(onDone).toHaveBeenCalledWith(expect.stringContaining('Saved the leaning bounds'));
  });

  it('locks a dial when neither way is allowed, and its suggestion switch goes with it', async () => {
    await openEditor();
    const suggest = screen.getByRole('switch', {
      name: 'The AI may suggest moving Story and metaphor ↔ Literal',
    });
    expect(suggest).toBeEnabled();

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'How far toward Story and metaphor' }),
      'Not at all'
    );
    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'How far toward Literal' }),
      'Not at all'
    );

    expect(screen.getByText('Locked at rest')).toBeInTheDocument();
    expect(suggest).toBeDisabled();
  });

  it('offers no position that would hold a dial away from rest', async () => {
    await openEditor();

    const options = screen
      .getAllByRole('combobox')
      .flatMap((select) => Array.from((select as HTMLSelectElement).options).map((o) => o.value));
    // Every choice is a reach toward one pole, rest included as "not at all".
    expect(new Set(options)).toEqual(new Set(['2', '1', '0']));
  });

  it('turning suggestions off for all dials disables each dial’s switch, and is sent', async () => {
    fetchMock.mockResolvedValue(
      reply(200, { success: true, data: { changed: ['leanings'], revision: 8 } })
    );
    await openEditor();

    await userEvent.click(screen.getByRole('switch', { name: 'The AI may suggest changes' }));

    for (const dial of screen.getAllByRole('switch', { name: /^The AI may suggest moving / })) {
      expect(dial).toBeDisabled();
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(sentBody().leanings.suggest).toBe(false);
  });

  it('shows the refusal and stays open when the save is refused', async () => {
    fetchMock.mockResolvedValue(
      reply(409, {
        success: false,
        error: { code: 'CONFLICT', message: 'The overlay set was changed by someone else.' },
      })
    );
    const onDone = await openEditor();

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('The overlay set was changed by someone else.')
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });
});
