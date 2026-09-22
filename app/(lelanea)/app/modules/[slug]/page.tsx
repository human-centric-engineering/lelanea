import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';

import { RememberModule } from '@/components/app/views/remember-module';
import { ModuleView, UNWRITTEN_PARTS, type ModulePart } from '@/components/app/views/module-view';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import { getJourneyMap } from '@/lib/app/journey/map';
import type { JourneyStructure } from '@/lib/app/content';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';

interface Params {
  params: Promise<{ slug: string }>;
}

/**
 * One read per request, shared by `generateMetadata` and the page. Each call
 * is a query and a Zod parse of the published definition, and Next dedupes
 * only `fetch` — without this every module view (and every prefetch the
 * drawer's seventeen links trigger) paid it twice.
 *
 * Not unit-testable: `cache()` is a passthrough outside the React Server
 * Components runtime, so the harness sees two calls. The property holds where
 * it matters and nowhere a test can reach.
 */
const loadMap = cache(getJourneyMap);
const loadStructure = cache(getJourneyStructure);

/**
 * The page for one module — every module, since all seventeen have the same
 * empty interior this phase.
 *
 * Fed by the same read as the map drawer (`getJourneyMap()`): the route decides
 * whether a module exists by whether the PUBLISHED graph has it, not by whether
 * the structure file does, so a module in content that is not yet on the map
 * 404s here exactly as it is absent from the drawer. The two surfaces cannot
 * disagree about what is a place.
 *
 * Reads the authored phase tiers for the one module that has them (Values);
 * every other module gets the unnamed pair. Both reads are the journey's rows
 * (t-87): the map's titles and these phase tiers come from the same service.
 *
 * No `loading.tsx` in this segment or any above it — see `shell.md`, "No
 * Suspense boundary above `/app`": a fallback here would turn the shell's 404
 * into a soft one.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const map = await loadMap();
  const place = map?.modules.find((m) => m.slug === slug);
  return { title: place ? place.title : 'Module' };
}

export default async function ModulePage({ params }: Params) {
  const { slug } = await params;
  const map = await loadMap();
  const place = map?.modules.find((m) => m.slug === slug);
  if (!map || !place) notFound();

  const tier = map.tiers.find((t) => t.id === place.tier);
  if (!tier) notFound();

  return (
    <>
      <RememberModule
        slug={place.slug}
        displayNumber={place.displayNumber}
        title={place.title}
        tier={place.tier}
      />
      <ModuleView
        displayNumber={place.displayNumber}
        title={place.title}
        tierLabel={tier.label}
        tierIntent={tier.intent}
        parts={partsFor(await loadStructure(), place.slug)}
      />
    </>
  );
}

/**
 * Values shows its three authored phase tiers as parts — Orientation,
 * Discernment, Integration — each still a placeholder. Everything else gets
 * the unnamed pair, because naming them would be inventing the module.
 */
function partsFor(structure: JourneyStructure, slug: string): readonly ModulePart[] {
  const authored = structure.modules.find((m) => moduleSlugFromId(m.id) === slug);
  const phaseTiers = authored?.phaseTiers;
  if (!phaseTiers || phaseTiers.length === 0) return UNWRITTEN_PARTS;
  return [...phaseTiers]
    .sort((a, b) => a.order - b.order)
    .map((phaseTier) => ({
      id: phaseTier.id,
      label: phaseTier.label,
      summary: `${phaseTier.label}: phases ${phaseTier.phases[0]}–${phaseTier.phases[phaseTier.phases.length - 1]}. Not written yet.`,
    }));
}
