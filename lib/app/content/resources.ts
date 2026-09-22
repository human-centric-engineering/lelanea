/**
 * The resources: her films and reading, and her words on whatever is open
 * (f-resources t-74; product description §6.1, §9 Resources).
 *
 * **The shapes and the selection, pure.** Since t-87 the library is stored in
 * `app_resource_collection`, `app_resource` and `app_resource_words`, and read
 * through `@/lib/app/content/resource-store`. What is left here imports no
 * database and no file: the schemas every write and read is checked against,
 * the served shapes, and the prototype's selection rule as a pure function. The
 * seed reads the drafted file through `@/lib/app/content/resources-seed`.
 *
 * ## The shape
 *
 * Three lists, keyed the way the journey keys its modules (`module_01_values`)
 * plus three fixed keys — `journey`, `situations` and `default`:
 *
 * - `films` and `readings`: what each is for, in her words, and which key it
 *   belongs beside (`relatesTo`; `null` for a piece that belongs to everything).
 *   A film links out. A reading is a foundational document or a link, never
 *   both. **No thumbnails**: nothing exists to show, and an invented one is what
 *   D6 forbids.
 * - `words`: per key, a quote and a few short paragraphs — **verbatim excerpts
 *   of a source this repository already holds**, each citing that source.
 *   Nothing here is drafted in her register. The drawer's eyebrow says these are
 *   her words, so they are, and `resources.test.ts` proves each passage in the
 *   seed occurs character for character in what it cites. The voice
 *   fingerprint's drafted-with-provenance precedent does not transfer: that file
 *   *describes* her voice; this one is shown *as* it.
 *
 * ## The selection is the prototype's
 *
 * {@link selectResources} implements `lelanea.html`'s `pickFor` and
 * `resourceKey`: what belongs to the open thing first, then what belongs to
 * everything, capped at two films and three readings — "the drawer is for one
 * thing at a time". A key with no words of its own reads `default`'s. A film or
 * a reading may be pinned to the front of its list, which is how a suggestion
 * made in conversation opens the drawer on the thing suggested (t-77).
 *
 * The shell asks by **slug** (`values`), which is what its routes carry; the
 * library keys by **id** (`module_01_values`), which is what every other
 * collection keys by. `moduleSlugFromId` is the one rule between them, and it is
 * used here rather than re-derived.
 *
 * **It ships as a draft.** The two passages are the builder's pick of her
 * material and both lists are empty; `provenance` says so and is served rather
 * than withheld. Her list lands in t-76.
 *
 * @see lib/app/content/resource-store.ts — the reads and writes
 * @see app/api/v1/app/content/resources — the HTTP surface
 * @see .context/app/content.md
 */

import { z } from 'zod';

import type { DeepReadonly } from '@/lib/app/content/journey-view';
import type { ModuleTier } from '@/lib/app/content/schemas';
import { moduleSlugFromId } from '@/lib/app/modules/definitions';

// ============================================================================
// Schema
// ============================================================================

/** The three keys that are not modules, and the one every key falls back to. */
export const FIXED_RESOURCE_KEYS = ['journey', 'situations', 'default'] as const;
export type FixedResourceKey = (typeof FIXED_RESOURCE_KEYS)[number];

/** How many of each the drawer shows — the prototype's `pickFor(…, 2)` / `(…, 3)`. */
export const FILMS_SHOWN = 2;
export const READINGS_SHOWN = 3;

/** A module id as the structure file writes it, or one of the fixed keys. */
const moduleIdPattern = /^module_\d{2}_[a-z0-9_]+$/;
export const resourceKeySchema = z
  .string()
  .refine((key) => moduleIdPattern.test(key) || FIXED_RESOURCE_KEYS.some((k) => k === key), {
    message: 'a resource key is a module id (module_NN_words) or journey | situations | default',
  });

/**
 * Where a piece belongs: a module, the journey, situations — or `null` for a
 * piece that belongs to everything.
 *
 * **Not `default`.** For `words`, `default` means "the fallback every key
 * reads"; for a piece, "belongs to everything" is spelled `null`, and the
 * picker matches a piece by its own key or by `null` — so a film tagged
 * `default` would parse clean and show for nothing but the literal `default`
 * key. Refused here rather than left to be discovered as a missing film
 * (`/code-review` round 1).
 */
export const relatesToSchema = z
  .string()
  .refine((key) => moduleIdPattern.test(key) || key === 'journey' || key === 'situations', {
    message:
      'relatesTo is a module id (module_NN_words), journey, situations, or null for a piece that belongs to everything — never default',
  })
  .nullable();

// Bounded to what the suggestion tool accepts (`suggest.ts`, 80): an id the
// offering lists but the tool refuses would be offered and then rejected at
// validation, with nothing on the panel saying why (`/code-review` round 2).
export const resourceIdSchema = z
  .string()
  .max(80, { message: 'a resource id is at most 80 characters — the suggestion tool’s bound' })
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'a resource id is lowercase alphanumeric with hyphens',
  });

