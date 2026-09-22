/**
 * What the agent may offer, put in front of it — the resources library as the
 * model reads it (f-resources t-77).
 *
 * ## Why this exists: a tool nobody is told about is never used
 *
 * f-slots learned it the hard way (`lib/app/slots/vocabulary.ts`): granting
 * `fill_slot` did not make the agent fill an authored slot, because nothing in
 * the platform tells a model which names exist. The same holds here. The tool's
 * schema asks for "an id from the list of resources in your context"; this is
 * that list. Without it the model has an argument to fill and nothing to fill
 * it with, and the honest outcomes are that it never calls the tool or that it
 * invents an id and is refused.
 *
 * ## Why it is in the prompt, not the tool schema
 *
 * The same reason as the vocabulary's: an `enum` of ids on the schema would be
 * the right place, but the advertised schema is the `ai_capability` row, which
 * our seed re-applies on every run — so the ids would go stale between the
 * file changing and the next reseed. Read here per turn, the list is the file's
 * as deployed, and an empty file offers nothing rather than a stale something.
 *
 * ## One line per resource, flattened
 *
 * `buildContext` frames the block with a fence at column 0, and a title or a
 * subtitle is authored text. Every field is collapsed to one line so nothing
 * from the file can reach column 0 except the `- ` this writes — the
 * vocabulary block's rule, for the vocabulary block's reason.
 *
 * ## Empty when there is nothing to offer, and that is deliberate
 *
 * Until Lelañea Fulton's list lands (t-76) both lists are empty, and the block
 * is `''`: no heading over nothing, no note saying a list exists and is being
 * withheld — which would be an invitation to invent. With no block the agent
 * cannot suggest, which is the truth.
 *
 * @see lib/app/voice/context-contributor.ts — the block this is spliced into
 * @see lib/app/resources/suggest.ts — the tool the ids are for
 */

import { getJourneyStructure } from '@/lib/app/content';
import { getResourcesLibrary } from '@/lib/app/content/resources';

/**
 * The heading, and the rule that travels with the list — here rather than only
 * in the tool's description because this is where a model weighing "does
 * anything here fit?" is looking.
 */
const HEADING = 'Films and writing of Lelañea’s you may offer this person, by id:';

const RULE = [
  'Offer one of these only when it genuinely fits what the person is working',
  'through right now — most turns need none, and two at once is a reading list,',
  'not a suggestion. Use the tool with the id exactly as written; never invent',
  'an id, and never describe a film or a piece in your own words as if it were',
  'hers. The person sees what you offered beside your reply and can open it.',
].join('\n');

/** Any run of whitespace to one space — nothing authored may reach column 0. */
function flatten(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** `[Values]`, `[the journey]`, `[life situations]`, or nothing for a general piece. */
function belongs(relatesTo: string | null, titles: ReadonlyMap<string, string>): string {
  if (relatesTo === null) return '';
  const title = titles.get(relatesTo) ?? relatesTo;
  return ` [${flatten(title)}]`;
}

/**
 * The offering block, or `''` when the library holds nothing to offer.
 *
 * Synchronous: the library and the structure are parsed once and memoised.
 * Wrapped in the same degrade-to-nothing the vocabulary uses, because a throw
 * from a contributor blanks the WHOLE block, voice and all.
 */
export function resourceOffering(): string {
  const library = getResourcesLibrary();
  if (library.films.length === 0 && library.readings.length === 0) return '';

  const titles = new Map<string, string>(
    getJourneyStructure().modules.map((m) => [m.id, m.title] as const)
  );
  titles.set('journey', 'the journey');
  titles.set('situations', 'life situations');

  const lines = [
    ...library.films.map(
      (f) =>
        `- ${flatten(f.id)} (film, ${flatten(f.duration)}): ${flatten(f.title)} — ${flatten(f.subtitle)}${belongs(f.relatesTo, titles)}`
    ),
    ...library.readings.map(
      (r) =>
        `- ${flatten(r.id)} (reading, ${flatten(r.readingTime)}): ${flatten(r.title)} — ${flatten(r.subtitle)}${belongs(r.relatesTo, titles)}`
    ),
  ];

  return [HEADING, '', ...lines, '', RULE].join('\n');
}
