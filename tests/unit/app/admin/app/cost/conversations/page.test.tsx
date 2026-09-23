// @vitest-environment happy-dom

/**
 * /admin/app/cost/conversations/:conversationId — one read, handed down
 * (f-budget t-97). The middle of the drill-down: the conversation's turns come
 * with their own costs and their person's id, so nothing is fetched per turn.
 *
 * @see app/admin/app/cost/conversations/[conversationId]/page.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/api/server-fetch', () => ({
  serverFetch: vi.fn(),
  parseApiResponse: vi.fn(),
}));

vi.mock('@/components/app/admin/cost-view', () => ({
  ConversationTurnsView: (props: { reading: { conversationId: string } }) => (
    <div data-testid="turns" data-conversation={props.reading.conversationId} />
  ),
}));

import CostConversationPage from '@/app/admin/app/cost/conversations/[conversationId]/page';
import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';

const CONVERSATION = 'cmu7conversation000000000';
const page = () =>
  CostConversationPage({ params: Promise.resolve({ conversationId: CONVERSATION }) });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CostConversationPage', () => {
  it("reads that conversation's turns in one request, and hands them down", async () => {
    vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
    vi.mocked(parseApiResponse).mockResolvedValue({
      success: true,
      data: { conversationId: CONVERSATION, turns: [], truncated: false },
    } as never);

    render(await page());

    expect(serverFetch).toHaveBeenCalledTimes(1);
    expect(serverFetch).toHaveBeenCalledWith(
      `/api/v1/admin/app/metering/conversations/${CONVERSATION}`
    );
    expect(screen.getByTestId('turns').getAttribute('data-conversation')).toBe(CONVERSATION);
    expect(screen.getByRole('link', { name: '← Cost' }).getAttribute('href')).toBe(
      '/admin/app/cost'
    );
  });

  it.each([
    ['a refused read', () => vi.mocked(serverFetch).mockResolvedValue({ ok: false } as Response)],
    [
      'an envelope that is not a success',
      () => {
        vi.mocked(serverFetch).mockResolvedValue({ ok: true } as Response);
        vi.mocked(parseApiResponse).mockResolvedValue({ success: false } as never);
      },
    ],
    ['a read that throws', () => vi.mocked(serverFetch).mockRejectedValue(new Error('down'))],
  ])('says it did not load on %s, and draws no table', async (_name, arrange) => {
    arrange();
    render(await page());
    expect(screen.getByRole('alert').textContent).toContain('did not load');
    expect(screen.queryByTestId('turns')).toBeNull();
  });
});
