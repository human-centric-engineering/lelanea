/**
 * Publish the journey map — the recommended spine over the seventeen modules.
 *
 * `db:reset` and CI run `db:seed` without booting the app, so the framework's
 * boot sequence never runs and the `Module` rows a map's `moduleSlug`s point at
 * would not exist. Daybreak's `_framework/000-framework-boot.ts` sorts before
 * this directory and materialises them on a fresh database; on a database it
 * has already applied to, an incremental `db:seed` skips it, so this unit
 * calls `syncFrameworkForSeed` itself at the top of `run()` — the documented
 * remedy, and the reason a leaf seed that needs framework rows never assumes
 * them (#158).
 *
 * ## The row this writes, and who owns it (fp4)
 *
 * **A pure code projection, for now.** The published version is rebuilt from
 * the code roster (`lib/app/journey/roster.ts`) through
 * `buildJourneyMapDefinition()` every time this unit runs, and the unit re-runs
 * whenever the roster, the builder, or the slug rule changes (`hashInputs`).
 * The map carries no titles, so an edit to her words (`app_journey_*`, t-87)
 * never re-publishes it. Nobody has edited this map in Daybreak's map editor;
 * the day Lelañea does, that edit is what this seed would overwrite on its next
 * run. **That first edit is the trigger to reclassify the row as
 * operator-owned**: at that point this seed should create the map only when
 * absent and never publish over an existing version, and the roster stops
 * being the source of the graph's shape.
 *
 * ## Idempotent, safe on empty, no timestamp churn
 *
 * - **No map yet** → `createGraph` with the definition, which validates and
 *   publishes v1 atomically.
 * - **Map exists, nothing published** (someone created an empty map by hand) →
 *   `publishDefinition` with `expectedBaseVersion: null`, so a concurrent first
 *   publish aborts this one rather than being overwritten.
 * - **Published and equal** → write nothing. The comparison is a deep-equal of
 *   the parsed definitions, not of JSON text: jsonb does not keep key order,
 *   and the framework materialises defaults on parse, so text would differ on
 *   every run and re-publish a version that changed nothing.
 * - **Published and different** → `publishDefinition` pinned to the version we
 *   compared against, so the guard inside the write transaction refuses to
 *   publish over something that moved in between.
 *
 * Every publish goes through `validatePublishableMap` — Zod shape, referential
 * integrity, graph invariants — inside the version service; this unit never
 * writes a version row itself.
 *
 * `createdBy` on graph and version is the service account, as every other seed
 * signs its rows. A re-publish carries a change summary saying where the shape
 * came from; the create path cannot — `createGraph` stamps v1 "Initial version".
 */

import { isDeepStrictEqual } from 'node:util';

import type { SeedUnit } from '@/prisma/runner';
import { serviceAccountWhere } from '@/lib/auth/account';
import { syncFrameworkForSeed } from '@/lib/framework/seed';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { getJourneyStructure } from '@/lib/app/content/journey-store';
import { JOURNEY_MAP_SLUG, buildJourneyMapDefinition } from '@/lib/app/journey/map-definition';
import {
  createGraph,
  getPublishedMap,
  publishDefinition,
} from '@/lib/framework/facilitation/map/version-service';
import { graphExists } from '@/lib/framework/facilitation/map/queries';

const unit: SeedUnit = {
  name: 'app-lelanea/001-journey-map',
  // Every input the published shape is derived from: the roster, the builder,
  // and the slug rule. The seed's own source is always hashed; these are the
  // files it delegates to. Relative to this file, as the runner requires. Not
  // the journey's text: the map carries none of it (t-87).
  hashInputs: [
    '../../../lib/app/journey/roster.ts',
    '../../../lib/app/journey/map-definition.ts',
    '../../../lib/app/modules/definitions.ts',
  ],
  async run({ prisma, logger }) {
    logger.info('🗺️  Publishing the journey map...');

    // Module rows first — see the header. Throws where boot would log, so a
    // failure here fails the seed rather than recording it as applied.
    await syncFrameworkForSeed({ registerLeaf: initLeafApp });

    const admin = await prisma.user.findFirst({ where: serviceAccountWhere, select: { id: true } });
    if (!admin) {
      throw new Error('No service account found — ensure 001-system-owner runs first.');
    }

    const definition = buildJourneyMapDefinition();
    const changeSummary = 'Seeded from the journey roster (lib/app/journey/roster.ts)';

    const published = await getPublishedMap(JOURNEY_MAP_SLUG);

    if (published && isDeepStrictEqual(published.definition, definition)) {
      logger.info(`✓ Journey map unchanged at v${published.version} — nothing written`);
      return;
    }

    if (!published && !(await graphExists(JOURNEY_MAP_SLUG))) {
      // The map's name and description are the journey's, read from its row.
      // Migrations run before the seed, so the row is there (t-87).
      const { collection } = await getJourneyStructure();
      const graph = await createGraph({
        slug: JOURNEY_MAP_SLUG,
        name: collection.title,
        description: collection.subtitle,
        definition,
        userId: admin.id,
      });
      logger.info(`✓ Journey map "${graph.slug}" created and published as v1`);
      return;
    }

    const result = await publishDefinition({
      slug: JOURNEY_MAP_SLUG,
      definition,
      createdBy: admin.id,
      actorUserId: admin.id,
      // Pinned to what we compared against: null when the map existed with no
      // published version, else that version. A concurrent publish aborts us.
      expectedBaseVersion: published?.version ?? null,
      changeSummary,
    });
    logger.info(
      `✓ Journey map published as v${result.version.version}` +
        (published ? ` (was v${published.version})` : ' (map existed with no published version)')
    );
  },
};

export default unit;
