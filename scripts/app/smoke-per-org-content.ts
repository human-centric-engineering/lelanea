/**
 * Smoke: a second org holds the same content names as the install org (t-113).
 *
 * **Why this exists rather than another unit test.** The per-org keys are
 * database constraints (`@@unique([orgId, slug])`), and the org every read and
 * write lands in is decided by Sunrise's tenancy client from the context. A
 * fake database agrees with whatever the test believes about both. This runs
 * the real seeds and admin writers against a real database, under two orgs.
 *
 * Flow:
 *   1. Create a throwaway org.
 *   2. In it, run the four content seeds from the same content files the
 *      install org was seeded from. Assert each one **seeds** rather than
 *      skipping: the write-once marker is per org, and the same document,
 *      journey, tier, module, question set, question and words names are
 *      accepted beside the install org's.
 *   3. Assert both orgs read the same names, from different rows, and every
 *      child row in the new org points at a parent in the new org.
 *   4. Edit a tier's label and add an article opening a document, in the new
 *      org. Assert the install org's tier is unchanged, and the article points
 *      at the new org's copy of the document, not the install org's.
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

const PROBE_ARTICLE = 't113-smoke-article';

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
  logger.info(`  ✓ ${message}`);
}

/** Row ids and names of the content tables, as one org sees them. */
async function snapshot() {
  const [documents, tiers, modules, questions, words] = await Promise.all([
    prisma.appFoundationalDocument.findMany({ select: { id: true, slug: true } }),
    prisma.appJourneyTier.findMany({ select: { id: true, slug: true, label: true } }),
    prisma.appJourneyModule.findMany({ select: { id: true, slug: true } }),
    prisma.appDiscoveryQuestion.findMany({ select: { id: true, slug: true } }),
    prisma.appResourceWords.findMany({ select: { id: true, key: true } }),
  ]);
  return { documents, tiers, modules, questions, words };
}

const names = (rows: readonly { slug: string }[]) => rows.map((row) => row.slug).sort();
const ids = (rows: readonly { id: string }[]) => new Set(rows.map((row) => row.id));
const disjoint = (a: Set<string>, b: Set<string>) => [...a].every((id) => !b.has(id));

async function main(): Promise<void> {
  const editor = await runAsSystem('smoke: find an editor', () =>
    prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } })
  );
  if (!editor) throw new Error('No admin user to attribute the edits to. Run `npm run db:seed`.');

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
      ];
      check(
        results.every((result) => result.status === 'seeded'),
        'every content seed wrote into the new org rather than skipping'
      );

      const mine = await snapshot();
      check(
        JSON.stringify(names(mine.modules)) === JSON.stringify(names(install.modules)) &&
          JSON.stringify(names(mine.documents)) === JSON.stringify(names(install.documents)) &&
          JSON.stringify(names(mine.questions)) === JSON.stringify(names(install.questions)),
        'the new org holds the same document, module and question names'
      );
      check(
        disjoint(ids(mine.modules), ids(install.modules)) &&
          disjoint(ids(mine.documents), ids(install.documents)) &&
          disjoint(ids(mine.questions), ids(install.questions)) &&
          disjoint(ids(mine.words), ids(install.words)),
        'from rows of its own'
      );

      const structure = await getJourneyStructure();
      const questions = await getDiscoveryQuestions();
      check(
        structure.modules.length === install.modules.length &&
          questions.questions.length === install.questions.length,
        'the read services serve the new org its own journey and questions'
      );

      const strays = await runAsSystem('smoke: cross-org children', async () => {
        const org = { select: { orgId: true } } as const;
        const [modules, tierRevisions, sets, questions, documents, wordsRevisions] =
          await Promise.all([
            prisma.appJourneyModule.findMany({ select: { orgId: true, journey: org } }),
            prisma.appJourneyTierRevision.findMany({ select: { orgId: true, tier: org } }),
            prisma.appQuestionSet.findMany({ select: { orgId: true, module: org } }),
            prisma.appDiscoveryQuestion.findMany({ select: { orgId: true, set: org } }),
            prisma.appFoundationalDocument.findMany({ select: { orgId: true, collection: org } }),
            prisma.appResourceWordsRevision.findMany({ select: { orgId: true, words: org } }),
          ]);
        return [
          ...modules.map((row) => row.orgId !== row.journey.orgId),
          ...tierRevisions.map((row) => row.orgId !== row.tier.orgId),
          ...sets.map((row) => row.orgId !== row.module.orgId),
          ...questions.map((row) => row.orgId !== row.set.orgId),
          ...documents.map((row) => row.orgId !== row.collection.orgId),
          ...wordsRevisions.map((row) => row.orgId !== row.words.orgId),
        ].filter(Boolean).length;
      });
      check(strays === 0, 'every child row, in either org, points at a parent in its own org');

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
        editor.id
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
        editor.id
      );
      const article = await prisma.appResource.findFirst({
        where: { slug: PROBE_ARTICLE },
        select: { documentId: true, documentSlug: true },
      });
      check(
        article?.documentId === document.id && article.documentSlug === document.slug,
        `the article opens the new org's "${document.slug}", not the install org's`
      );
    });

    const after = await runAsOrg(INSTALL_ORG_ID, snapshot);
    check(
      JSON.stringify(after.tiers) === JSON.stringify(install.tiers),
      "the new org's tier edit left the install org's tiers as they were"
    );
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
  }

  await eraseOrg({ orgId: org.id, actorUserId: editor.id });
  const left = await runAsSystem('smoke: anything left', () =>
    Promise.all([
      prisma.appJourneyModule.count({ where: { orgId: org.id } }),
      prisma.appFoundationalDocument.count({ where: { orgId: org.id } }),
      prisma.appResource.count({ where: { orgId: org.id } }),
      prisma.appDiscoveryQuestionRevision.count({ where: { orgId: org.id } }),
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
