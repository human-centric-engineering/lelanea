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
 * @see lib/app/content/crisis-resources.ts — the authored table
 * @see .context/app/safety.md
 */

import type { ChatEvent } from '@/types/orchestration';
import { getCrisisResources } from '@/lib/app/content/crisis-resources';
import { ENDING_CRISIS } from '@/lib/app/agent/endings';

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

/** The resource for a locale and tier. Pure: authored content in, authored content out. */
export function resolveCrisisResource(
  locale: string | null,
  tier: 'hard' | 'soft'
): CrisisResource {
  const file = getCrisisResources();
  const wanted = regionOfLocale(locale);
  const entry = wanted ? file.regions.find((r) => r.region === wanted) : undefined;

  const services: CrisisService[] = entry
    ? entry.services.map((s) => ({ name: s.name, contact: s.contact, hours: s.hours }))
    : [];
  // The directory is listed everywhere, last where a region is known: it is
  // always right, and a person travelling may need it.
  services.push({
    name: file.international.name,
    contact: file.international.contact,
    hours: file.international.hours,
    url: file.international.url,
  });

  return {
    tier,
    region: entry ? entry.region : null,
    intro: tier === 'hard' ? file.copy.hardIntro : file.copy.softIntro,
    services,
    emergency: entry ? `${file.copy.emergency} (${entry.emergencyNumber})` : file.copy.emergency,
    keptMessage: tier === 'hard' ? file.copy.keptMessage : null,
    status: file.resources.provenance.status,
    version: file.resources.version,
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
