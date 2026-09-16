/**
 * Seed the designation vocabulary — six managed tags, two families.
 *
 * Before this runs, there is no way to record the distinction the voice feature
 * turns on: whether a document she uploaded is something she KNOWS (quotable) or
 * something that shows how she SOUNDS (never quoted, only imitated). The
 * uploader, the parsers and the tag taxonomy all already exist; the vocabulary
 * is what is missing, and this unit is where it comes from.
 *
 * `purpose-{knowledge,voice,both}` and `sensitivity-{public,private,client}`,
 * derived from `lib/app/voice/designation.ts` so the slugs the grant rule
 * addresses and the slugs this writes cannot drift apart. `hashInputs` folds that
 * module into this unit's content hash, so editing the vocabulary re-runs the
 * seed rather than leaving the database a version behind.
 *
 * ## The row this writes, and who owns it (`fp4`)
 *
 * **Split ownership, and the split is deliberate.** The SLUG is code — the grant
 * rule, the admin surface and `resolveAgentDocumentAccess` all address these tags
 * by slug, so a slug is a contract rather than a label. The NAME and DESCRIPTION
 * are operator-owned: `/admin/orchestration/knowledge/tags` lets an admin edit
 * both, and a seed that reconciled them would silently undo that edit on its next
 * run.
 *
 * So this unit CREATES a missing tag and never rewrites an existing one. The
 * consequence, stated rather than discovered: improving a description in
 * `designation.ts` does not reach a database that already has the tag. Change the
 * copy in the admin, or — if the vocabulary itself changes meaning — mint a new
 * slug, which is a vocabulary change and should look like one.
 *
 * ## Idempotent, safe on empty, no timestamp churn
 *
 * The existence check is a single `findMany` on the six slugs; only the missing
 * ones are created. A re-run on a complete database issues no write at all, so
 * `updatedAt` never moves — which is the property `fp4` asks for, and the reason
 * this is not an `upsert` with an empty `update` (that still round-trips a write
 * on some adapters and reads, to the next person, as though it might rewrite).
 *
 * **No deletion pass**, deliberately. A tag this seed does not recognise may have
 * documents attached to it by an admin, and the rows this unit owns are exactly
 * the six it creates — `fp4`'s "partition any removal pass to the rows this sync
 * owns" resolves here to removing nothing.
 *
 * ## `sensitivity-client` is seeded, and nothing is seeded FROM it
 *
 * Client transcripts are deferred, not excluded (owner ruling, applied at
 * planning). The value exists from day one so a document can be marked honestly
 * at the moment it is uploaded; no grant rule admits it. See
 * `lib/app/voice/designation.ts`.
 */

import type { SeedUnit } from '@/prisma/runner';
import {
  DOCUMENT_PURPOSES,
  DOCUMENT_SENSITIVITIES,
  PURPOSE_COPY,
  SENSITIVITY_COPY,
  purposeTagSlug,
  sensitivityTagSlug,
} from '@/lib/app/voice/designation';

interface SeededTag {
  slug: string;
  name: string;
  description: string;
}

/**
 * The six rows, projected from the vocabulary.
 *
 * The tag's NAME carries its family (`Purpose: Voice`) because these sit in one
 * flat taxonomy beside every other knowledge tag in
 * `/admin/orchestration/knowledge/tags` — an unqualified "Voice" beside an
 * unqualified "Public" reads as two unrelated labels rather than two answers to
 * two questions.
 */
export function designationTags(): SeededTag[] {
  return [
    ...DOCUMENT_PURPOSES.map((purpose) => ({
      slug: purposeTagSlug(purpose),
      name: `Purpose: ${PURPOSE_COPY[purpose].label}`,
      description: PURPOSE_COPY[purpose].help,
    })),
    ...DOCUMENT_SENSITIVITIES.map((sensitivity) => ({
      slug: sensitivityTagSlug(sensitivity),
      name: `Sensitivity: ${SENSITIVITY_COPY[sensitivity].label}`,
      description: SENSITIVITY_COPY[sensitivity].help,
    })),
  ];
}

const unit: SeedUnit = {
  name: 'app-lelanea/002-knowledge-designation',
  hashInputs: ['../../../lib/app/voice/designation.ts'],
  async run({ prisma, logger }) {
    const tags = designationTags();
    const slugs = tags.map((tag) => tag.slug);

    const existing = await prisma.knowledgeTag.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true },
    });
    const have = new Set(existing.map((tag) => tag.slug));
    const missing = tags.filter((tag) => !have.has(tag.slug));

    if (missing.length === 0) {
      logger.info(`⏭  designation vocabulary already complete (${tags.length} tags)`);
      return;
    }

    // `skipDuplicates` rather than a bare create: two seeds racing on a fresh
    // database (or a tag an admin created by hand between the read above and
    // this write) must not abort the unit on a unique-constraint violation.
    await prisma.knowledgeTag.createMany({ data: missing, skipDuplicates: true });

    logger.info(`🏷️  Created ${missing.length} designation tags`, {
      created: missing.map((tag) => tag.slug),
    });
  },
};

export default unit;
