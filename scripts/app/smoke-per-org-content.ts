/**
 * Smoke: a second org holds the same content names as the install org (t-113,
 * t-114).
 *
 * **Why this exists rather than another unit test.** The per-org keys are
 * database constraints (`@@unique([orgId, slug])`), and the org every read and
 * write lands in is decided by Sunrise's tenancy client from the context. A
 * fake database agrees with whatever the test believes about both. This runs
 * the real seeds and admin writers against a real database, under two orgs.
 *
 * Flow:
 *   1. Create a throwaway org.
 *   2. In it, run the content, voice overlay, golden set and crisis seeds from
 *      the same files the install org was seeded from. Assert each one
 *      **seeds** rather than skipping: the write-once marker is per org, and
 *      the same document, journey, tier, module, question, words, overlay
 *      situation, golden set and region names are accepted beside the
 *      install org's.
 *   3. Assert both orgs read the same names, from different rows.
 *   4. Edit a tier's label and add an article opening a document, in the new
 *      org. Assert the install org's tier is unchanged, and the article points
 *      at the new org's copy of the document, not the install org's. Give a
 *      person a budget in the new org, and assert the install org's budgets
 *      are unchanged. Then assert every generated-id link, in either org,
 *      points at a parent in its own org.
 *   5. Erase the org through `eraseOrg`, the platform's path, and assert
 *      nothing of it is left.
 *
 * Needs: a migrated, seeded database (`npm run db:seed`) **at
 * `TENANCY_MODE=multi` with the policies enabled**, connecting as the
 * restricted app role. At `single` the tenancy client scopes no read, so the
 * new org's seeds would see the install org's rows and skip, which is correct
 * there and proves nothing here. Do it on a throwaway database, never dev: see
 * "Enabling, end to end" in `.context/tenancy/isolation.md` for
 * `db:tenancy:role -- --create` and `db:tenancy:enable`. Runs no model; with
 * no embedding provider the knowledge mirror logs failures and carries on.
 *
 * Run: `npm run smoke:app-per-org-content`. Exits non-zero on the first
 * failed assertion, after erasing the org.
 */
import { prisma } from '@/lib/db/client';
import { PLATFORM_ADMIN_ROLE } from '@/lib/auth/roles';
import { logger } from '@/lib/logging';
import { runAsOrg, runAsSystem } from '@/lib/tenancy/context';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';
import { createOrg } from '@/lib/tenancy/lifecycle';
import { eraseOrg } from '@/lib/privacy/erase-org';
import { buildFoundationalSeed } from '@/lib/app/content/seed-input/foundational-seed';
import { buildJourneySeed } from '@/lib/app/content/seed-input/journey-seed';
import { buildQuestionSeed } from '@/lib/app/content/seed-input/question-seed';
import { buildResourcesSeed } from '@/lib/app/content/seed-input/resources-seed';
import { seedFoundationalDocuments } from '@/lib/app/content/document-store';
import { getJourneyStructure, seedJourneyStructure } from '@/lib/app/content/journey-store';
import { getDiscoveryQuestions, seedDiscoveryQuestions } from '@/lib/app/content/question-store';
import { seedResources } from '@/lib/app/content/resource-store';
import { updateTier } from '@/lib/app/content/admin/journey';
import { createResource } from '@/lib/app/content/admin/resources';
import { resourceEditSchema } from '@/lib/app/content/admin/validation';
import { buildVoiceOverlaySeed } from '@/lib/app/content/seed-input/voice-overlay-seed';
import { buildGoldenSetSeed } from '@/lib/app/content/seed-input/golden-set-seed';
import { seedVoiceOverlays } from '@/lib/app/content/voice-overlay-store';
import { seedGoldenSetPointer } from '@/lib/app/content/golden-set-store';
import { clearUserBudget, setUserBudget } from '@/lib/app/agent/settings';
import { goldenSetDatasetId } from '@/lib/app/voice/golden-set';
import goldenSetUnit from '@/prisma/seeds/app-lelanea/004-voice-golden-set';
import crisisResources from '@/prisma/seeds/app-lelanea/010-crisis-resources';

/** Distinct from any real ceiling, so each org's budget row is recognisable. */
const INSTALL_CEILING = 777.25;
const NEW_ORG_CEILING = 1234.5;

