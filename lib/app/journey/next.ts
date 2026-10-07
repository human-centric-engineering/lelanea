/**
 * The journey view's "What's next" signpost, read from where the person
 * stands on the map (f-journey-record t-148; product description §3.16).
 *
 * It is a signpost, not a session: the timeline pins it last and never counts
 * it. It points at the module the person is in, or failing that the first one
 * in the spine's order they have not finished. Nothing has been decided about
 * what comes next, and every module stays enterable (`map.ts`), so the copy
 * says where the spine goes, never that the person must go there.
 *
 * Portable (no database, no `next/*`): `map.ts` reads, this decides.
 */

import type { JourneyMapView } from '@/lib/app/journey/map';
import { modulePath } from '@/lib/app/journey/paths';

export interface JourneySignpost {
  slug: string;
  /** `01 · Values`, as a module tag reads. */
  label: string;
  href: string;
  /** `current`: the person is in it. `next`: the spine's next unfinished module. */
  standing: 'current' | 'next';
}

/** `01 · Values`: the authored number, then the title. */
export function moduleLabel(module: { displayNumber: string; title: string }): string {
  return `${module.displayNumber} · ${module.title}`;
}

/**
 * Where the signpost points, or null when there is nowhere to point: no map is
 * published, or every module is done.
 */
export function whatIsNext(map: JourneyMapView | null): JourneySignpost | null {
  if (!map) return null;
  const current = map.modules.find((module) => module.state === 'current');
  const target = current ?? map.modules.find((module) => module.state !== 'done');
  if (!target) return null;
  return {
    slug: target.slug,
    label: moduleLabel(target),
    href: modulePath(target.slug),
    standing: current ? 'current' : 'next',
  };
}
