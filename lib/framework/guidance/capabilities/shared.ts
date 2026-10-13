/**
 * Shared plumbing for the guidance read capabilities (f-guidance t-2).
 *
 * Every guidance capability reads **one journey of the calling user**. The journey is keyed
 * on `graphSlug` (which map) + optional `contextKey` (parallel-instance discriminator, X3),
 * which the agent supplies from its injected surface context (t-4 puts the graph in the
 * prompt). The **subject is always the caller** — the `userId` `checkUserCaller()`
 * (`@/lib/framework/shared/caller`) returns, which refuses a system run and an anonymous embed
 * visitor — and a capability never reads another user's journey (`canRead(viewer, subject)` in the queries resolves to own-access), so the
 * `graphSlug` arg only selects *which of the caller's own* journeys to read.
 */

import { z } from 'zod';
import type { JourneyViewer } from '@/lib/framework/shared/access';
import type { JourneyKey } from '@/lib/framework/facilitation/journey/queries';

/** The journey-selecting args every guidance read capability accepts. */
export const journeyArgsSchema = z.object({
  graphSlug: z.string().min(1),
  contextKey: z.string().optional(),
});
export type JourneyArgs = z.infer<typeof journeyArgsSchema>;

/** The `functionDefinition.parameters` properties for the journey args (LLM-facing). */
export const journeyArgProperties = {
  graphSlug: {
    type: 'string',
    description: 'The facilitation map (graph slug) whose journey to read.',
    minLength: 1,
  },
  contextKey: {
    type: 'string',
    description:
      'Optional parallel-instance discriminator when the user walks the same map more than once (e.g. supporting two people). Omit for the default journey.',
  },
} as const;

/** Build the `{ viewer, key }` pair for the journey reads from a (userId-guarded) context. */
export function journeyRequest(
  args: JourneyArgs,
  userId: string
): { viewer: JourneyViewer; key: JourneyKey } {
  return {
    viewer: { userId },
    key: {
      userId,
      graphSlug: args.graphSlug,
      ...(args.contextKey !== undefined ? { contextKey: args.contextKey } : {}),
    },
  };
}
