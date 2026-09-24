/**
 * `suggest_resource` — the agent hands a person one of Lelañea Fulton's videos
 * or articles, in conversation (f-resources t-77; product description
 * §5 the Curator, §9 Resources).
 *
 * ## What it does, and what it deliberately cannot
 *
 * One argument, the resource `id`, and the answer is that resource from the
 * library — title, what it is for, its length — or a refusal. The model never
 * supplies a title or a description: it names an id it was shown in its
 * context block (`offering.ts`), the id is looked up here, and everything the
 * person sees is the library's words (`app_resource`, t-87). An unknown id is refused with a structured
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
 * ## Reads (t-87)
 *
 * The library is in the database. The tool looks its one id up per call
 * ({@link findResource}). A reload or a replay resolves every suggestion in a
 * conversation against ONE read of the library, which the caller makes with
 * {@link loadLibraryForChips} and hands to {@link suggestionsByCall} or
 * {@link suggestionsFromProvenance}. Those stay synchronous, so resolving a
 * transcript is one query however many chips it has.
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

import { answeredCalls, type AnsweredCall } from '@/lib/app/agent/capability-answers';
import { getResource, getResourcesLibrary } from '@/lib/app/content/resource-store';
import type { ResourcesLibrary } from '@/lib/app/content/resources';
import type { ResourceKind } from '@/lib/app/content/resource-view';
import { logger } from '@/lib/logging';
import {
  SUGGEST_RESOURCE_SLUG,
  uniqueSuggestions,
  type ResourceSuggestion,
} from '@/lib/app/resources/suggestion';
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
    'Offer the person one of Lelañea’s videos, audio or articles, by its id, when it genuinely fits what they are working through right now. Use an id from the list of resources in your context — never invent one. Suggest one thing at a time, and only when it would help; most turns need none. The person sees the resource beside your reply and can open it.',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'The id of the video, audio or article, exactly as listed in your context.',
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

type LibraryItem =
  | ResourcesLibrary['videos'][number]
  | ResourcesLibrary['audio'][number]
  | ResourcesLibrary['articles'][number];

/**
 * A video, audio or article, as the chip shows it. The kind is passed in, not
 * read off the shape: a video and an audio piece have the same fields.
 */
function toSuggestion(kind: ResourceKind, item: LibraryItem): ResourceSuggestion {
  return {
    id: item.id,
    kind,
    title: item.title,
    subtitle: item.subtitle,
    length: 'duration' in item ? item.duration : item.readingTime,
  };
}

/** A resource by id, as a suggestion — or `null` when the library has no such id. One read. */
export async function findResource(id: string): Promise<ResourceSuggestion | null> {
  const found = await getResource(id);
  return found ? toSuggestion(found.kind, found.resource) : null;
}

/** The same lookup against a library already read. */
function findIn(library: ResourcesLibrary, id: string): ResourceSuggestion | null {
  const video = library.videos.find((item) => item.id === id);
  if (video) return toSuggestion('video', video);
  const audio = library.audio.find((item) => item.id === id);
  if (audio) return toSuggestion('audio', audio);
  const article = library.articles.find((item) => item.id === id);
  return article ? toSuggestion('article', article) : null;
}

/**
 * The library, read once, for resolving the suggestions the given stored
 * turns made — or `null` when none of them suggested anything (no read at
 * all), or it cannot be read.
 *
 * A chip is not worth failing a transcript for: with no library the replies
 * are shown without their chips, and the warning says why. What it cannot do
 * is show a chip for something it could not look up.
 */
export async function loadLibraryForChips(
  provenances: readonly unknown[]
): Promise<ResourcesLibrary | null> {
  // Most conversations suggested nothing. They read nothing.
  const suggested = provenances.some((provenance) =>
    answeredCalls(provenance).some((call) => call.slug === SUGGEST_RESOURCE_SLUG)
  );
  if (!suggested) return null;
  try {
    // Retired resources included: a chip for a suggestion made before its
    // resource was retired must still resolve (t-91). See `getResourcesLibrary`.
    return await getResourcesLibrary({ includeRetired: true });
  } catch (err) {
    logger.warn('Resource library could not be read; suggestions are shown without chips', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export class SuggestResourceCapability extends BaseCapability<SuggestArgs, ResourceSuggestion> {
  readonly slug = SUGGEST_RESOURCE_SLUG;
  readonly functionDefinition = SUGGEST_RESOURCE_DEFINITION;
  protected readonly schema = argsSchema;
  /** An id in, a library record out: nothing personal passes through. */
  readonly processesPii = false;

  // One indexed read of the one id asked for.
  async execute(
    args: SuggestArgs,
    _context: CapabilityContext
  ): Promise<CapabilityResult<ResourceSuggestion>> {
    const suggestion = await findResource(args.id);
    if (!suggestion) {
      return this.error(
        `No resource with id "${args.id}". Use an id from the list of resources in your context, or suggest nothing.`,
        'unknown_resource'
      );
    }
    return this.success(suggestion);
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
 * the library still has. A resource retired after the turn still resolves,
 * because the library is read with its retired resources for exactly this
 * (t-91), and resources are never deleted. Order is the traces' order.
 *
 * Each takes the library the caller read once ({@link loadLibraryForChips});
 * `null` resolves nothing.
 */
// Trimmed as the capability's own schema trims: the trace persists the model's
// RAW argument, so an id that answered live with padding must resolve the same
// way on reload (security review).
const suggestionArgsSchema = z.object({ id: z.string().trim() });

/**
 * The suggestion one answered call made, or `null` — for a call of another
 * capability, or an id the library no longer has.
 */
export function suggestionForCall(
  call: AnsweredCall,
  library: ResourcesLibrary | null
): ResourceSuggestion | null {
  if (call.slug !== SUGGEST_RESOURCE_SLUG || library === null) return null;
  const args = suggestionArgsSchema.safeParse(call.arguments);
  return args.success ? findIn(library, args.data.id) : null;
}

/**
 * One entry per answered call, aligned with `answeredCapabilities()`'s order:
 * the suggestion that call made, or `null`. A replay needs the alignment, so
 * the data lands on the right slug's frame; the transcript read keeps the
 * non-null ones.
 */
export function suggestionsByCall(
  provenance: unknown,
  library: ResourcesLibrary | null
): (ResourceSuggestion | null)[] {
  return answeredCalls(provenance).map((call) => suggestionForCall(call, library));
}

export function suggestionsFromProvenance(
  provenance: unknown,
  library: ResourcesLibrary | null
): ResourceSuggestion[] {
  return uniqueSuggestions(
    suggestionsByCall(provenance, library).filter((s): s is ResourceSuggestion => s !== null)
  );
}
