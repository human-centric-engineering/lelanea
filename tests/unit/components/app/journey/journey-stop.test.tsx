// @vitest-environment happy-dom

/**
 * One stop on the thread: a draft's keep/change/ask/discard, a kept own
 * entry's edit/withhold/remove, and the "What's next" signpost
 * (f-journey-record t-148, over t-147's keep route).
 *
 * The record's own routes are NOT mocked: `lib/app/journey-record/client.ts`
 * runs for real against a stubbed global `fetch`, so what is proven is the
 * exact request each control sends — method, path, and body — rather than
 * that a client function was called with some arguments.
 *
 * @see components/app/journey/journey-stop.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockRouter } from '@/tests/types/mocks';

const router = createMockRouter();
vi.mock('next/navigation', () => ({
  usePathname: () => '/app/journey',
  useRouter: () => router,
}));

import {
  SESSION_DELETE_ACCOUNT,
  SESSION_DELETE_CONFIRM,
  SESSION_DELETE_DRAFT,
} from '@/components/app/journey/delete-session';
import { JourneyStop, NextStop, stopLine } from '@/components/app/journey/journey-stop';
import type { JourneyEntry, JourneyListedNote } from '@/lib/app/journey-record/entry';
import type { JourneySignpost } from '@/lib/app/journey/next';

function entry(overrides: Partial<JourneyEntry> = {}): JourneyEntry {
  return {
    id: 'cmentry00000000000000000001',
    kind: 'synopsis',
    state: 'kept',
    summary: 'A session about boundaries',
    body: 'We talked about saying no at work.',
    outcomes: [],
    modules: [],
    notes: [],
    withheldFromAgent: false,
    regenerationsLeft: null,
    sourceRemoved: false,
    notesPending: false,
    occurredAt: '2026-10-01T09:00:00.000Z',
    keptAt: '2026-10-01T09:05:00.000Z',
    updatedAt: '2026-10-01T09:05:00.000Z',
    session: null,
    ...overrides,
  };
}

interface Call {
  path: string;
  method: string;
  body: unknown;
}

const world = {
  calls: [] as Call[],
  /** Set to park the next response as a specific status/body; cleared after one use. */
  nextResponse: null as Response | null,
};

// The client under test always calls `fetch` with a string path, never a
// `URL` or a `Request` — narrowing the stub's signature to match is what
// makes `path` safe to record directly.
const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
  world.calls.push({
    path,
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  });
  if (world.nextResponse) {
    const response = world.nextResponse;
    world.nextResponse = null;
    return response;
  }
  return new Response(null, { status: 200 });
});

