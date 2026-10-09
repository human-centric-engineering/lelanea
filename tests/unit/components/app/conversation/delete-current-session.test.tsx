// @vitest-environment happy-dom

/**
 * The conversation pane's offer to delete the session the person is in
 * (f-forget-session t-158).
 *
 * The client (`fetchCurrentSession`, `deleteSession`) runs for real against a
 * stubbed global `fetch` holding a small stateful session, so what is proven
 * is the exact request the confirmation sends and that the offer follows what
 * the server says, not that a function was called.
 *
 * @see components/app/conversation/delete-current-session.tsx
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMockRouter } from '@/tests/types/mocks';

const router = createMockRouter();
vi.mock('next/navigation', () => ({
  usePathname: () => '/app',
  useRouter: () => router,
}));

import {
  CURRENT_SESSION_DELETED,
  CurrentSessionConfirm,
  CurrentSessionMenu,
  useCurrentSessionOffer,
} from '@/components/app/conversation/delete-current-session';
import { SESSION_DELETE_CONFIRM } from '@/components/app/journey/delete-session';

const SESSION = `ses_${'a'.repeat(32)}`;
const NEXT_SESSION = `ses_${'b'.repeat(32)}`;

interface Call {
  path: string;
  method: string;
  body: unknown;
}

const world = {
  calls: [] as Call[],
  /** What the current-session read answers. */
  session: { id: SESSION, hasTurns: true } as { id: string; hasTurns: boolean } | null,
  /** Set to refuse the next delete; cleared after one use. */
  refuseDelete: null as Response | null,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn(async (path: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
  world.calls.push({ path, method, body });
  if (method === 'GET') return json({ success: true, data: { session: world.session } });
  if (world.refuseDelete) {
    const response = world.refuseDelete;
    world.refuseDelete = null;
    return response;
  }
  // The session carries on, emptied (t-153).
  if (world.session) world.session = { ...world.session, hasTurns: false };
  return json({ success: true, data: { exchanges: 2, messages: 5, account: 'none' } });
});

function refusal(status: number, code: string, message: string, details?: unknown): Response {
  return json({ success: false, error: { code, message, details } }, status);
}

interface HarnessProps {
  turnsSettled?: number;
  turnRunning?: boolean;
  personSpoke?: boolean;
  onDeleted?: () => void;
}

function Harness({
  turnsSettled = 0,
  turnRunning = false,
  personSpoke = false,
  onDeleted = () => {},
}: HarnessProps) {
  const offer = useCurrentSessionOffer({ turnsSettled, turnRunning, personSpoke, onDeleted });
  return (
    <>
      <CurrentSessionMenu offer={offer} />
      <CurrentSessionConfirm offer={offer} />
    </>
  );
}

const trigger = () => screen.queryByRole('button', { name: 'Conversation options' });
const group = () => screen.queryByRole('group', { name: 'Delete this session?' });
const deletes = () => world.calls.filter((call) => call.method === 'DELETE');

async function openConfirm(ui: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(trigger()).toBeTruthy());
  await ui.click(trigger()!);
  await ui.click(await screen.findByRole('menuitem', { name: 'Delete this session' }));
}

