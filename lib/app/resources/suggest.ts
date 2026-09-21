/**
 * `suggest_resource` — the agent hands a person one of Lelañea Fulton's films
 * or pieces of writing, in conversation (f-resources t-77; product description
 * §5 the Curator, §9 Resources).
 *
 * ## What it does, and what it deliberately cannot
 *
 * One argument, the resource `id`, and the answer is that resource from the
 * library — title, what it is for, its length — or a refusal. The model never
 * supplies a title or a description: it names an id it was shown in its
 * context block (`offering.ts`), the id is looked up here, and everything the
 * person sees is the file's words. An unknown id is refused with a structured
 * error rather than thrown, so a model that invents one gets told and can
 * carry on; the refusal reaches neither the chip nor the account
 * (`capability-answers.ts`: only a call that answered counts).
 *
 * ## Read-only, under the ceiling
 *
 * It reads the library and returns a record. Nothing is written, nothing is
 * deleted, nothing is done on anyone else's behalf — the ceiling f-safety
 * restated (`lib/app/agent/pins.ts`, `READ_ONLY_CAPABILITY_SLUGS`). No PII in
 * its arguments or its result, so the default provenance redaction stands:
 * the trace persists `{ id }` and a preview of the record, which is what the
 * transcript read and the replay rebuild the chip from ({@link
 * suggestionsFromProvenance}).
 *
 * ## The row, and the seed
 *
 * The handler is registered in `lib/app/capabilities.ts`; the `ai_capability`
 * row that advertises it, and the grant to the guide, are
 * `prisma/seeds/app-lelanea/014-suggest-resource.ts`. The seed carries its own
 * copy of {@link SUGGEST_RESOURCE_DEFINITION} as a literal — Sunrise's seed
 * reader resolves only same-file constants — and a test pins the two equal.
 *
 * @see lib/app/resources/suggestion.ts — the shape, import-light for the client
 * @see lib/app/resources/offering.ts — how the agent learns what it may suggest
 * @see .context/app/agent.md — "What she may reach for"
 */

import { z } from 'zod';

import { getResourcesLibrary } from '@/lib/app/content/resources';
import { SUGGEST_RESOURCE_SLUG, type ResourceSuggestion } from '@/lib/app/resources/suggestion';
import { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import type {
  CapabilityContext,
  CapabilityFunctionDefinition,
  CapabilityResult,
} from '@/lib/orchestration/capabilities/types';

/**
 * What the model is told the tool is. Kept in step with the seed's literal by
 * `tests/unit/prisma/seeds/app-lelanea/suggest-resource.test.ts`.
 *
 * The description says when — one thing, when it fits — because the tool's
 * schema is the one place a model reads at the moment of choosing, and the
 * context block that lists the library repeats the rule beside the list.
 */
export const SUGGEST_RESOURCE_DEFINITION: CapabilityFunctionDefinition = {
  name: SUGGEST_RESOURCE_SLUG,
  description:
    'Offer the person one of Lelañea’s films or pieces of writing, by its id, when it genuinely fits what they are working through right now. Use an id from the list of resources in your context — never invent one. Suggest one thing at a time, and only when it would help; most turns need none. The person sees the resource beside your reply and can open it.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The id of the film or reading, exactly as listed in your context.',
        maxLength: 80,
      },
    },
    required: ['id'],
  },
};

const argsSchema = z.object({
  // The file's id shape (`resources.ts`): lowercase alphanumeric with hyphens.
  // Anything else cannot match a resource, so it is refused at validation
  // rather than looked up.
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a resource id is lowercase alphanumeric with hyphens'),
});
type SuggestArgs = z.infer<typeof argsSchema>;

/** A resource by id, as a suggestion — or `null` when the library has no such id. */
export function findResource(id: string): ResourceSuggestion | null {
  const library = getResourcesLibrary();
  const film = library.films.find((f) => f.id === id);
  if (film) {
    return {
      id: film.id,
      kind: 'film',
      title: film.title,
      subtitle: film.subtitle,
      length: film.duration,
    };
  }
  const reading = library.readings.find((r) => r.id === id);
  if (reading) {
    return {
      id: reading.id,
      kind: 'reading',
      title: reading.title,
      subtitle: reading.subtitle,
      length: reading.readingTime,
    };
  }
  return null;
}

export class SuggestResourceCapability extends BaseCapability<SuggestArgs, ResourceSuggestion> {
  readonly slug = SUGGEST_RESOURCE_SLUG;
  readonly functionDefinition = SUGGEST_RESOURCE_DEFINITION;
  protected readonly schema = argsSchema;
  /** An id in, a library record out: nothing personal passes through. */
  readonly processesPii = false;

  // Synchronous work behind the async contract: the library is parsed once
  // and memoised, so there is nothing to await.
  execute(
    args: SuggestArgs,
    _context: CapabilityContext
  ): Promise<CapabilityResult<ResourceSuggestion>> {
    const suggestion = findResource(args.id);
    if (!suggestion) {
      return Promise.resolve(
        this.error(
          `No resource with id "${args.id}". Use an id from the list of resources in your context, or suggest nothing.`,
          'unknown_resource'
        )
      );
    }
    return Promise.resolve(this.success(suggestion));
  }
}

/**
 * The suggestions a stored turn made, rebuilt from the terminal assistant
 * row's `provenance.capabilityCalls` — one trace per call the model made,
 * carrying `slug`, `success` and the redacted `arguments`, which for this
 * capability are `{ id }` verbatim (no override of `redactProvenance`, and
 * nothing to redact).
 *
 * Only a call that answered counts (`capability-answers.ts`), and only an id
 * the library still has: a resource removed from the file after the turn is
 * not shown as a chip to nowhere. Order is the traces' order.
 */
const suggestionCallSchema = z.object({
  slug: z.literal(SUGGEST_RESOURCE_SLUG),
  success: z.literal(true),
  arguments: z.object({ id: z.string() }),
});
const provenanceSchema = z.object({ capabilityCalls: z.array(z.unknown()) });

export function suggestionsFromProvenance(provenance: unknown): ResourceSuggestion[] {
  const parsed = provenanceSchema.safeParse(provenance);
  if (!parsed.success) return [];
  return parsed.data.capabilityCalls.flatMap((raw) => {
    const call = suggestionCallSchema.safeParse(raw);
    if (!call.success) return [];
    const suggestion = findResource(call.data.arguments.id);
    return suggestion ? [suggestion] : [];
  });
}