/**
 * A link a client will put in an `<a href>`. `z.url()` alone admits any scheme
 * — `javascript:` included — and a content file is reviewed for its words, not
 * its schemes, so the schema holds the line: http(s) only.
 */
const linkSchema = z.url({ protocol: /^https?$/ });

export const filmSchema = z.strictObject({
  id: resourceIdSchema,
  title: z.string().trim().min(1),
  /** What it is for, in her words — the line under the title. */
  subtitle: z.string().trim().min(1),
  relatesTo: relatesToSchema,
  /** As shown: `6:12`. */
  duration: z.string().regex(/^\d{1,2}:\d{2}$/, { message: 'duration is m:ss' }),
  href: linkSchema,
});

const readingBase = z.strictObject({
  id: resourceIdSchema,
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1),
  relatesTo: relatesToSchema,
  /** As shown: `8 min`. */
  readingTime: z.string().regex(/^\d{1,3} min$/, { message: 'readingTime is "N min"' }),
});

/** A reading is a foundational document OR a link — the union makes "neither" and "both" unrepresentable. */
export const readingSchema = z.union([
  readingBase.extend({ documentId: z.string().min(1) }),
  readingBase.extend({ href: linkSchema }),
]);

/**
 * Where a passage was taken from. `foundational_documents` names a document id
 * (checked against the collection at parse); `values_module` names a step id
 * (checked, and the text proven verbatim, in `resources.test.ts` — the values
 * loader is kept out of this module's graph on purpose, see `values.ts`).
 */
const wordsSourceSchema = z.strictObject({
  collection: z.enum(['foundational_documents', 'values_module']),
  id: z.string().min(1),
});

export const wordsSchema = z.strictObject({
  quote: z.string().trim().min(1),
  paragraphs: z.array(z.string().trim().min(1)).min(1),
  source: wordsSourceSchema,
});

/** Whether she has signed off what is in the library. */
export const provenanceSchema = z.strictObject({
  status: z.enum(['draft', 'signed_off']),
  awaitingSignOffFrom: z.string().min(1),
  note: z.string().min(1),
});
export type ResourcesProvenance = z.infer<typeof provenanceSchema>;

const resourcesFileBase = z.strictObject({
  resources: z.strictObject({
    id: z.literal('lelanea_resources'),
    title: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+$/),
    locale: z.string().min(1),
    provenance: provenanceSchema,
    notes: z.array(z.string().min(1)),
  }),
  films: z.array(filmSchema),
  readings: z.array(readingSchema),
  /** `default` is required: it is what every key without words of its own reads. */
  words: z
    .record(resourceKeySchema, wordsSchema)
    .refine((words) => 'default' in words, { message: 'words.default is required' }),
});

/**
 * The referential checks structure alone cannot make: every key names a module
 * on the structure file or a fixed key; every `documentId` is a document; ids
 * are unique within each list. Parameterised on the two id sets so the schema
 * can be exercised on fixtures without the real files.
 */
export function buildResourcesFileSchema(known: {
  moduleIds: ReadonlySet<string>;
  documentIds: ReadonlySet<string>;
}): z.ZodType<ResourcesFile> {
  const isKey = (key: string): boolean =>
    known.moduleIds.has(key) || FIXED_RESOURCE_KEYS.some((k) => k === key);
  /** A piece's key: the shape check above already refused `default`. */
  const isPieceKey = (key: string): boolean => isKey(key) && key !== 'default';

  return resourcesFileBase.superRefine((file, ctx) => {
    for (const [index, film] of file.films.entries()) {
      if (film.relatesTo !== null && !isPieceKey(film.relatesTo)) {
        ctx.addIssue({
          code: 'custom',
          path: ['films', index, 'relatesTo'],
          message: `film "${film.id}" relates to unknown key "${film.relatesTo}"`,
        });
      }
    }
    for (const [index, reading] of file.readings.entries()) {
      if (reading.relatesTo !== null && !isPieceKey(reading.relatesTo)) {
        ctx.addIssue({
          code: 'custom',
          path: ['readings', index, 'relatesTo'],
          message: `reading "${reading.id}" relates to unknown key "${reading.relatesTo}"`,
        });
      }
      if ('documentId' in reading && !known.documentIds.has(reading.documentId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['readings', index, 'documentId'],
          message: `reading "${reading.id}" names unknown document "${reading.documentId}"`,
        });
      }
    }
    for (const [key, words] of Object.entries(file.words)) {
      if (!isKey(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['words', key],
          message: `words keyed to unknown key "${key}"`,
        });
      }
      if (
        words.source.collection === 'foundational_documents' &&
        !known.documentIds.has(words.source.id)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['words', key, 'source', 'id'],
          message: `words for "${key}" cite unknown document "${words.source.id}"`,
        });
      }
    }
    // One namespace across BOTH lists, not one per list: an id is what the
    // suggestion tool and the drawer's pin resolve by, and a film and a
    // reading sharing one would always resolve to the film (`/code-review`).
    const seen = new Set<string>();
    for (const [list, items] of [
      ['films', file.films],
      ['readings', file.readings],
    ] as const) {
      for (const [index, item] of items.entries()) {
        if (seen.has(item.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [list, index, 'id'],
            message: `duplicate resource id "${item.id}" — ids are one namespace across films and readings`,
          });
        }
        seen.add(item.id);
      }
    }
  });
}