beforeEach(() => {
  world.calls = [];
  world.session = { id: SESSION, hasTurns: true };
  world.refuseDelete = null;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the offer', () => {
  it('is made when the person has said something in the current session', async () => {
    render(<Harness />);

    await waitFor(() => expect(trigger()).toBeTruthy());
    expect(world.calls[0]).toMatchObject({ path: '/api/v1/app/sessions/current', method: 'GET' });
  });

  it('is not made when nothing of theirs is in the session', async () => {
    world.session = { id: SESSION, hasTurns: false };
    render(<Harness />);

    await waitFor(() => expect(world.calls).toHaveLength(1));
    expect(trigger()).toBeNull();
  });

  it('is not made when there is no current session, or it could not be read', async () => {
    world.session = null;
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(world.calls).toHaveLength(1));
    expect(trigger()).toBeNull();
    unmount();

    fetchMock.mockImplementationOnce(async () => new Response('down', { status: 503 }));
    render(<Harness />);
    await waitFor(() => expect(world.calls).toHaveLength(1));
    expect(trigger()).toBeNull();
  });

  it('is withdrawn while a turn is running, since the server would refuse it', async () => {
    const { rerender } = render(<Harness />);
    await waitFor(() => expect(trigger()).toBeTruthy());

    rerender(<Harness turnRunning />);
    expect(trigger()).toBeNull();
  });

  it('reads again after every turn, so a first word in the sitting brings it', async () => {
    world.session = { id: SESSION, hasTurns: false };
    const { rerender } = render(<Harness turnsSettled={0} />);
    await waitFor(() => expect(world.calls).toHaveLength(1));
    expect(trigger()).toBeNull();

    world.session = { id: SESSION, hasTurns: true };
    rerender(<Harness turnsSettled={1} />);

    await waitFor(() => expect(trigger()).toBeTruthy());
    expect(world.calls).toHaveLength(2);
  });
});

describe('the confirmation', () => {
  it('says what goes in t-154’s words, with no account to tick', async () => {
    const ui = userEvent.setup();
    render(<Harness />);
    await openConfirm(ui);

    expect(group()).toBeTruthy();
    expect(screen.getByText(SESSION_DELETE_CONFIRM)).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(deletes()).toHaveLength(0);
  });

  it('deletes the session it read, keeping any account, then has the pane read again', async () => {
    const ui = userEvent.setup();
    const onDeleted = vi.fn();
    render(<Harness onDeleted={onDeleted} />);
    await openConfirm(ui);

    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));

    await waitFor(() => expect(screen.getByText(CURRENT_SESSION_DELETED)).toBeTruthy());
    expect(deletes()).toEqual([
      {
        path: `/api/v1/app/sessions/${SESSION}`,
        method: 'DELETE',
        body: { removeAccount: false },
      },
    ]);
    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // The read after it found the session emptied, so the offer is gone.
    expect(trigger()).toBeNull();
    expect(group()).toBeNull();
  });

  it('carries the id of whichever session is current when it is asked', async () => {
    world.session = { id: NEXT_SESSION, hasTurns: true };
    const ui = userEvent.setup();
    render(<Harness />);
    await openConfirm(ui);

    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));

    await waitFor(() => expect(deletes()).toHaveLength(1));
    expect(deletes()[0].path).toBe(`/api/v1/app/sessions/${NEXT_SESSION}`);
  });

  it('says a 409 in t-154’s words, deletes nothing, and stays open to try again', async () => {
    world.refuseDelete = refusal(409, 'CONFLICT', 'A turn is still running.', {
      reason: 'still_answering',
    });
    const ui = userEvent.setup();
    const onDeleted = vi.fn();
    render(<Harness onDeleted={onDeleted} />);
    await openConfirm(ui);

    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));

    expect(await screen.findByText('Not deleted.')).toBeTruthy();
    expect(
      screen.getByText(
        'Lelañea is still answering in this session. Try again once the reply has finished.'
      )
    ).toBeTruthy();
    expect(onDeleted).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(group()).toBeTruthy();

    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));
    await waitFor(() => expect(screen.getByText(CURRENT_SESSION_DELETED)).toBeTruthy());
    expect(deletes()).toHaveLength(2);
  });

  it('on a 404 says why and reads again, withdrawing an offer for a session no longer theirs', async () => {
    world.refuseDelete = refusal(404, 'NOT_FOUND', 'That session could not be found.');
    const ui = userEvent.setup();
    render(<Harness />);
    await openConfirm(ui);
    world.session = null;

    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));

    await waitFor(() => expect(world.calls.filter((c) => c.method === 'GET')).toHaveLength(2));
    await waitFor(() => expect(trigger()).toBeNull());
    expect(group()).toBeNull();
    expect(router.refresh).not.toHaveBeenCalled();
    // The confirm went with the offer, but why nothing was deleted is still said.
    expect(screen.getByText('Not deleted.')).toBeTruthy();
    expect(screen.getByText('That session could not be found.')).toBeTruthy();
  });

  it('retires a refusal left standing once the person speaks', async () => {
    world.refuseDelete = refusal(404, 'NOT_FOUND', 'That session could not be found.');
    const ui = userEvent.setup();
    const { rerender } = render(<Harness />);
    await openConfirm(ui);
    world.session = null;
    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));
    await waitFor(() => expect(trigger()).toBeNull());
    expect(screen.getByText('That session could not be found.')).toBeTruthy();

    act(() => {
      rerender(<Harness turnRunning personSpoke />);
    });

    expect(screen.queryByText('That session could not be found.')).toBeNull();
  });

  it('says a lost connection without claiming anything went', async () => {
    const ui = userEvent.setup();
    render(<Harness />);
    await openConfirm(ui);
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });

    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));

    expect(
      await screen.findByText('That did not go through. Check your connection and try again.')
    ).toBeTruthy();
    expect(screen.queryByText(CURRENT_SESSION_DELETED)).toBeNull();
  });

  it('cancels without deleting', async () => {
    const ui = userEvent.setup();
    render(<Harness />);
    await openConfirm(ui);

    await ui.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(group()).toBeNull();
    expect(deletes()).toHaveLength(0);
  });
});

