/**
 * Whether a capability call answered — asked of a frame and of a stored tool
 * row the same way (§10 t-66).
 *
 * @see lib/app/agent/capability-answers.ts
 */

import { describe, expect, it } from 'vitest';

import { capabilityAnswered, toolRowAnswered } from '@/lib/app/agent/capability-answers';

describe('capabilityAnswered', () => {
  it('is true only for a result that says success', () => {
    expect(capabilityAnswered({ success: true, data: { results: [] } })).toBe(true);
    expect(capabilityAnswered({ success: false, error: { code: 'tool_not_advertised' } })).toBe(
      false
    );
    expect(capabilityAnswered({ success: 'yes' })).toBe(false);
    expect(capabilityAnswered(1)).toBe(false);
    expect(capabilityAnswered(undefined)).toBe(false);
  });
});

describe('toolRowAnswered', () => {
  it('reads metadata.result where the platform kept it', () => {
    expect(
      toolRowAnswered({ content: '{"success":false}', metadata: { result: { success: true } } })
    ).toBe(true);
    expect(
      toolRowAnswered({ content: '{"success":true}', metadata: { result: { success: false } } })
    ).toBe(false);
  });

  it('falls back to the content, and an unreadable row did not answer', () => {
    expect(toolRowAnswered({ content: '{"success":true,"data":{}}', metadata: null })).toBe(true);
    expect(toolRowAnswered({ content: '{"success":false}', metadata: { toolCall: {} } })).toBe(
      false
    );
    expect(toolRowAnswered({ content: 'not json', metadata: null })).toBe(false);
  });
});
