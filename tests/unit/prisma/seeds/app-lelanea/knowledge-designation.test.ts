/**
 * The designation vocabulary seed: what it writes, and what a re-run must not.
 *
 * `fp4`'s two properties, as two cases. The idempotence one is the load-bearing
 * half — "re-running writes nothing and churns no timestamps" is a claim about a
 * database this harness does not have (`B9`), so it is asserted here as "issues
 * no write call at all", which is the only shape that could churn a timestamp.
 *
 * The other half is the ownership split. The seed CREATES a missing tag and never
 * rewrites an existing one, because `/admin/orchestration/knowledge/tags` lets an
 * admin edit a tag's name and description and a reconciling seed would silently
 * undo that on its next run. The case below proves it by presenting a tag whose
 * name differs from the code's and asserting no write follows.
 *
 * @see prisma/seeds/app-lelanea/002-knowledge-designation.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, it, expect, beforeEach, vi } from 'vitest';

import unit, { designationTags } from '@/prisma/seeds/app-lelanea/002-knowledge-designation';
import {
  DESIGNATION_TAG_SLUGS,
  purposeTagSlug,
  sensitivityTagSlug,
} from '@/lib/app/voice/designation';

/** The unit's own file, so the two source-level assertions cannot drift from it. */
const SEED_PATH = join(
  process.cwd(),
  'prisma',
  'seeds',
  'app-lelanea',
  '002-knowledge-designation.ts'
);

const findMany = vi.fn();
const createMany = vi.fn();

function ctx() {
  return {
    prisma: { knowledgeTag: { findMany, createMany } } as never,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the rows it projects', () => {
  it('is exactly the vocabulary — six tags, two families', () => {
    expect(designationTags().map((tag) => tag.slug)).toEqual([...DESIGNATION_TAG_SLUGS]);
    expect(designationTags()).toHaveLength(6);
  });

  it('qualifies each name with its family', () => {
    // These land in one flat taxonomy beside every other knowledge tag. An
    // unqualified "Voice" next to an unqualified "Public" reads as two unrelated
    // labels rather than two answers to two questions.
    const bySlug = new Map(designationTags().map((tag) => [tag.slug, tag]));
    expect(bySlug.get(purposeTagSlug('voice'))?.name).toBe('Purpose: Voice');
    expect(bySlug.get(sensitivityTagSlug('client'))?.name).toBe('Sensitivity: Client');
  });

  it('gives every tag a description', () => {
    for (const tag of designationTags()) {
      expect(tag.description).toBeTruthy();
    }
  });

  it('seeds `sensitivity-client`, the deferred value', () => {
    // Deferred, not excluded (owner ruling). The value exists so a document can be
    // marked honestly at upload; no grant rule admits it. A seed that omitted it
    // would leave client material undesignated, which is how it becomes a pile
    // nobody dares touch later.
    expect(designationTags().map((tag) => tag.slug)).toContain(sensitivityTagSlug('client'));
  });
});

describe('running it', () => {
  it('creates every tag on an empty database', async () => {
    findMany.mockResolvedValueOnce([]);

    await unit.run(ctx());

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data.map((tag: { slug: string }) => tag.slug)).toEqual([
      ...DESIGNATION_TAG_SLUGS,
    ]);
    // A race on a fresh database (or a tag an admin made by hand between the read
    // and the write) must not abort the unit on a unique-constraint violation.
    expect(createMany.mock.calls[0]?.[0]?.skipDuplicates).toBe(true);
  });

  it('creates only what is missing', async () => {
    findMany.mockResolvedValueOnce([{ slug: purposeTagSlug('knowledge') }]);

    await unit.run(ctx());

    const created = createMany.mock.calls[0]?.[0]?.data.map((tag: { slug: string }) => tag.slug);
    expect(created).toHaveLength(5);
    expect(created).not.toContain(purposeTagSlug('knowledge'));
  });

  it('writes NOTHING on a re-run — no create, no update, no timestamp churn', async () => {
    findMany.mockResolvedValueOnce(DESIGNATION_TAG_SLUGS.map((slug) => ({ slug })));

    await unit.run(ctx());

    // Not "an upsert with an empty update", which still round-trips a write and
    // reads to the next person as though it might rewrite. No write call at all.
    expect(createMany).not.toHaveBeenCalled();
  });

  it('does not rewrite a tag an admin has renamed', async () => {
    // The name and description are operator-owned; the slug is code. A seed that
    // reconciled all three would undo an admin's edit every time it ran.
    findMany.mockResolvedValueOnce(DESIGNATION_TAG_SLUGS.map((slug) => ({ slug })));

    await unit.run(ctx());

    expect(createMany).not.toHaveBeenCalled();
    // And it asked only for the slugs — it never read the names it would have
    // needed in order to compare them.
    expect(findMany.mock.calls[0]?.[0]?.select).toEqual({ slug: true });
  });

  it('deletes nothing, ever — asserted against the source, not the mock', () => {
    // `fp4`: partition a removal pass to the rows this sync owns. Here that
    // resolves to removing NOTHING — a tag this seed does not recognise may have
    // documents an admin attached to it, and this unit owns only the six it
    // creates.
    //
    // Read from the file rather than driven through the mock, because "the mock
    // has no deleteMany" is true whether or not the seed would have called one:
    // an absence assertion against a stub that could not record the call is the
    // decoration `fp6` warns about.
    const source = readFileSync(SEED_PATH, 'utf-8');
    const body = source.slice(source.indexOf('const unit: SeedUnit'));

    expect(body).not.toMatch(/delete(Many)?\s*\(/);
  });
});

describe('the unit’s own wiring', () => {
  it('is keyed by its path, so its history row cannot collide with another directory’s 002', () => {
    expect(unit.name).toBe('app-lelanea/002-knowledge-designation');
  });

  it('re-runs when the vocabulary changes, and the path it names exists', () => {
    // Without `hashInputs` the seed's content hash covers only its own source, so
    // moving a value in `designation.ts` would leave the database a version behind
    // with nothing to say so.
    expect(unit.hashInputs).toEqual(['../../../lib/app/voice/designation.ts']);

    // And the path is RESOLVED, not just compared to a string. The runner throws
    // on a hashInput it cannot read — at seed time, which is the wrong moment to
    // find out a relative path is one `../` short.
    for (const relative of unit.hashInputs ?? []) {
      expect(existsSync(resolve(dirname(SEED_PATH), relative))).toBe(true);
    }
  });
});
