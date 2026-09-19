/**
 * What her seat sends the browser, frame by frame (§10 t-64).
 *
 * The leaf's own event schema rather than Sunrise's `parseChatStreamEvent`,
 * for one reason that matters: Zod objects are non-strict, so a field the admin
 * schema does not model is silently STRIPPED. The crisis frame's `resource`
 * (`lib/app/safety/resource.ts`) is exactly such a field, and a person in
 * danger would get the flattened `message` instead of the services laid out.
 *
 * What her seat can send is narrower than the platform's full union, because
 * every frame passes `toClientStream()` first (`lib/app/agent/endings.ts`):
 * `error` carries one of the endings, `crisis` (with its `resource`) or
 * `ceiling_reached` (with its `ceiling` figures), never a platform code;
 * `budget_exceeded_per_turn` never arrives (it becomes an ending); nothing on
 * her seats requires approval. Those variants are therefore not modelled, and
 * a frame this schema does not recognise is `null` — ignored, not fatal — so a
 * frame the platform adds tomorrow degrades to nothing rather than to a crash.
 *
 * @see .context/app/conversation.md
 * @see .context/app/safety.md — "The client frame"
 */

import { z } from 'zod';

import { parseSseBlock } from '@/lib/api/sse-parser';
import { citationSchema } from '@/lib/validations/orchestration';

const crisisServiceSchema = z.object({
  name: z.string(),
  contact: z.string(),
  hours: z.string(),
  url: z.string().optional(),
});

/** The authored resource a crisis frame carries. Mirrors `CrisisResource`. */
export const crisisResourceSchema = z.object({
  tier: z.enum(['hard', 'soft']),
  region: z.string().nullable(),
  intro: z.string(),
  services: z.array(crisisServiceSchema),
  emergency: z.string(),
  keptMessage: z.string().nullable(),
  status: z.enum(['draft', 'signed_off']),
  version: z.string(),
});

export type CrisisResource = z.infer<typeof crisisResourceSchema>;

/**
 * A resource that is not the authored shape drops to nothing rather than
 * failing the frame: `message` is the whole resource as text (safety.md), so
 * the person still sees every name and number.
 */
const resourceField = crisisResourceSchema.optional().catch(undefined);

/** The figures the ceiling ending carries (`ceilingReachedFrame`, f-safety). Same leniency. */
export const ceilingFiguresSchema = z.object({
  spentUsd: z.number(),
  ceilingUsd: z.number(),
  resetsAt: z.string(),
});
const ceilingField = ceilingFiguresSchema.optional().catch(undefined);

const tokenUsageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
});

export const conversationEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('start'),
    conversationId: z.string(),
    messageId: z.string().optional(),
  }),
  z.object({ type: z.literal('content'), delta: z.string() }),
  /** The platform's operator strings ("Thinking...", "Executing …"). Never shown. */
  z.object({ type: z.literal('status'), message: z.string() }),
  z.object({ type: z.literal('content_reset'), reason: z.string().optional() }),
  z.object({
    type: z.literal('capability_result'),
    capabilitySlug: z.string(),
    result: z.unknown(),
  }),
  z.object({
    type: z.literal('capability_results'),
    results: z.array(z.object({ capabilitySlug: z.string(), result: z.unknown() })),
  }),
  z.object({
    type: z.literal('warning'),
    code: z.string().optional(),
    message: z.string(),
    resource: resourceField,
  }),
  z.object({ type: z.literal('citations'), citations: z.array(citationSchema) }),
  z.object({
    type: z.literal('done'),
    tokenUsage: tokenUsageSchema.optional(),
    costUsd: z.number().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    finishReason: z.enum(['stop', 'tool_use', 'length', 'error']).optional(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    resource: resourceField,
    ceiling: ceilingField,
  }),
]);

export type ConversationEvent = z.infer<typeof conversationEventSchema>;

/**
 * One SSE block → one typed frame, or `null` for a keepalive, an unknown type
 * or a payload that does not fit. `null` means "move on".
 */
export function parseConversationEvent(block: string): ConversationEvent | null {
  const frame = parseSseBlock(block);
  if (!frame) return null;
  // The generic parser keeps the `event:` line apart from the data; the union
  // discriminates on `type`, so put it back. The frame's own type wins.
  const parsed = conversationEventSchema.safeParse({ ...frame.data, type: frame.type });
  return parsed.success ? parsed.data : null;
}