describe('what review round 1 found', () => {
  it('closes a confirm the person walked away from, rather than bringing it back after the turn', async () => {
    const ui = userEvent.setup();
    const { rerender } = render(<Harness />);
    await openConfirm(ui);

    // They sent a turn instead of confirming.
    rerender(<Harness turnRunning />);
    expect(group()).toBeNull();
    rerender(<Harness turnsSettled={1} />);

    await waitFor(() => expect(world.calls.filter((c) => c.method === 'GET')).toHaveLength(2));
    expect(trigger()).toBeTruthy();
    expect(group()).toBeNull();
  });

  it('keeps the newest read when an older one lands after it', async () => {
    let releaseFirst!: () => void;
    const firstHeld = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    fetchMock.mockImplementationOnce(async (path: string) => {
      world.calls.push({ path, method: 'GET', body: undefined });
      await firstHeld;
      return json({ success: true, data: { session: { id: SESSION, hasTurns: false } } });
    });
    const { rerender } = render(<Harness turnsSettled={0} />);

    // The first word lands, and its read answers first.
    rerender(<Harness turnsSettled={1} />);
    await waitFor(() => expect(trigger()).toBeTruthy());

    releaseFirst();
    await act(async () => {
      await firstHeld;
    });
    expect(trigger()).toBeTruthy();
  });
});

describe('the line saying it went', () => {
  it('stays through the recap that follows, and goes when the person speaks', async () => {
    const ui = userEvent.setup();
    const { rerender } = render(<Harness />);
    await openConfirm(ui);
    await ui.click(screen.getByRole('button', { name: 'Delete this session' }));
    await waitFor(() => expect(screen.getByText(CURRENT_SESSION_DELETED)).toBeTruthy());

    // The recap the emptied session is owed runs and settles.
    rerender(<Harness turnRunning />);
    rerender(<Harness turnsSettled={1} />);
    await waitFor(() => expect(world.calls.filter((c) => c.method === 'GET')).toHaveLength(3));
    expect(screen.getByText(CURRENT_SESSION_DELETED)).toBeTruthy();

    act(() => {
      rerender(<Harness turnsSettled={1} turnRunning personSpoke />);
    });
    expect(screen.queryByText(CURRENT_SESSION_DELETED)).toBeNull();
  });
});
