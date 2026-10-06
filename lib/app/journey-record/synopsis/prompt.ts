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
  JOURNEY_OUTCOME_TEXT_MAX,
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

/**
 * The same contract, as the provider's structured-output directive, with the
 * same limits: a provider that honours it cannot return a reply the schema
 * above would refuse on length.
 */
export const SYNOPSIS_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: JOURNEY_SUMMARY_MAX },
    body: { type: 'string', minLength: 1, maxLength: JOURNEY_BODY_MAX },
    outcomes: {
      type: 'array',
      maxItems: JOURNEY_OUTCOMES_MAX,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...JOURNEY_OUTCOME_KINDS] },
          text: { type: 'string', minLength: 1, maxLength: JOURNEY_OUTCOME_TEXT_MAX },
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

/** The fence around the draft being replaced, and around what the person said of it. */
const PREVIOUS_START = '[The last draft begins]';
const PREVIOUS_END = '[The last draft ends]';
const STEER_START = '[What they said begins]';
const STEER_END = '[What they said ends]';

/** Every fence this prompt draws, stripped from anything placed inside one. */
const FENCES = [
  TRANSCRIPT_START,
  TRANSCRIPT_END,
  PREVIOUS_START,
  PREVIOUS_END,
  STEER_START,
  STEER_END,
];

/**
 * One piece of material, every fence stripped from it and every line of it
 * quoted with "> ", so nothing inside it can close a fence or pass for a
 * speaker's label: those are the only unquoted lines.
 */
function quoted(text: string): string {
  let clean = text;
  for (const fence of FENCES) clean = clean.replaceAll(fence, '');
  return clean
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

/** What a regenerate carries into the prompt (t-147): the draft it replaces, and why. */
export interface SynopsisRetake {
  previous: { summary: string; body: string };
  /** What the person said about the last draft. Null when they gave no reason. */
  steer: string | null;
}

/**
 * The ask for another draft: the last one, and what the person said about it,
 * each fenced and quoted as the transcript is. Their steer is about the
 * account, so it is weighed as a request about the writing, never as a fact
 * about the session: the conversation is still the only source.
 */
function retakeAsk(retake: SynopsisRetake): string {
  const parts = [
    'They read your last draft and asked for another.',
    [
      PREVIOUS_START,
      quoted(`${retake.previous.summary}\n\n${retake.previous.body}`),
      PREVIOUS_END,
    ].join('\n'),
  ];
  if (retake.steer) {
    parts.push(
      'What they said about it, a request about the writing, not something said in the session:',
      [STEER_START, quoted(retake.steer), STEER_END].join('\n')
    );
  }
  parts.push(
    'Write the account again, from the session. Take their request into account where the session bears it out. Add nothing the session does not contain.'
  );
  return parts.join('\n\n');
}

/**
 * Her composed system prompt, then the session as the one thing to write
 * about. A regenerate adds the draft it replaces and the person's steer after
 * the session, so the session is still what the account is written from.
 */
export function synopsisMessages(
  systemPrompt: string,
  lines: readonly SessionLine[],
  retake?: SynopsisRetake
): LlmMessage[] {
  const ask = `Write the account of this session.\n\n${synopsisTranscript(lines)}`;
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: retake ? `${ask}\n\n${retakeAsk(retake)}` : ask },
  ];
}

/** The reply, or null when it is not exactly the contract. */
export function parseSynopsisReply(raw: string): SynopsisReply | null {
  return tryParseJson(raw, (parsed) => {
    const result = synopsisReplySchema.safeParse(parsed);
    return result.success ? result.data : null;
  });
}
