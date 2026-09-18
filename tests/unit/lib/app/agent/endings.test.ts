/**
 * Every way the platform can end a turn reaches the browser as one of three
 * plain endings — never as itself (§08 t-55).
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
  ENDING_MESSAGES,
  STILL_THINKING,
  endingForCode,
  stillThinkingFrame,
  toClientEvent,
} from '@/lib/app/agent/endings';
import type { ChatEvent } from '@/types/orchestration';

const VOCABULARY = ['unavailable', 'timed_out', 'paused'];

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
  });

  it('the still-thinking warning carries its own code', () => {
    expect(stillThinkingFrame()).toMatchObject({ type: 'warning', code: STILL_THINKING });
  });
});