const PROBE_ARTICLE = 't113-smoke-article';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  logger.info(`  ✓ ${message}`);
}

/** Row ids and names of the content tables, as one org sees them. */
async function snapshot() {
  const [documents, tiers, modules, questions, words, overlays, goldenSets, regions, budgets] =
    await Promise.all([
      prisma.appFoundationalDocument.findMany({ select: { id: true, slug: true } }),
      prisma.appJourneyTier.findMany({ select: { id: true, slug: true, label: true } }),
      prisma.appJourneyModule.findMany({ select: { id: true, slug: true } }),
      prisma.appDiscoveryQuestion.findMany({ select: { id: true, slug: true } }),
      prisma.appResourceWords.findMany({ select: { id: true, key: true } }),
      prisma.appVoiceOverlay.findMany({ select: { id: true, situation: true } }),
      prisma.appVoiceGoldenSet.findMany({ select: { id: true, slug: true } }),
      prisma.appCrisisRegion.findMany({ select: { id: true, region: true } }),
      prisma.appUserBudget.findMany({ select: { userId: true, monthlyCeilingUsd: true } }),
    ]);
  return { documents, tiers, modules, questions, words, overlays, goldenSets, regions, budgets };
}

const names = (rows: readonly { slug: string }[]) => rows.map((row) => row.slug).sort();
const ids = (rows: readonly { id: string }[]) => new Set(rows.map((row) => row.id));
const disjoint = (a: Set<string>, b: Set<string>) => [...a].every((id) => !b.has(id));

async function main(): Promise<void> {
  const editor = await runAsSystem('smoke: find an editor', () =>
    prisma.user.findFirst({ where: { role: PLATFORM_ADMIN_ROLE }, select: { id: true } })
  );
  if (!editor) throw new Error('No admin user to attribute the edits to. Run `npm run db:seed`.');

  // The same person holds a budget in the install org first, so the new org's
  // budget below can only land beside it if the key is (orgId, userId). It is
  // put back in `finally`, whatever fails in between.
  const priorInstallBudget = await runAsOrg(INSTALL_ORG_ID, () =>
    prisma.appUserBudget.findFirst({ where: { orgId: INSTALL_ORG_ID, userId: editor.id } })
  );
  try {
    await runAsOrg(INSTALL_ORG_ID, () => setUserBudget(editor.id, INSTALL_CEILING));
    await checkTwoOrgs(editor.id);
  } finally {
    await runAsOrg(INSTALL_ORG_ID, async () => {
      if (priorInstallBudget) await setUserBudget(editor.id, priorInstallBudget.monthlyCeilingUsd);
      else await clearUserBudget(editor.id);
    });
  }
}

