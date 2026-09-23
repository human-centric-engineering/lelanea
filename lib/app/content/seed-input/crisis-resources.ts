/**
 * The crisis resources as drafted: where a person in danger is pointed, by
 * region (f-safety t-58; product description §12).
 *
 * **Seed input, and nothing else.** The turn path reads `app_crisis_resource`
 * through `lib/app/safety/resources-store.ts` and throws when the tables cannot
 * answer — t-88 removed the fallback to this file on the owner's ruling
 * (2026-09-22), because a floor that quietly answers from a stale bundle is
 * worse than a crisis path that fails loudly. So an edit here reaches a
 * database that has never been seeded, and nothing else: changing what a person
 * in danger is shown is an admin edit or a migration
 * (`.context/app/database-changes.md`).
 *
 * Its callers are `prisma/seeds/app-lelanea/010-crisis-resources.ts` and tests.
 * Nothing under `app/`, `components/` or the rest of `lib/` may reach this
 * module — `tests/unit/lib/app/content/runtime-import-graph.test.ts` fails on
 * the path, naming it.
 *
 * **It ships as a draft.** `provenance.status` is `draft` and the accessor
 * returns it, so every surface that shows the resource can show that it is
 * awaiting sign-off. The schema admits nothing but `draft` and `signed_off`.
 *
 * @see lib/app/safety/resources-store.ts — what the turn path actually reads
 * @see lib/app/safety/resource.ts — which entry a request gets
 * @see .context/app/safety.md
 */

import { z } from 'zod';

import rawCrisisResources from '@/seed-data/drafted/lelanea_crisis_resources.json';
import { deepFreezeParsed } from '@/lib/app/content/deep-freeze';

const serviceSchema = z.strictObject({
  name: z.string().trim().min(1),
  /** What the person does: "Call 116 123", "Text SHOUT to 85258". */
  contact: z.string().trim().min(1),
  hours: z.string().trim().min(1),
});

export const crisisResourcesFileSchema = z.strictObject({
  resources: z.strictObject({
    id: z.literal('lelanea_crisis_resources'),
    title: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+$/),
    locale: z.string().min(1),
    provenance: z.strictObject({
      status: z.enum(['draft', 'signed_off']),
      awaitingSignOffFrom: z.string().min(1),
      note: z.string().min(1),
    }),
    notes: z.array(z.string().min(1)),
  }),
  copy: z.strictObject({
    hardIntro: z.string().trim().min(1),
    softIntro: z.string().trim().min(1),
    emergency: z.string().trim().min(1),
    keptMessage: z.string().trim().min(1),
  }),
  international: serviceSchema.extend({ url: z.url() }),
  regions: z
    .array(
      z.strictObject({
        /** ISO 3166-1 alpha-2, upper case — compared against a locale's region subtag. */
        region: z.string().regex(/^[A-Z]{2}$/),
        emergencyNumber: z.string().trim().min(1),
        services: z.array(serviceSchema).min(1),
      })
    )
    .min(1)
    .refine((regions) => new Set(regions.map((r) => r.region)).size === regions.length, {
      message: 'each region may appear once',
    }),
});

export type CrisisResourcesFile = z.infer<typeof crisisResourcesFileSchema>;

let parsed: CrisisResourcesFile | null = null;

/** The whole file, validated and frozen. Throws if the file is malformed. */
export function getCrisisResources(): CrisisResourcesFile {
  parsed ??= deepFreezeParsed(crisisResourcesFileSchema.parse(rawCrisisResources));
  return parsed;
}
