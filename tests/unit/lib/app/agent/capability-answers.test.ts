/**
 * Which capability calls answered — asked of a frame, and of the terminal
 * row's provenance, the same way (§10 t-66).
 *
 * @see lib/app/agent/capability-answers.ts
 */

import { describe, expect, it } from 'vitest';

import {
  answeredCalls,
  answeredCapabilities,
  capabilityAnswered,
} from '@/lib/app/agent/capability-answers';

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

describe('answeredCapabilities', () => {
  it('names the calls that answered, in order, and none that were refused or failed', () => {
    const provenance = {
      citations: [],
      capabilityCalls: [
        {
          slug: 'delete_everything',
          arguments: {},
          latencyMs: 0,
          success: false,
          errorCode: 'tool_not_advertised',
        },
        { slug: 'search_knowledge_base', arguments: { query: 'b' }, latencyMs: 40, success: true },
        {
          slug: 'search_knowledge_base',
          arguments: { query: 'c' },
          latencyMs: 40,
          success: false,
          errorCode: 'execution_error',
        },
        { slug: 'get_state', arguments: {}, latencyMs: 1, success: true },
      ],
    };
    expect(answeredCapabilities(provenance)).toEqual(['search_knowledge_base', 'get_state']);
  });

  it('hands back each answered call with whatever the trace kept of its arguments', () => {
    const calls = answeredCalls({
      capabilityCalls: [
        { slug: 'suggest_resource', success: true, arguments: { id: 'on-stalling' } },
        { slug: 'suggest_resource', success: false, arguments: { id: 'nope' } },
        { slug: 'get_state', success: true },
      ],
    });
    expect(calls).toEqual([
      { slug: 'suggest_resource', arguments: { id: 'on-stalling' } },
      { slug: 'get_state', arguments: undefined },
    ]);
    expect(answeredCalls(null)).toEqual([]);
  });

  it('reads nothing from a row with no traces, and skips a trace it cannot read', () => {
    expect(answeredCapabilities(null)).toEqual([]);
    expect(answeredCapabilities({ citations: [] })).toEqual([]);
    expect(answeredCapabilities({ capabilityCalls: 'nope' })).toEqual([]);
    expect(
      answeredCapabilities({
        capabilityCalls: [{ slug: 1, success: true }, 'x', { slug: 'get_state', success: true }],
      })
    ).toEqual(['get_state']);
  });
});
