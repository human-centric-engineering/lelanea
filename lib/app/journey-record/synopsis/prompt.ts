/**
 * The synopsis call's messages and its reply contract (f-journey-record t-146).
 *
 * Pure, so the contract is tested on its own. A reply that is not exactly
 * this shape is refused: {@link parseSynopsisReply} returns null and
 * `runStructuredCompletion` asks once more, then gives up, and nothing is
 * stored. The JSON schema is handed to the provider as well, but a provider
 * that ignores it is caught here.
 *
 * The model is asked for the summary, the account and the outcomes only. The
 * modules and notes are derived (`material.ts`), so it is never asked to guess
 * them.
 */

import { z } from 'zod';

import { tryParseJson } from '@/lib/orchestration/evaluations/parse-structured';
import type { LlmMessage } from '@/lib/orchestration/llm/types';
import {
  JOURNEY_BODY_MAX,
  JOURNEY_OUTCOME_KINDS,
  JOURNEY_OUTCOMES_MAX,
  JOURNEY_SUMMARY_MAX,
  journeyOutcomeSchema,
} from '@/lib/app/journey-record/entry';
import type { SessionLine } from '@/lib/app/journey-record/synopsis/material';

/** The draft as the model returns it. Strict: an extra field is a malformed reply. */
export const synopsisReplySchema = z
  .object({
    summary: z.string().trim().min(1).max(JOURNEY_SUMMARY_MAX),
    body: z.string().trim().min(1).max(JOURNEY_BODY_MAX),
    outcomes: z.array(journeyOutcomeSchema).max(JOURNEY_OUTCOMES_MAX),
  })
  .strict();
export type SynopsisReply = z.infer<typeof synopsisReplySchema>;

/** The same contract, as the provider's structured-output directive. */
export const SYNOPSIS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', maxLength: JOURNEY_SUMMARY_MAX },
    body: { type: 'string' },
    outcomes: {
      type: 'array',
      maxItems: JOURNEY_OUTCOMES_MAX,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...JOURNEY_OUTCOME_KINDS] },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'body', 'outcomes'],
  additionalProperties: false,
};

export const SYNOPSIS_RETRY_MESSAGE =
  'Respond ONLY with a JSON object {"summary": string, "body": string, "outcomes": [{"kind": "action" | "insight" | "tension", "text": string}]}. No prose, no code fences.';

/** The fence around the conversation. Stripped from anything said inside it. */
const TRANSCRIPT_START = '[The session begins]';
const TRANSCRIPT_END = '[The session ends]';

function unfenced(text: string): string {
  return text.replaceAll(TRANSCRIPT_START, '').replaceAll(TRANSCRIPT_END, '');
}

/**
 * One message, every line of it quoted with "> ", so nothing inside a message
 * can pass for a speaker's label: those are the only unquoted lines.
 */
function quoted(text: string): string {
  return unfenced(text)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

/** The conversation as one fenced block: who spoke, then what they said, quoted. */
export function synopsisTranscript(lines: readonly SessionLine[]): string {
  const said = lines.map(
    (line) => `${line.role === 'user' ? 'They said' : 'You said'}:\n${quoted(line.content)}`
  );
  return [TRANSCRIPT_START, ...said, TRANSCRIPT_END].join('\n\n');
}

/** Her composed system prompt, then the session as the one thing to write about. */
export function synopsisMessages(
  systemPrompt: string,
  lines: readonly SessionLine[]
): LlmMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Write the account of this session.\n\n${synopsisTranscript(lines)}`,
    },
  ];
}

/** The reply, or null when it is not exactly the contract. */
export function parseSynopsisReply(raw: string): SynopsisReply | null {
  return tryParseJson(raw, (parsed) => {
    const result = synopsisReplySchema.safeParse(parsed);
    return result.success ? result.data : null;
  });
}