function refusal(status: number, code: string, message: string, details?: unknown): Response {
  return new Response(JSON.stringify({ success: false, error: { code, message, details } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  world.calls = [];
  world.nextResponse = null;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('stopLine', () => {
  it('shows the summary when there is one', () => {
    expect(stopLine(entry({ summary: 'The shop' }))).toBe('The shop');
  });

  it('falls back to the start of the words, collapsed to one line, when there is no summary', () => {
    expect(stopLine(entry({ summary: null, body: 'Line one.\n\nLine two.' }))).toBe(
      'Line one. Line two.'
    );
  });

  it('truncates a long fallback with an ellipsis rather than running on', () => {
    const long = 'x'.repeat(150);
    const line = stopLine(entry({ summary: null, body: long }));

    expect(line.endsWith('…')).toBe(true);
    expect(line.length).toBeLessThan(long.length);
  });
});

describe('NextStop', () => {
  const signpost: JourneySignpost = {
    slug: 'boundaries',
    label: '02 · Boundaries',
    href: '/app/modules/boundaries',
    standing: 'next',
  };

  it('says where the spine goes next, as a suggestion rather than a requirement', () => {
    render(<NextStop next={signpost} open={false} onToggle={vi.fn()} />);

    expect(
      screen.getByText('02 · Boundaries comes next on the map, unless you say otherwise.')
    ).toBeTruthy();
  });

  it('says the person is in the module when they are standing in it', () => {
    render(<NextStop next={{ ...signpost, standing: 'current' }} open onToggle={vi.fn()} />);

    expect(screen.getByText('You are in 02 · Boundaries.')).toBeTruthy();
  });

  it('opens and closes on its own toggle, and links to the module', async () => {
    const onToggle = vi.fn();
    render(<NextStop next={signpost} open={false} onToggle={onToggle} />);

    expect(screen.queryByRole('link', { name: '02 · Boundaries' })).toBeNull();
    const head = screen.getByRole('button', { expanded: false });
    expect(head.textContent).toContain('What’s next');

    await userEvent.click(head);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe('a draft synopsis', () => {
  const notesPanel: JourneyListedNote[] = [
    {
      slotSlug: 'life_work',
      label: 'life work',
      reading: 'Work is going badly.',
      version: 1,
      confirmable: true,
    },
    {
      slotSlug: 'life_money',
      label: 'life money',
      reading: 'Money is tight.',
      version: 2,
      confirmable: true,
    },
  ];

  function draft(overrides: Partial<JourneyEntry> = {}): JourneyEntry {
    return entry({
      state: 'draft',
      keptAt: null,
      regenerationsLeft: 3,
      notes: [
        { slotSlug: 'life_work', version: 1 },
        { slotSlug: 'life_money', version: 2 },
      ],
      ...overrides,
    });
  }

  function renderDraft(overrides: Partial<JourneyEntry> = {}) {
    return render(
      <JourneyStop
        entry={draft(overrides)}
        notes={notesPanel}
        moduleLabels={{}}
        thread="dashed"
        open
        onToggle={vi.fn()}
      />
    );
  }

  it('shows the "waiting for you" pill and nothing about any module when none was opened', () => {
    renderDraft();

    expect(screen.getByText('waiting for you')).toBeTruthy();
    expect(screen.getByText('No module was opened in this session.')).toBeTruthy();
  });

  it('keeps as written: POSTs seen and every usable listed note, all ticked by default', async () => {
    const e = draft();
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));

    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/v1/app/journey-record/${e.id}/keep`,
      body: {
        seen: e.updatedAt,
        confirm: [
          { slotSlug: 'life_work', version: 1 },
          { slotSlug: 'life_money', version: 2 },
        ],
      },
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('drops an unticked note from confirm, and keeps the other one', async () => {
    renderDraft();

    const boxes = screen.getAllByRole('checkbox');
    await userEvent.click(boxes[1]); // untick "life money"
    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));

    expect(world.calls[0]?.body).toMatchObject({
      confirm: [{ slotSlug: 'life_work', version: 1 }],
    });
  });

  it('ticks the notes afresh once keeping has moved them on, so a later change still confirms them', async () => {
    const e = draft();
    const view = renderDraft();
    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));

    // The refresh: kept, and each note now at the version keeping wrote.
    const kept = entry({
      id: e.id,
      updatedAt: '2026-10-01T10:00:00.000Z',
      notes: [
        { slotSlug: 'life_work', version: 2 },
        { slotSlug: 'life_money', version: 3 },
      ],
    });
    view.rerender(
      <JourneyStop
        entry={kept}
        notes={notesPanel.map((note) => ({ ...note, version: note.version + 1 }))}
        moduleLabels={{}}
        thread="dashed"
        open
        onToggle={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Change this account' }));
    await userEvent.click(screen.getByRole('button', { name: 'Keep this change' }));

    expect(world.calls[1]?.body).toMatchObject({
      seen: kept.updatedAt,
      confirm: [
        { slotSlug: 'life_work', version: 2 },
        { slotSlug: 'life_money', version: 3 },
      ],
    });
  });

  it('keeps a change started before the draft moved on, but will not keep it over the newer one', async () => {
    const view = renderDraft();
    await userEvent.click(screen.getByRole('button', { name: 'Change it' }));
    const body = screen.getByLabelText('What happened');
    await userEvent.clear(body);
    await userEvent.type(body, 'My careful rewrite.');

    // Redrafted in another tab; the page refreshes underneath the open editor.
    view.rerender(
      <JourneyStop
        entry={draft({ body: 'A newer draft.', updatedAt: '2026-10-01T11:00:00.000Z' })}
        notes={notesPanel}
        moduleLabels={{}}
        thread="dashed"
        open
        onToggle={vi.fn()}
      />
    );

    // The person's words are still there to copy, and cannot be kept over the redraft.
    expect(screen.getByLabelText('What happened')).toHaveProperty('value', 'My careful rewrite.');
    expect(screen.getByText(/changed since you started/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep my version' })).toHaveProperty(
      'disabled',
      true
    );
    expect(world.calls).toHaveLength(0);

    // Cancel shows the version that is there now.
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('A newer draft.')).toBeTruthy();
  });

  it('refreshes when the entry is gone (404), so a dead stop does not stay live', async () => {
    world.nextResponse = refusal(404, 'NOT_FOUND', 'Entry not found');
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));

    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('changes it, then keeps the edited version with its outcomes', async () => {
    const e = draft();
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Change it' }));
    const summaryBox = screen.getByLabelText('In a line');
    await userEvent.clear(summaryBox);
    await userEvent.type(summaryBox, 'A new line');
    await userEvent.click(screen.getByRole('button', { name: 'Keep my version' }));

    expect(world.calls).toHaveLength(1);
    expect(world.calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/v1/app/journey-record/${e.id}/keep`,
    });
    const body = world.calls[0]?.body as { seen: string; confirm: unknown[]; edit: unknown };
    expect(body.edit).toMatchObject({ summary: 'A new line', body: e.body, outcomes: [] });
    // Still ticked by default — editing first does not drop the notes.
    expect(body.confirm).toHaveLength(2);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('asks for another draft, sending what was said should be different', async () => {
    const e = draft();
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Ask for another' }));
    await userEvent.type(screen.getByLabelText(/What should be different/), 'Shorter, please.');
    await userEvent.click(screen.getByRole('button', { name: 'Ask for another' }));

    expect(world.calls).toEqual([
      {
        method: 'POST',
        path: `/api/v1/app/journey-record/${e.id}/regenerate`,
        body: { steer: 'Shorter, please.' },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('discards in two steps: Discard asks to confirm, Cancel backs out without a call', async () => {
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(
      screen.getByText('Discard this draft? This session will not be drafted again.')
    ).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(world.calls).toEqual([]);
    expect(screen.getByRole('button', { name: 'Discard' })).toBeTruthy();
  });

  it('discards for real on the second Discard, which DELETEs the entry', async () => {
    const e = draft();
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }));

    expect(world.calls).toEqual([
      { method: 'DELETE', path: `/api/v1/app/journey-record/${e.id}`, body: undefined },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the friendly message for a 409 changed_meanwhile, and still refreshes', async () => {
    world.nextResponse = refusal(409, 'CONFLICT', 'Conflict.', { reason: 'changed_meanwhile' });
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/now shows the latest version/);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows a plain refusal’s message without refreshing', async () => {
    world.nextResponse = refusal(400, 'VALIDATION_ERROR', 'That did not make sense.');
    renderDraft();

    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('That did not make sense.');
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe('a kept synopsis', () => {
  const listed: JourneyListedNote[] = [
    {
      slotSlug: 'life_work',
      label: 'life work',
      reading: 'Better.',
      version: 2,
      confirmable: true,
    },
  ];
  function renderKept(overrides: Partial<JourneyEntry> = {}) {
    return render(
      <JourneyStop
        entry={entry({ notes: [{ slotSlug: 'life_work', version: 2 }], ...overrides })}
        notes={listed}
        moduleLabels={{}}
        thread="none"
        open
        onToggle={vi.fn()}
      />
    );
  }

  it('says when its notes are still owed, and finishes them with a keep that changes nothing', async () => {
    const kept = entry({ notes: [{ slotSlug: 'life_work', version: 2 }], notesPending: true });
    renderKept({ notesPending: true });

    expect(screen.getByText(/has not yet confirmed the notes listed with it/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Try the notes again' }));

    expect(world.calls[0]).toMatchObject({
      method: 'POST',
      path: `/api/v1/app/journey-record/${kept.id}/keep`,
      body: { seen: kept.updatedAt, confirm: [{ slotSlug: 'life_work', version: 2 }] },
    });
    expect(world.calls[0]?.body).not.toHaveProperty('edit');
  });

  it('says nothing about owed notes when none are owed', () => {
    renderKept();
    expect(screen.queryByText(/has not yet confirmed/)).toBeNull();
  });

  it('lists its notes as kept with it, not as confirmed, and says when one has changed since', () => {
    render(
      <JourneyStop
        entry={entry({
          notes: [
            { slotSlug: 'life_work', version: 2 },
            { slotSlug: 'life_money', version: 3 },
          ],
        })}
        notes={[
          {
            slotSlug: 'life_work',
            label: 'life work',
            reading: 'Better.',
            version: 2,
            confirmable: true,
          },
          {
            slotSlug: 'life_money',
            label: 'life money',
            reading: 'Newer.',
            version: 4,
            confirmable: true,
          },
        ]}
        moduleLabels={{}}
        thread="none"
        open
        onToggle={vi.fn()}
      />
    );

    expect(screen.getByText('Notes kept with this account')).toBeTruthy();
    expect(screen.queryByText(/confirmed/i)).toBeNull();
    expect(screen.getByText(/Newer\. This note has changed since\./)).toBeTruthy();
    expect(screen.getByText('Better.')).toBeTruthy();
  });
});

describe('a kept own entry', () => {
  function own(overrides: Partial<JourneyEntry> = {}): JourneyEntry {
    return entry({
      kind: 'own',
      summary: null,
      body: 'Woke at three again.',
      withheldFromAgent: false,
      ...overrides,
    });
  }

  function renderOwn(overrides: Partial<JourneyEntry> = {}) {
    return render(
      <JourneyStop
        entry={own(overrides)}
        notes={[]}
        moduleLabels={{}}
        thread="solid"
        open
        onToggle={vi.fn()}
      />
    );
  }

  it('says Lelañea can read it when it is not withheld', () => {
    renderOwn();
    expect(screen.getByText(/Lelañea can read this/)).toBeTruthy();
  });

  it('edits the words, which PATCHes only what the form sends', async () => {
    const e = own();
    renderOwn();

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const body = screen.getByLabelText('Your words');
    await userEvent.clear(body);
    await userEvent.type(body, 'Woke at four this time.');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(world.calls).toEqual([
      {
        method: 'PATCH',
        path: `/api/v1/app/journey-record/${e.id}`,
        body: { summary: '', body: 'Woke at four this time.', withheldFromAgent: false },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps it from Lelañea with one click — no confirm step for a toggle', async () => {
    const e = own();
    renderOwn();

    await userEvent.click(screen.getByRole('button', { name: 'Keep this from Lelañea' }));

    expect(world.calls).toEqual([
      {
        method: 'PATCH',
        path: `/api/v1/app/journey-record/${e.id}`,
        body: { withheldFromAgent: true },
      },
    ]);
  });

  it('offers to let Lelañea read it again once it is withheld', () => {
    renderOwn({ withheldFromAgent: true });

    expect(screen.getByText(/it never reads this entry/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Let Lelañea read this' })).toBeTruthy();
  });

  it('removes in two steps, and DELETEs only after the second click', async () => {
    const e = own();
    renderOwn();

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByText('Remove this from your journey? Its words go with it.')).toBeTruthy();
    expect(world.calls).toEqual([]);

    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(world.calls).toEqual([
      { method: 'DELETE', path: `/api/v1/app/journey-record/${e.id}`, body: undefined },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('deleting a session (t-154)', () => {
  const SESSION_ID = `ses_${'a'.repeat(32)}`;
  const withTurns = {
    id: SESSION_ID,
    ordinal: 3,
    startedAt: '2026-10-01T09:00:00.000Z',
    closedAt: '2026-10-01T21:00:00.000Z',
    hasTurns: true,
  };

  function renderStop(overrides: Partial<JourneyEntry>) {
    return render(
      <JourneyStop
        entry={entry({ session: withTurns, ...overrides })}
        notes={[]}
        moduleLabels={{}}
        thread="none"
        open
        onToggle={vi.fn()}
      />
    );
  }

  const offer = () => screen.queryByRole('button', { name: 'Delete this session' });

  it('is offered on a kept synopsis and on a draft whose session still has turns', () => {
    const kept = renderStop({});
    expect(offer()).toBeTruthy();
    kept.unmount();

    renderStop({ state: 'draft', keptAt: null, regenerationsLeft: 3 });
    expect(offer()).toBeTruthy();
  });

  it('is not offered on a session with no turns left, one with no session, or an own entry', () => {
    const empty = renderStop({ session: { ...withTurns, hasTurns: false } });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(offer()).toBeNull();
    empty.unmount();

    const unread = renderStop({ session: null });
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(offer()).toBeNull();
    unread.unmount();

    renderStop({ kind: 'own', summary: null, body: 'My own words.' });
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
    expect(offer()).toBeNull();
  });

  it('asks first, says what goes, and Cancel backs out without a call', async () => {
    renderStop({});

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));
    const group = screen.getByRole('group', { name: 'Delete this session?' });
    expect(group.textContent).toContain(SESSION_DELETE_CONFIRM);
    expect(world.calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Delete this session?' })).toBeNull();
    expect(world.calls).toHaveLength(0);
  });

  it('ticks the kept account by default, and sends removeAccount true', async () => {
    renderStop({});

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));
    const tick = screen.getByRole('checkbox', { name: SESSION_DELETE_ACCOUNT });
    expect((tick as HTMLInputElement).checked).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));

    expect(world.calls).toEqual([
      {
        path: `/api/v1/app/sessions/${SESSION_ID}`,
        method: 'DELETE',
        body: { removeAccount: true },
      },
    ]);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('sends removeAccount false when the person unticks it', async () => {
    renderStop({});

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));
    await userEvent.click(screen.getByRole('checkbox', { name: SESSION_DELETE_ACCOUNT }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));

    expect(world.calls).toEqual([
      {
        path: `/api/v1/app/sessions/${SESSION_ID}`,
        method: 'DELETE',
        body: { removeAccount: false },
      },
    ]);
  });

  it('shows no tick on a draft, says the draft goes, and sends removeAccount true', async () => {
    renderStop({ state: 'draft', keptAt: null, regenerationsLeft: 3 });

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));
    expect(screen.queryByRole('checkbox', { name: SESSION_DELETE_ACCOUNT })).toBeNull();
    expect(screen.getByRole('group', { name: 'Delete this session?' }).textContent).toContain(
      SESSION_DELETE_DRAFT
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));
    expect(world.calls).toEqual([
      {
        path: `/api/v1/app/sessions/${SESSION_ID}`,
        method: 'DELETE',
        body: { removeAccount: true },
      },
    ]);
  });

  it('does not show an earlier refusal of another control as the delete’s', async () => {
    world.nextResponse = refusal(409, 'CONFLICT', 'Conflict.', { reason: 'changed_meanwhile' });
    renderStop({ state: 'draft', keptAt: null, regenerationsLeft: 3 });

    // A keep is refused first, and says so under the stop.
    await userEvent.click(screen.getByRole('button', { name: 'Keep this' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/latest version/);

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));

    expect(screen.getByRole('group', { name: 'Delete this session?' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(world.calls.map((call) => call.method)).toEqual(['POST']);
  });

  it('says to wait for the reply on a 409, deletes nothing more, and keeps the choice open', async () => {
    world.nextResponse = refusal(
      409,
      'CONFLICT',
      'Lelañea is still answering that. Try again in a moment, once the reply has finished.',
      { reason: 'still_answering' }
    );
    renderStop({});

    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete this session' }));

    const alerts = await screen.findAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toBe(
      'Not deleted. Lelañea is still answering in this session. Try again once the reply has finished.'
    );
    expect(world.calls).toHaveLength(1);
    expect(router.refresh).not.toHaveBeenCalled();
    // Still asking, so trying again is one click.
    expect(screen.getByRole('group', { name: 'Delete this session?' })).toBeTruthy();
  });
});

describe('copy', () => {
  it('never says a module "closed" — sessions close, modules do not (§6.12)', () => {
    const { container } = render(
      <JourneyStop
        entry={entry({ modules: ['values', 'boundaries'] })}
        notes={[]}
        moduleLabels={{ values: '01 · Values' }}
        thread="solid"
        open
        onToggle={vi.fn()}
      />
    );

    expect(container.textContent).not.toMatch(/module closed/i);
  });
});
