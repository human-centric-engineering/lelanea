/**
 * The leaf's event schema — every frame her seat sends parses, and the one
 * field Sunrise's parser would strip survives (§10 t-64).
 *
 * @see lib/app/conversation/events.ts
 */

import { describe, expect, it } from 'vitest';

import { parseConversationEvent } from '@/lib/app/conversation/events';
import { parseChatStreamEvent } from '@/components/admin/orchestration/chat/chat-events';

function block(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}`;
}

const resource = {
  tier: 'hard',
  region: 'GB',
  intro: 'If you are in danger right now',
  services: [{ name: 'Samaritans', contact: '116 123', hours: '24/7', url: 'https://x' }],
  emergency: 'Call your local emergency number now. (999)',
  keptMessage: 'what I typed',
  status: 'draft',
  version: '1',
};

describe('every frame her seat sends', () => {
  it.each([
    ['start', { conversationId: 'c1', messageId: 'm1' }],
    ['content', { delta: 'hello ' }],
    ['status', { message: 'Thinking...' }],
    ['content_reset', { reason: 'request_fault' }],
    ['capability_result', { capabilitySlug: 'search_knowledge_base', result: { hits: 2 } }],
    ['capability_results', { results: [{ capabilitySlug: 'search_knowledge_base', result: 1 }] }],
    ['warning', { code: 'still_thinking', message: 'Still thinking' }],
    ['citations', { citations: [] }],
    [
      'done',
      {
        tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0.001,
        provider: 'openai',
        model: 'gpt-4o-mini-2024-07-18',
        finishReason: 'stop',
      },
    ],
    ['error', { code: 'unavailable', message: 'Your message is kept.' }],
  ])('parses %s', (type, data) => {
    const parsed = parseConversationEvent(block(type, data));
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe(type);
  });

  it('ignores a keepalive, an unknown type and a payload that does not fit', () => {
    expect(parseConversationEvent(': keepalive')).toBeNull();
    expect(parseConversationEvent(block('approval_required', { pendingApproval: {} }))).toBeNull();
    expect(parseConversationEvent(block('content', { delta: 42 }))).toBeNull();
  });
});

describe('the crisis frame keeps its resource', () => {
  it('on an error frame — and Sunrise’s parser would have dropped it', () => {
    const frame = block('error', { code: 'crisis', message: 'flattened', resource });

    const ours = parseConversationEvent(frame);
    expect(ours?.type).toBe('error');
    expect(ours && 'resource' in ours ? ours.resource : undefined).toEqual(resource);

    // The reason this schema exists: the admin parser is non-strict and strips
    // what it does not model. Reverting to it makes this assertion fail.
    const theirs = parseChatStreamEvent(frame);
    expect(theirs && 'resource' in theirs).toBe(false);
  });

  it('on a warning frame', () => {
    const ours = parseConversationEvent(
      block('warning', {
        code: 'crisis',
        message: 'flattened',
        resource: { ...resource, tier: 'soft' },
      })
    );
    expect(ours?.type).toBe('warning');
    expect(ours && 'resource' in ours ? ours.resource?.tier : undefined).toBe('soft');
  });

  it('drops a resource that is not the authored shape, keeping the message', () => {
    const ours = parseConversationEvent(
      block('error', { code: 'crisis', message: 'every name and number', resource: { tier: 'x' } })
    );
    // The frame still arrives; `message` is the whole resource as text
    // (safety.md), so nothing a person needs is lost to a shape mismatch.
    expect(ours?.type).toBe('error');
    expect(ours && 'message' in ours ? ours.message : undefined).toBe('every name and number');
    expect(ours && 'resource' in ours ? ours.resource : 'absent').toBeUndefined();
  });
});