export type ResourcesFile = z.infer<typeof resourcesFileBase>;
export type ResourceFilm = ResourcesFile['films'][number];
export type ResourceReading = ResourcesFile['readings'][number];
export type ResourceWords = ResourcesFile['words'][string];

// ============================================================================
// Served shapes
// ============================================================================

/** The collection's identity and the provenance of what it holds — served, never withheld. */
export interface ResourcesCollectionMeta {
  id: string;
  title: string;
  version: string;
  locale: string;
  provenance: DeepReadonly<ResourcesProvenance>;
}

/** A film as served: the authored shape, and how many times it has been written. */
export type ResourceFilmView = ResourceFilm & { revision: number };
/** A reading as served. */
export type ResourceReadingView = ResourceReading & { revision: number };
/** One key's words as served. */
export type ResourceWordsView = ResourceWords & { revision: number };

/** The library: everything, for browsing directly (§9 "browsable directly"). */
export interface ResourcesLibrary {
  collection: ResourcesCollectionMeta;
  /** In their authored order. */
  films: readonly DeepReadonly<ResourceFilmView>[];
  readings: readonly DeepReadonly<ResourceReadingView>[];
  words: DeepReadonly<Record<string, ResourceWordsView>>;
}

/** What the drawer shows for one open thing. */
export interface ResourcesSelection {
  collection: ResourcesCollectionMeta;
  /** As asked: a module slug, `journey`, `situations` or `default`. */
  key: string;
  /** What the drawer's lede names: the module's title, or the fixed key's. */
  title: string;
  /** The module's arc, for the drawer's tone; `null` for a fixed key. */
  tier: ModuleTier | null;
  /** Her words on it — or `default`'s, when it has none of its own. */
  words: DeepReadonly<ResourceWordsView>;
  /** Whether `words` are this key's own or the fallback. */
  wordsAreOwn: boolean;
  films: readonly DeepReadonly<ResourceFilmView>[];
  readings: readonly DeepReadonly<ResourceReadingView>[];
}

/** The fixed keys' titles — the prototype's `renderResources` names them so. */
const FIXED_TITLES: Readonly<Record<FixedResourceKey, string>> = {
  journey: 'The journey',
  situations: 'Life situations',
  default: 'Lelañea',
};

function isFixedKey(key: string): key is FixedResourceKey {
  return FIXED_RESOURCE_KEYS.some((k) => k === key);
}

/**
 * What belongs to this key first, then what belongs to everything — the
 * prototype's `pickFor`. A pinned id, when it is in the list, goes to the front
 * and the cap still holds.
 */
function pickFor<T extends { id: string; relatesTo: string | null }>(
  list: readonly T[],
  key: string,
  max: number,
  pinned?: string
): T[] {
  const own = list.filter((item) => item.relatesTo === key);
  const general = list.filter((item) => item.relatesTo === null);
  const ordered = [...own, ...general];
  const pin = pinned === undefined ? undefined : list.find((item) => item.id === pinned);
  const withPin = pin ? [pin, ...ordered.filter((item) => item.id !== pin.id)] : ordered;
  return withPin.slice(0, max);
}

/** The three facts about a module the selection needs — `JourneyModuleView` has them. */
export interface ResourceModuleRef {
  id: string;
  title: string;
  tier: ModuleTier;
}

/**
 * The selection, as a pure function of the library and the module list, so a
 * test can hand it fixtures.
 *
 * `key` is what the shell has: a module **slug**, or `journey` / `situations` /
 * `default`. Returns `null` for anything else, so the route owns the 404 — a
 * typo is not a module with nothing to show, and the two must not look the
 * same. `pin` names a film or a reading to put first in its list (a suggestion
 * made in conversation, t-77).
 */
export function selectResources(
  library: ResourcesLibrary,
  modules: readonly ResourceModuleRef[],
  key: string,
  options: { pin?: string } = {}
): ResourcesSelection | null {
  let fileKey: string;
  let title: string;
  let tier: ModuleTier | null;
  if (isFixedKey(key)) {
    fileKey = key;
    title = FIXED_TITLES[key];
    tier = null;
  } else {
    const found = modules.find((m) => moduleSlugFromId(m.id) === key);
    if (!found) return null;
    fileKey = found.id;
    title = found.title;
    tier = found.tier;
  }

  const own = library.words[fileKey];
  // `default` is required on every write, so the fallback always resolves; the
  // `??` is there because a record index is typed as possibly absent.
  const words = own ?? library.words.default;
  if (!words) throw new Error('The resource library has no words for "default"');

  return {
    collection: library.collection,
    key,
    title,
    tier,
    words,
    wordsAreOwn: own !== undefined,
    films: pickFor(library.films, fileKey, FILMS_SHOWN, options.pin),
    readings: pickFor(library.readings, fileKey, READINGS_SHOWN, options.pin),
  };
}
