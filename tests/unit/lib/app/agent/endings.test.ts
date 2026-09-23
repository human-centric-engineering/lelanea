/**
 * Every way the platform can end a turn reaches the browser as one of four
 * plain endings — never as itself (§08 t-55; the fourth, `not_sent`, §10 t-65).
 *
 * The codes are read from the platform's own registry source rather than copied
 * here, so a code Sunrise adds tomorrow is covered by this file the day it
 * merges. The stream-level proof — a provider error carrying a slug and an env
 * var name, and nothing of it in any frame — is in `turns.test.ts`, against the
 * real turn seam.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  ENDING_CEILING_REACHED,
  ENDING_MESSAGES,
  ENDING_NOT_SENT,
  STILL_THINKING,
  ceilingReachedFrame,
  endingForCode,
  stillThinkingFrame,
  toClientEvent,
} from '@/lib/app/agent/endings';
import type { ChatEvent } from '@/types/orchestration';

const VOCABULARY = ['unavailable', 'timed_out', 'paused', 'not_sent'];

/** Every code in Sunrise's user-facing error registry, from its source. */
function platformRegistryCodes(): string[] {
  const source = readFileSync(
    path.join(process.cwd(), 'lib/orchestration/chat/error-messages.ts'),
    'utf8'
  );
  const map = source.slice(source.indexOf('const ERROR_MAP'), source.indexOf('export function'));
  return [...map.matchAll(/^ {2}([a-z0-9_]+): \{/gm)].map((match) => match[1]);
}

/** Codes the chat handler and provider layer emit that the registry does not list. */
const EMITTED_OUTSIDE_THE_REGISTRY = [
  'aborted',
  'provider_unavailable',
  'unsafe_base_url',
  'missing_provider_slug',
  'CAPABILITY_NOT_SUPPORTED',
  'turn_reply_unavailable',
  'reply_not_linked',
  'incomplete',
];

describe('endingForCode', () => {
  it('maps every code in the platform registry into the vocabulary', () => {
    const codes = platformRegistryCodes();
    // The population: the registry parsed, and it is not small.
    expect(codes.length).toBeGreaterThan(20);
    expect(codes).toContain('http_429');

    for (const code of [...codes, ...EMITTED_OUTSIDE_THE_REGISTRY]) {
      expect(VOCABULARY).toContain(endingForCode(code));
    }
  });

  it('reads running out of time as timed out — the deadline, and the provider’s own', () => {
    expect(endingForCode('aborted')).toBe('timed_out');
    expect(endingForCode('timeout')).toBe('timed_out');
    expect(endingForCode('http_504')).toBe('timed_out');
    expect(endingForCode('timed_out')).toBe('timed_out');
  });

  it('reads everything else, rate limits included, as unavailable', () => {
    expect(endingForCode('http_429')).toBe('unavailable');
    expect(endingForCode('missing_api_key')).toBe('unavailable');
    expect(endingForCode('all_providers_exhausted')).toBe('unavailable');
  });

  it('maps an unknown code to unavailable, never through', () => {
    expect(endingForCode('a_code_nobody_has_written_yet')).toBe('unavailable');
    expect(endingForCode('')).toBe('unavailable');
  });

  describe('not_sent — the message was refused, and a retry would be too (§10 t-65)', () => {
    /** The platform's refusals of the message itself, by name (`streaming-handler.ts`). */
    const REFUSALS = [
      'input_blocked',
      'conversation_cap_reached',
      'conversation_length_cap_reached',
    ];

    it('maps each named refusal code to not_sent', () => {
      // Each is a code the platform really emits: in its registry, so a rename
      // upstream fails here rather than silently falling to `unavailable`.
      const registry = platformRegistryCodes();
      for (const code of REFUSALS) {
        expect(registry).toContain(code);
        expect(endingForCode(code)).toBe(ENDING_NOT_SENT);
      }
      expect(endingForCode(ENDING_NOT_SENT)).toBe(ENDING_NOT_SENT);
    });

    it('leaves every other code where it was — her reply refused is still a re-runnable turn', () => {
      expect(endingForCode('output_blocked')).toBe('unavailable');
      expect(endingForCode('citation_required')).toBe('unavailable');
      expect(endingForCode('invalid_request')).toBe('unavailable');
      const registry = platformRegistryCodes().filter((code) => !REFUSALS.includes(code));
      expect(registry.length).toBeGreaterThan(20);
      for (const code of registry) expect(endingForCode(code)).not.toBe(ENDING_NOT_SENT);
    });

    it('carries none of the platform\u2019s text into any frame, refusal or not', () => {
      const registry = platformRegistryCodes();
      for (const code of [...registry, ...EMITTED_OUTSIDE_THE_REGISTRY]) {
        const frame = toClientEvent({ type: 'error', code, message: `OPERATOR TEXT for ${code}` });
        expect(frame).toMatchObject({ type: 'error' });
        if (frame?.type !== 'error') throw new Error('unreachable');
        expect(Object.values(ENDING_MESSAGES)).toContain(frame.message);
        expect(frame.message).not.toContain('OPERATOR TEXT');
        expect(frame.message).not.toContain(code);
      }
    });
  });
});

describe('toClientEvent', () => {
  it('replaces an error’s code and text with the ending’s', () => {
    const leaky: ChatEvent = {
      type: 'error',
      code: 'missing_api_key',
      message: 'Go to Admin → Providers and add OPENAI_API_KEY for openai.',
    };

    expect(toClientEvent(leaky)).toEqual({
      type: 'error',
      code: 'unavailable',
      message: ENDING_MESSAGES.unavailable,
    });
  });

  it('turns the per-turn cost cap into a plain ending, dropping its spend figures', () => {
    const capped: ChatEvent = {
      type: 'budget_exceeded_per_turn',
      code: 'budget_exceeded_per_turn',
      message: 'Capped at $0.50.',
      usedUsd: 0.61,
      limitUsd: 0.5,
    };

    expect(toClientEvent(capped)).toEqual({
      type: 'error',
      code: 'unavailable',
      message: ENDING_MESSAGES.unavailable,
    });
  });

  it("drops the monthly budget warning — the agent's spend is not a member's business", () => {
    const warning: ChatEvent = {
      type: 'warning',
      code: 'budget_warning',
      message: 'This agent has used 85% of its $50.00 monthly budget.',
    };

    expect(toClientEvent(warning)).toBeNull();
  });

  it('passes every other frame as it is', () => {
    const frames: ChatEvent[] = [
      { type: 'start', conversationId: 'c1', messageId: 'm1' },
      { type: 'content', delta: 'Hello.' },
      stillThinkingFrame(),
      {
        type: 'done',
        tokenUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        costUsd: 0.0001,
      },
    ];
    for (const frame of frames) expect(toClientEvent(frame)).toBe(frame);
  });
});

describe('the copy', () => {
  it('says what the person can do, for each ending', () => {
    expect(ENDING_MESSAGES.unavailable).toMatch(/try .*again/i);
    expect(ENDING_MESSAGES.timed_out).toMatch(/try .*again/i);
    // Deliberate, and reading still works (HB10).
    expect(ENDING_MESSAGES.paused).toMatch(/on purpose/i);
    expect(ENDING_MESSAGES.paused).toMatch(/read/i);
    // Names that it was not sent, offers no retry (a retry meets the same
    // refusal), and says what is left (HB10).
    expect(ENDING_MESSAGES.not_sent).toMatch(/couldn't be sent/i);
    expect(ENDING_MESSAGES.not_sent).not.toMatch(/try .*again/i);
    expect(ENDING_MESSAGES.not_sent).toMatch(/put it another way/i);
    expect(ENDING_MESSAGES.not_sent).toMatch(/still works/i);
  });

  it('the still-thinking warning carries its own code', () => {
    expect(stillThinkingFrame()).toMatchObject({ type: 'warning', code: STILL_THINKING });
  });
});

describe('the ceiling frame on a limit of nothing (t-96)', () => {
  it('names no reset for a limit of zero — waiting would not bring replies back', () => {
    const frame = ceilingReachedFrame({
      spentUsd: 0,
      ceilingUsd: 0,
      resetsAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(frame.message).not.toContain('October');
    expect(frame.message).not.toContain('resets');
    expect(frame.message).toContain('still works');
    // The figures still ride on the frame, as they are.
    expect(frame.ceiling.ceilingUsd).toBe(0);
  });

  it.each([0.004, 0.01])(
    'still names the reset for a positive limit (%s), which the gate lets a turn under',
    (limit) => {
      const frame = ceilingReachedFrame({
        spentUsd: limit,
        ceilingUsd: limit,
        resetsAt: new Date('2026-10-01T00:00:00.000Z'),
      });
      expect(frame.message).toContain('resets on 1 October');
    }
  );
});

describe('the ceiling ending (f-safety t-59)', () => {
  const frame = ceilingReachedFrame({
    spentUsd: 5.2,
    ceilingUsd: 5,
    resetsAt: new Date('2026-10-01T00:00:00Z'),
  });

  it('carries the figures and the reset date', () => {
    expect(frame).toMatchObject({
      type: 'error',
      code: ENDING_CEILING_REACHED,
      ceiling: { spentUsd: 5.2, ceilingUsd: 5, resetsAt: '2026-10-01T00:00:00.000Z' },
    });
  });

  it('says why, and what the person can do — without offering more', () => {
    expect(frame.message).toContain('$5.20 of $5.00');
    expect(frame.message).toContain('1 October');
    expect(frame.message).toContain('read and write');
    expect(frame.message).not.toMatch(/ask|request|contact|upgrade/i);
  });

  it('is never mapped from a platform frame', () => {
    const event: ChatEvent = { type: 'error', code: ENDING_CEILING_REACHED, message: 'x' };
    expect(toClientEvent(event)).toEqual({
      type: 'error',
      code: 'unavailable',
      message: ENDING_MESSAGES.unavailable,
    });
  });
});
