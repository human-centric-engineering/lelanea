/**
 * The resource a person in danger is shown, and the frame that carries it to
 * the client (f-safety t-58; product description §12).
 *
 * ## Which services
 *
 * Owner ruling, 19 Sept 2026: named services by country, with an international
 * directory plus "your local emergency number" as the fallback. Nothing records
 * where a person is, so the country is the region subtag of their language
 * preference: `en-GB` → `GB`. A tag with no region (`en`), a region the table
 * does not list, or no preference at all gets the fallback. **It never guesses
 * a country** — a wrong named number is worse than a directory that is always
 * right.
 *
 * ## The client contract
 *
 * One frame, `code: 'crisis'`, in the two shapes the platform's own validator
 * already accepts, plus a structured `resource`:
 *
 * | Tier   | Frame                          | Then                                        |
 * | ------ | ------------------------------ | ------------------------------------------- |
 * | `hard` | `{ type: 'error', code: 'crisis', message, resource }`   | nothing: the turn has ended |
 * | `soft` | `{ type: 'warning', code: 'crisis', message, resource }` | her turn, as usual          |
 *
 * `message` is the whole resource as plain text, so a client that knows nothing
 * of `resource` — or a validator that strips unknown keys — still shows every
 * name and number. f-conversation renders `resource` in her register.
 *
 * **A hard frame ends the turn the way every ending does:** no model turn is
 * written and what the person typed stays in the box (`endings.ts`).
 *
 * ## Where the words come from
 *
 * The admin-edited tables, and nothing else (f-safety t-63; the bundled
 * fallback removed in f-content-seeds t-88). `resources-store.ts` throws when
 * the tables cannot answer, so this module does too. Its docblock says why
 * that is the honest behaviour rather than a regression, and why the two
 * states that used to reach the fallback are now unreachable instead.
 *
 * @see lib/app/safety/resources-store.ts — the tables and the cache
 * @see .context/app/safety.md
 */

import type { ChatEvent } from '@/types/orchestration';
import { ENDING_CRISIS } from '@/lib/app/agent/endings';
import { loadCrisisContent, type CrisisContent } from '@/lib/app/safety/resources-store';

export interface CrisisService {
  name: string;
  contact: string;
  hours: string;
  url?: string;
}

/** What the client renders. Every string in it is authored, never a model's. */
export interface CrisisResource {
  tier: 'hard' | 'soft';
  /** The region the services were chosen for, or `null` for the international fallback. */
  region: string | null;
  intro: string;
  services: CrisisService[];
  /** Always present: the local emergency line, named where the region is known. */
  emergency: string;
  keptMessage: string | null;
  /** `draft` until Lelañea signs the wording and the numbers off. */
  status: 'draft' | 'signed_off';
  version: string;
}

export type CrisisFrame = (
  Extract<ChatEvent, { type: 'error' }> | Extract<ChatEvent, { type: 'warning' }>
) & { code: typeof ENDING_CRISIS; resource: CrisisResource };

/**
 * The region subtag of a language tag, upper-cased, or `null`.
 *
 * Only a two-letter region counts. `es-419` (Latin America) names no one
 * country, and a script subtag (`zh-Hant`) is not a region.
 */
export function regionOfLocale(locale: string | null): string | null {
  if (!locale) return null;
  const subtags = locale.split(/[-_]/).slice(1);
  const region = subtags.find((s) => /^[a-z]{2}$/i.test(s));
  return region ? region.toUpperCase() : null;
}

/**
 * The resource for a locale and tier.
 *
 * **Throws when the tables cannot answer** (t-88 removed the bundled floor) —
 * see `resources-store.ts` for why that is the honest behaviour.
 */
export async function resolveCrisisResource(
  locale: string | null,
  tier: 'hard' | 'soft'
): Promise<CrisisResource> {
  return resourceFromContent(await loadCrisisContent(), locale, tier);
}

/**
 * Signed off only when everything shown is: the shared copy, and the region's
 * services where a region was chosen. One draft part makes the whole a draft.
 */
function statusOf(content: CrisisContent, entry: CrisisContent['regions'][number] | undefined) {
  if (content.copyStatus !== 'signed_off') return 'draft';
  return entry && entry.status !== 'signed_off' ? 'draft' : 'signed_off';
}

/**
 * Which versions were shown: the copy's and, where one was chosen, the
 * region's — `c3` or `c3/GB.2` — so a report of what someone saw can be matched
 * to the audit log's edits.
 */
function versionOf(content: CrisisContent, entry: CrisisContent['regions'][number] | undefined) {
  const copy = `c${content.copyVersion}`;
  return entry ? `${copy}/${entry.region}.${entry.version}` : copy;
}

/** The resource built from one source's content. Pure. */
export function resourceFromContent(
  content: CrisisContent,
  locale: string | null,
  tier: 'hard' | 'soft'
): CrisisResource {
  const wanted = regionOfLocale(locale);
  const entry = wanted ? content.regions.find((r) => r.region === wanted) : undefined;

  const services: CrisisService[] = entry
    ? entry.services.map((s) => ({ name: s.name, contact: s.contact, hours: s.hours }))
    : [];
  // The directory is listed everywhere, last where a region is known: it is
  // always right, and a person travelling may need it.
  services.push({ ...content.international });

  return {
    tier,
    region: entry ? entry.region : null,
    intro: tier === 'hard' ? content.copy.hardIntro : content.copy.softIntro,
    services,
    emergency: entry
      ? `${content.copy.emergency} (${entry.emergencyNumber})`
      : content.copy.emergency,
    keptMessage: tier === 'hard' ? content.copy.keptMessage : null,
    status: statusOf(content, entry),
    version: versionOf(content, entry),
  };
}

/** The resource as plain text — the frame's `message`, readable with no renderer at all. */
export function crisisResourceText(resource: CrisisResource): string {
  const lines = [
    resource.intro,
    '',
    ...resource.services.map((s) => `• ${s.name} — ${s.contact} (${s.hours})`),
    '',
    resource.emergency,
  ];
  if (resource.keptMessage) lines.push('', resource.keptMessage);
  return lines.join('\n');
}

/** The frame that carries a resource to the client. See the module docblock for the contract. */
export function crisisFrame(resource: CrisisResource): CrisisFrame {
  return {
    type: resource.tier === 'hard' ? 'error' : 'warning',
    code: ENDING_CRISIS,
    message: crisisResourceText(resource),
    resource,
  };
}
