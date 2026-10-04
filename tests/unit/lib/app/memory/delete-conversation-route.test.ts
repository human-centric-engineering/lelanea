/**
 * The person's own conversation delete tells the app (f-memory t-128).
 *
 * Sunrise's `DELETE /api/v1/chat/conversations/:id` carries one Lelañea line:
 * once the conversation is deleted, it calls `onConversationsDeleted` so what
 * our turns left behind goes at once rather than at the next sweep. That line
 * is a divergence (`.context/app/divergences.md`), and a sync that resolves
 * the route by taking upstream would drop it with nothing else failing. This
 * test is what fails.
 *
 * Sunrise's own test of the route is left as it is: the hook never throws, so
 * the route behaves for it exactly as before.
 *
 * @see app/api/v1/chat/conversations/[id]/route.ts
 * @see lib/app/memory/delete-conversation.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const { onConversationsDeleted, order } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    onConversationsDeleted: vi.fn(async () => {
      order.push('hook');
    }),
  };
});

vi.mock('@/lib/db/client', () => ({
  prisma: {
    aiConversation: {
      findFirst: vi.fn(),
      delete: vi.fn(async () => {
        order.push('delete');
        return {};
      }),
    },
  },
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('@/lib/security/ip', () => ({ getClientIP: vi.fn(() => '127.0.0.1') }));
vi.mock('@/lib/app/memory/delete-conversation', () => ({ onConversationsDeleted }));

const { DELETE } = await import('@/app/api/v1/chat/conversations/[id]/route');
const { prisma } = await import('@/lib/db/client');
const { auth } = await import('@/lib/auth/config');

const CONVERSATION = 'clh3z8q0v0000356i0n2v3g8k';
const PERSON = 'cmjbv4i3x00003wsloputgwul';

function request(): NextRequest {
  const url = new URL(`http://localhost:3000/api/v1/chat/conversations/${CONVERSATION}`);
  return {
    json: async () => ({}),
    headers: new Headers(),
    url: url.toString(),
    nextUrl: { searchParams: url.searchParams },
    signal: new AbortController().signal,
  } as unknown as NextRequest;
}

const context = { params: Promise.resolve({ id: CONVERSATION }) };

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  vi.mocked(auth.api.getSession).mockResolvedValue({
    session: { id: 's', userId: PERSON, expiresAt: new Date(Date.now() + 86_400_000) },
    user: { id: PERSON, email: 'person@example.com', role: 'USER' },
  } as never);
});

describe('DELETE /api/v1/chat/conversations/:id — the Lelañea line', () => {
  it('tells the app which conversation went, and whose, after it is deleted', async () => {
    vi.mocked(prisma.aiConversation.findFirst).mockResolvedValue({ id: CONVERSATION } as never);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(200);
    expect(onConversationsDeleted).toHaveBeenCalledWith({
      conversationIds: [CONVERSATION],
      userId: PERSON,
    });
    expect(order).toEqual(['delete', 'hook']);
  });

  it('tells it nothing when the conversation is not the person’s', async () => {
    vi.mocked(prisma.aiConversation.findFirst).mockResolvedValue(null);

    const response = await DELETE(request(), context);

    expect(response.status).toBe(404);
    expect(order).toEqual([]);
  });
});
