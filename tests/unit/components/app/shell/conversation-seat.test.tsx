// @vitest-environment happy-dom

/**
 * Which seat the conversation pane talks to (f-onboarding t-105): the
 * onboarding seat while the discovery questions are ahead of the person, the
 * facilitator seat after.
 *
 * The pane and the questions surface are rendered together, inside the real
 * provider, because the move happens between siblings: the last question is
 * answered in the workspace, and the conversation beside it is what moves on.
 * Every request the pane makes is recorded, so the seat is read off the URLs
 * it actually called rather than off a prop.
 *
 * @see components/app/shell/use-shell-layout.tsx — `conversationSeat`
 * @see components/app/onboarding/discovery.tsx — where the move is made
 * @see lib/app/onboarding/conversation-seat.ts — the server's half
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DISCOVERY_COPY,
  Discovery,
  forgetDiscoveryPage,
} from '@/components/app/onboarding/discovery';
import { ConversationPane } from '@/components/app/shell/conversation-pane';
import { ShellLayoutProvider, useShellLayout } from '@/components/app/shell/use-shell-layout';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { setViewport } from '@/tests/unit/components/app/shell/render-shell';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post } };
});
vi.mock('next/navigation', () => ({ usePathname: () => '/app' }));
vi.mock('@/components/app/ui/use-reduced-motion', () => ({ useReducedMotion: () => true }));
vi.mock('@/components/app/ui/consent-clearance', () => ({ useConsentBannerClearance: () => 0 }));

/** Every URL the pane fetched, in order. */
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  window.localStorage.clear();
  forgetDiscoveryPage();
  post.mockResolvedValue({ version: 1 });
  setViewport('large');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      if (url.startsWith('/api/v1/app/conversation')) {
        const seat = new URL(url, 'http://x').searchParams.get('seat');
        return new Response(
          JSON.stringify({ success: true, data: { seat, conversationId: null, entries: [] } }),
          { status: 200 }
        );
      }
      if (url.startsWith('/api/v1/app/agent/status')) {
        return new Response(JSON.stringify({ success: true, data: { generation: 'available' } }));
      }
      if (url.startsWith('/api/v1/app/agent/transcribe')) {
        return new Response(JSON.stringify({ success: true, data: { voiceInput: 'off' } }));
      }
      if (url.includes('/chat/stream')) {
        return new Response('event: done\ndata: {}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    })
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const QUESTION = { id: 'q1', number: 1, text: 'What brought you here?', core: false };

function questions() {
  return (
    <Discovery
      userId="user_1"
      variant="first"
      preamble={null}
      questions={[QUESTION]}
      answers={{}}
      versions={{}}
      skipped={[]}
      partial
      moduleHref="/app/modules/onboarding"
      moduleName="Onboarding"
    />
  );
}

const transcriptReads = () => calls.filter((url) => url.startsWith('/api/v1/app/conversation'));
const turnsOn = (seat: string) => calls.filter((url) => url.includes(`/facilitation/${seat}/`));

async function sendATurn(user: ReturnType<typeof userEvent.setup>) {
  const box = screen.getByRole('textbox', { name: CONVERSATION_COPY.composerLabel });
  await user.type(box, 'hello{Enter}');
}

describe('while the discovery questions are ahead of the person', () => {
  it('reads and speaks to the onboarding seat', async () => {
    const user = userEvent.setup();
    render(
      <ShellLayoutProvider conversationSeat="onboarding">
        <ConversationPane />
      </ShellLayoutProvider>
    );
    await waitFor(() =>
      expect(transcriptReads()).toEqual(['/api/v1/app/conversation?seat=onboarding'])
    );

    await sendATurn(user);

    await waitFor(() => expect(turnsOn('onboarding')).toHaveLength(1));
    expect(turnsOn('facilitator')).toHaveLength(0);
  });
});

describe('the last question answered', () => {
  it('moves the conversation on to the facilitator seat, without a server render', async () => {
    const user = userEvent.setup();
    render(
      <ShellLayoutProvider conversationSeat="onboarding">
        <ConversationPane />
        {questions()}
      </ShellLayoutProvider>
    );
    await waitFor(() => expect(transcriptReads()).toHaveLength(1));
    expect(transcriptReads()[0]).toContain('seat=onboarding');

    await user.type(screen.getByLabelText(DISCOVERY_COPY.answerLabel), 'The quiet.');
    await user.click(screen.getByRole('button', { name: DISCOVERY_COPY.save }));

    await waitFor(() =>
      expect(transcriptReads().at(-1)).toBe('/api/v1/app/conversation?seat=facilitator')
    );
    await sendATurn(user);
    await waitFor(() => expect(turnsOn('facilitator')).toHaveLength(1));
    expect(turnsOn('onboarding')).toHaveLength(0);
  });
});

describe('the seat the server read', () => {
  function Seat() {
    return <output data-testid="seat">{useShellLayout().conversationSeat}</output>;
  }

  it('defaults to the facilitator seat when the layout names none', () => {
    render(
      <ShellLayoutProvider>
        <Seat />
      </ShellLayoutProvider>
    );
    expect(screen.getByTestId('seat').textContent).toBe('facilitator');
  });

  it('is adopted again when the server’s value changes', () => {
    const { rerender } = render(
      <ShellLayoutProvider conversationSeat="facilitator">
        <Seat />
      </ShellLayoutProvider>
    );
    rerender(
      <ShellLayoutProvider conversationSeat="onboarding">
        <Seat />
      </ShellLayoutProvider>
    );
    expect(screen.getByTestId('seat').textContent).toBe('onboarding');
  });
});
