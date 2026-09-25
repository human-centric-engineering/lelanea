/**
 * Crisis resource validation — what an admin may write, and what a stored row
 * must look like to be served (f-safety t-63).
 *
 * The same shapes guard both directions. A write that fails is refused 400; a
 * stored row that fails on the read path (someone edited it by hand) sends the
 * whole resource to fail, in `lib/app/safety/resources-store.ts` — there is
 * no bundled fallback beneath it since t-88, which is why these schemas are
 * the same ones every write route validates against.
 *
 * The bounds are on typos, not policy: a person in danger reads every word of
 * this, so an intro is a few sentences and a service a line.
 *
 * @see lib/app/safety/crisis-admin.ts — what these schemas feed
 */

import { z } from 'zod';

/** Most services one region may list. The directory is added after them. */
export const MAX_SERVICES_PER_REGION = 8;

const line = (label: string, max = 200) =>
  z
    .string()
    .trim()
    .min(1, `${label} cannot be empty.`)
    .max(max, `${label} is longer than ${max} characters.`);

/** ISO 3166-1 alpha-2, upper-cased — the form a locale's region subtag is compared in. */
export const regionCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, 'A region is a two-letter country code, such as GB.')
  .transform((code) => code.toUpperCase());

export const crisisServiceSchema = z.strictObject({
  name: line('A service name', 120),
  /** What the person does: "Call 116 123", "Text SHOUT to 85258". */
  contact: line('How to reach them', 120),
  hours: line('When they answer', 160),
});

export const crisisServicesSchema = z
  .array(crisisServiceSchema)
  .min(1, 'A region needs at least one service. Remove the region instead.')
  .max(MAX_SERVICES_PER_REGION, `A region may list at most ${MAX_SERVICES_PER_REGION} services.`);

/** Adding a region: the code, its emergency number, its services. */
export const crisisRegionCreateSchema = z.strictObject({
  region: regionCodeSchema,
  emergencyNumber: line('The emergency number', 40),
  services: crisisServicesSchema,
});

/** Editing a region: everything but the code, every time. */
export const crisisRegionUpdateSchema = crisisRegionCreateSchema.omit({ region: true });

/** The shared copy and the directory — all of it, every time. */
export const crisisCopyUpdateSchema = z.strictObject({
  hardIntro: line('The hard-tier intro', 600),
  softIntro: line('The soft-tier intro', 600),
  emergency: line('The emergency line', 300),
  keptMessage: line('The "your message is kept" line', 300),
  internationalName: line('The directory name', 120),
  internationalContact: line('How to reach the directory', 120),
  internationalUrl: z
    .url({ protocol: /^https$/, error: 'The directory link must be an https:// address.' })
    .max(300),
  internationalHours: line('The directory description', 160),
});

/** The version the admin read, sent with every save and sign-off. */
const versionRead = z.number().int().positive();

/**
 * A save names the version it was edited from. If another admin saved in
 * between, it is refused 409 rather than silently putting their change back —
 * the lost update a wrong emergency number would ride in on.
 */
export const crisisCopySaveSchema = crisisCopyUpdateSchema.extend({ version: versionRead });
export const crisisRegionSaveSchema = crisisRegionUpdateSchema.extend({ version: versionRead });

/**
 * A sign-off names the version it read. If someone edited in between, the
 * version has moved and the sign-off is refused — nobody signs off words they
 * did not see.
 */
export const crisisSignOffSchema = z.strictObject({ version: versionRead });

export type CrisisService = z.infer<typeof crisisServiceSchema>;
export type CrisisRegionCreate = z.infer<typeof crisisRegionCreateSchema>;
export type CrisisRegionUpdate = z.infer<typeof crisisRegionUpdateSchema>;
export type CrisisCopyUpdate = z.infer<typeof crisisCopyUpdateSchema>;

// ─── The file ───────────────────────────────────────────────────────────────

/** The one identity a crisis resources file may carry. */
export const CRISIS_RESOURCES_FILE_ID = 'lelanea_crisis_resources';

/**
 * The crisis resources as a file: what the seed reads from
 * `seed-data/drafted/lelanea_crisis_resources.json`, what the admin export
 * writes and what its import reads (f-content-seeds t-92).
 *
 * Here rather than beside the seed's loader, because the import is reached by a
 * request and nothing a request reaches may import `lib/app/content/seed-input/`
 * (t-89). Built from the write schemas above, so a file can only put into the
 * tables what an admin could have typed there, and nothing the read path
 * (`contentFromRows`) would then refuse to serve.
 *
 * **Only `resources.id` is required of the header.** The title, version, locale,
 * notes and provenance are about the drafted file and are not stored, so an
 * export leaves them out rather than invent them. The provenance's `status` is
 * read by the seed alone, as this environment's first write; an import never
 * carries a sign-off across (`lib/app/safety/resources-admin.ts`).
 */
export const crisisResourcesFileSchema = z.strictObject({
  resources: z.strictObject({
    id: z.literal(CRISIS_RESOURCES_FILE_ID),
    title: z.string().min(1).optional(),
    version: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional(),
    locale: z.string().min(1).optional(),
    provenance: z
      .strictObject({
        status: z.enum(['draft', 'signed_off']),
        awaitingSignOffFrom: z.string().min(1),
        note: z.string().min(1),
      })
      .optional(),
    notes: z.array(z.string().min(1)).optional(),
  }),
  copy: crisisCopyUpdateSchema.pick({
    hardIntro: true,
    softIntro: true,
    emergency: true,
    keptMessage: true,
  }),
  international: z.strictObject({
    name: crisisCopyUpdateSchema.shape.internationalName,
    contact: crisisCopyUpdateSchema.shape.internationalContact,
    url: crisisCopyUpdateSchema.shape.internationalUrl,
    hours: crisisCopyUpdateSchema.shape.internationalHours,
  }),
  regions: z
    .array(
      z.strictObject({
        // Upper case as written, not transformed: a file is the stored shape, and
        // a lower-case code in one would be a different key from the stored row.
        region: z.string().regex(/^[A-Z]{2}$/, 'A region is a two-letter upper-case code.'),
        emergencyNumber: crisisRegionCreateSchema.shape.emergencyNumber,
        services: crisisServicesSchema,
      })
    )
    .min(1)
    .refine((regions) => new Set(regions.map((r) => r.region)).size === regions.length, {
      message: 'each region may appear once',
    }),
});

export type CrisisResourcesFile = z.infer<typeof crisisResourcesFileSchema>;