/** Steps 1–5 of the module docblock, for one editor. */
async function checkTwoOrgs(editorId: string): Promise<void> {
  const install = await runAsOrg(INSTALL_ORG_ID, snapshot);
  check(install.modules.length > 0, 'the install org is seeded');

  const org = await createOrg({ slug: `t113-smoke-${Date.now()}`, name: 't-113 smoke' });
  logger.info(`Created org ${org.id}`);
  let failure: Error | null = null;

  try {
    await runAsOrg(org.id, async () => {
      logger.info('Seeding the same content into the new org');
      const results = [
        await seedFoundationalDocuments(buildFoundationalSeed()),
        await seedJourneyStructure(buildJourneySeed()),
        await seedDiscoveryQuestions(buildQuestionSeed()),
        await seedResources(buildResourcesSeed()),
        await seedVoiceOverlays(buildVoiceOverlaySeed()),
        await seedGoldenSetPointer(buildGoldenSetSeed()),
      ];
      check(
        results.every((result) => result.status === 'seeded'),
        'every content seed wrote into the new org rather than skipping'
      );
      // Its marker is the crisis copy (t-112), so it writes only if the new
      // org has none: the region count below says whether it did.
      await crisisResources.run({ prisma, logger });
      // The golden set's dataset: `ai_dataset.id` is install-wide, so this is
      // where a second org would collide with the install org's.
      await goldenSetUnit.run({ prisma, logger });
      const pointer = await prisma.appVoiceGoldenSet.findFirst({ select: { version: true } });
      const datasetId = pointer ? goldenSetDatasetId(pointer.version, org.id) : null;
      const dataset = datasetId
        ? await prisma.aiDataset.findUnique({ where: { id: datasetId }, select: { id: true } })
        : null;
      check(
        dataset !== null && datasetId !== goldenSetDatasetId(pointer!.version, INSTALL_ORG_ID),
        'the golden set dataset is seeded under an id of its own, beside the install org’s'
      );

      const mine = await snapshot();
      check(
        JSON.stringify(names(mine.modules)) === JSON.stringify(names(install.modules)) &&
          JSON.stringify(names(mine.documents)) === JSON.stringify(names(install.documents)) &&
          JSON.stringify(names(mine.questions)) === JSON.stringify(names(install.questions)),
        'the new org holds the same document, module and question names'
      );
      const sorted = (values: string[]) => JSON.stringify([...values].sort());
      check(
        sorted(mine.overlays.map((row) => row.situation)) ===
          sorted(install.overlays.map((row) => row.situation)) &&
          sorted(mine.goldenSets.map((row) => row.slug)) ===
            sorted(install.goldenSets.map((row) => row.slug)) &&
          sorted(mine.regions.map((row) => row.region)) ===
            sorted(install.regions.map((row) => row.region)),
        'and the same voice overlay situations, golden set and crisis regions'
      );
      check(
        disjoint(ids(mine.modules), ids(install.modules)) &&
          disjoint(ids(mine.documents), ids(install.documents)) &&
          disjoint(ids(mine.questions), ids(install.questions)) &&
          disjoint(ids(mine.words), ids(install.words)) &&
          disjoint(ids(mine.overlays), ids(install.overlays)) &&
          disjoint(ids(mine.goldenSets), ids(install.goldenSets)) &&
          disjoint(ids(mine.regions), ids(install.regions)),
        'from rows of its own'
      );

      const structure = await getJourneyStructure();
      const questions = await getDiscoveryQuestions();
      check(
        structure.modules.length === install.modules.length &&
          questions.questions.length === install.questions.length,
        'the read services serve the new org its own journey and questions'
      );

      const tier = mine.tiers[0];
      if (!tier) throw new Error('the new org has no tiers');
      const tierRow = await prisma.appJourneyTier.findFirst({
        where: { slug: tier.slug },
        select: { revision: true, intent: true },
      });
      if (!tierRow) throw new Error(`tier ${tier.slug} vanished`);
      await updateTier(
        tier.slug,
        { label: `${tier.label} (smoke)`, intent: tierRow.intent },
        tierRow.revision,
        editorId
      );

      const document = mine.documents[0];
      if (!document) throw new Error('the new org has no documents');
      await createResource(
        PROBE_ARTICLE,
        resourceEditSchema.parse({
          kind: 'article',
          title: 'Smoke article',
          subtitle: 'Opens a document',
          relatesTo: null,
          readingTime: '3 min',
          documentId: document.slug,
        }),
        editorId
      );
      const article = await prisma.appResource.findFirst({
        where: { slug: PROBE_ARTICLE },
        select: { documentId: true, documentSlug: true },
      });
      check(
        article?.documentId === document.id && article.documentSlug === document.slug,
        `the article opens the new org's "${document.slug}", not the install org's`
      );
      const budget = await setUserBudget(editorId, NEW_ORG_CEILING);
      const mineBudget = await prisma.appUserBudget.findFirst({ where: { userId: editorId } });
      const everyBudget = await runAsSystem('smoke: one person, two orgs', () =>
        prisma.appUserBudget.findMany({
          where: { userId: editorId },
          select: { orgId: true, monthlyCeilingUsd: true },
        })
      );
      check(
        budget !== null &&
          mineBudget?.monthlyCeilingUsd === NEW_ORG_CEILING &&
          everyBudget.some(
            (row) => row.orgId === INSTALL_ORG_ID && row.monthlyCeilingUsd === INSTALL_CEILING
          ) &&
          everyBudget.some(
            (row) => row.orgId === org.id && row.monthlyCeilingUsd === NEW_ORG_CEILING
          ),
        'one person holds a budget in each org, side by side'
      );

      const strays = await runAsSystem('smoke: cross-org children', async () => {
        const org = { select: { orgId: true } } as const;
        const differ = (
          rows: { orgId: string | null; parent: { orgId: string | null } | null }[]
        ) => rows.filter((row) => row.parent !== null && row.orgId !== row.parent.orgId).length;
        const counts = await Promise.all([
          prisma.appFoundationalDocument
            .findMany({ select: { orgId: true, collection: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.collection })))),
          prisma.appFoundationalDocumentRevision
            .findMany({ select: { orgId: true, document: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.document })))),
          prisma.appJourneyTier
            .findMany({ select: { orgId: true, journey: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.journey })))),
          prisma.appJourneyModule
            .findMany({ select: { orgId: true, journey: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.journey })))),
          prisma.appJourneyTierRevision
            .findMany({ select: { orgId: true, tier: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.tier })))),
          prisma.appJourneyModuleRevision
            .findMany({ select: { orgId: true, module: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.module })))),
          prisma.appQuestionSet
            .findMany({ select: { orgId: true, module: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.module })))),
          prisma.appQuestionSetRevision
            .findMany({ select: { orgId: true, set: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.set })))),
          prisma.appDiscoveryQuestion
            .findMany({ select: { orgId: true, set: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.set })))),
          prisma.appDiscoveryQuestionRevision
            .findMany({ select: { orgId: true, question: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.question })))),
          prisma.appResource
            .findMany({ select: { orgId: true, collection: org, document: org } })
            .then(
              (rows) =>
                differ(rows.map((r) => ({ orgId: r.orgId, parent: r.collection }))) +
                differ(rows.map((r) => ({ orgId: r.orgId, parent: r.document })))
            ),
          prisma.appResourceRevision
            .findMany({ select: { orgId: true, resource: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.resource })))),
          prisma.appResourceWords
            .findMany({ select: { orgId: true, collection: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.collection })))),
          prisma.appResourceWordsRevision
            .findMany({ select: { orgId: true, words: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.words })))),
          prisma.appVoiceOverlay
            .findMany({ select: { orgId: true, set: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.set })))),
          prisma.appVoiceOverlayRevision
            .findMany({ select: { orgId: true, overlay: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.overlay })))),
          prisma.appVoiceOverlaySetRevision
            .findMany({ select: { orgId: true, set: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.set })))),
          prisma.appVoiceGoldenSetRevision
            .findMany({ select: { orgId: true, set: org } })
            .then((rows) => differ(rows.map((r) => ({ orgId: r.orgId, parent: r.set })))),
        ]);
        return counts.reduce((sum, n) => sum + n, 0);
      });
      check(
        strays === 0,
        'every generated-id link, in either org, points at a parent in its own org'
      );
    });

    const after = await runAsOrg(INSTALL_ORG_ID, snapshot);
    const bySlug = (rows: readonly { slug: string }[]) =>
      JSON.stringify([...rows].sort((x, y) => x.slug.localeCompare(y.slug)));
    check(
      bySlug(after.tiers) === bySlug(install.tiers),
      "the new org's tier edit left the install org's tiers as they were"
    );
    const byUser = (rows: readonly { userId: string; monthlyCeilingUsd: number }[]) =>
      JSON.stringify([...rows].sort((x, y) => x.userId.localeCompare(y.userId)));
    check(
      byUser(after.budgets) === byUser(install.budgets),
      "and its budget left the install org's budgets as they were"
    );
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  await eraseOrg({ orgId: org.id, actorUserId: editorId });
  const left = await runAsSystem('smoke: anything left', () =>
    Promise.all([
      prisma.appJourneyModule.count({ where: { orgId: org.id } }),
      prisma.appFoundationalDocument.count({ where: { orgId: org.id } }),
      prisma.appResource.count({ where: { orgId: org.id } }),
      prisma.appDiscoveryQuestionRevision.count({ where: { orgId: org.id } }),
      prisma.appVoiceOverlay.count({ where: { orgId: org.id } }),
      prisma.appCrisisRegion.count({ where: { orgId: org.id } }),
      prisma.appUserBudget.count({ where: { orgId: org.id } }),
    ])
  );
  if (failure) throw failure;
  check(
    left.every((n) => n === 0),
    'erasing the org removed its content'
  );
  logger.info('✅ A second org holds the same content names as the install org');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error('Per-org content smoke failed', err);
    process.exit(1);
  });
