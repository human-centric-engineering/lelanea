import { describe, expect, it } from 'vitest';

import {
  isCoreSource,
  checkMigrationHygiene,
  extractTables,
  isFrameworkMigration,
  scanForFrameworkVocab,
  type MigrationFile,
} from '@/scripts/boundary/lib';

describe('isFrameworkMigration', () => {
  it('recognises a framework_ slug after the timestamp', () => {
    expect(isFrameworkMigration('20260702120000_framework_add_modules')).toBe(true);
  });

  it('rejects a core migration slug', () => {
    expect(isFrameworkMigration('20260629120000_add_knowledge_document_slug')).toBe(false);
  });

  it('does not match a mid-slug "framework" token', () => {
    // Only a slug that *starts* with framework_ is framework-owned.
    expect(isFrameworkMigration('20260702120000_rework_framework_notes')).toBe(false);
  });
});

describe('extractTables', () => {
  it('pulls table names from CREATE / ALTER / DROP TABLE with quotes and IF EXISTS', () => {
    const sql = `
      CREATE TABLE "framework_module" ("id" TEXT);
      ALTER TABLE "ai_agent" ADD COLUMN "x" TEXT;
      DROP TABLE IF EXISTS "old_thing";
    `;
    expect(extractTables(sql).sort()).toEqual(['ai_agent', 'framework_module', 'old_thing']);
  });

  it('pulls the target table from CREATE INDEX ... ON', () => {
    const sql = `CREATE UNIQUE INDEX "idx_x" ON "framework_slot" ("moduleSlug");`;
    expect(extractTables(sql)).toContain('framework_slot');
  });

  it('handles schema-qualified identifiers (quoted and bare)', () => {
    expect(extractTables(`CREATE TABLE "public"."framework_map" ("id" TEXT);`)).toEqual([
      'framework_map',
    ]);
    expect(extractTables(`CREATE TABLE public.framework_map ("id" TEXT);`)).toEqual([
      'framework_map',
    ]);
  });

  it('does NOT capture ON DELETE / ON UPDATE / ON CONFLICT action clauses as tables', () => {
    // Prisma emits this for every FK; CLAUDE.md mandates an onDelete policy.
    const sql = `ALTER TABLE "framework_module"
      ADD CONSTRAINT "fk" FOREIGN KEY ("userId") REFERENCES "user"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;`;
    // Only the altered table — never "user" (a REFERENCES target), "delete", or "cascade".
    expect(extractTables(sql)).toEqual(['framework_module']);
  });

  it('anchors index extraction to CREATE INDEX (ON <table>), ignoring FK ON clauses', () => {
    const sql = `CREATE INDEX "idx_m" ON "framework_module" ("moduleSlug");`;
    expect(extractTables(sql)).toEqual(['framework_module']);
  });

  it('strips SQL comments before extracting', () => {
    const sql = `-- DROP TABLE framework_legacy (done in a previous migration)
      /* CREATE TABLE framework_ghost (...) */
      ALTER TABLE "ai_agent" ADD COLUMN "x" TEXT;`;
    expect(extractTables(sql)).toEqual(['ai_agent']);
  });

  it('does not let a block comment containing "--" swallow following DDL', () => {
    // Sequential --then-/* stripping would eat the `*/` and drop the CREATE.
    const sql = `/* note -- todo */ CREATE TABLE "framework_real" ("id" TEXT);`;
    expect(extractTables(sql)).toEqual(['framework_real']);
  });

  it('ignores DDL-looking text inside string literals', () => {
    const sql = `INSERT INTO "framework_flags" ("v") VALUES ('CREATE TABLE "User"');`;
    // No phantom "user" from the string literal (and INSERT is not DDL ownership).
    expect(extractTables(sql)).toEqual([]);
  });

  it('ignores DDL inside a dollar-quoted body (RLS DO block)', () => {
    const sql = `DO $$ BEGIN CREATE TABLE ghost (); END $$;
      ALTER TABLE "framework_slot" ENABLE ROW LEVEL SECURITY;`;
    expect(extractTables(sql)).toEqual(['framework_slot']);
  });

  it('does not cross a statement boundary from an ON-less CREATE INDEX', () => {
    const sql = `CREATE INDEX "idx";
      ALTER TABLE "framework_slot" ADD CONSTRAINT c
        FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;`;
    // Never captures "delete" from the ALTER's ON DELETE clause.
    expect(extractTables(sql)).toEqual(['framework_slot']);
  });

  it('handles ALTER TABLE ONLY', () => {
    expect(
      extractTables(`ALTER TABLE ONLY "framework_slot" ADD CONSTRAINT c CHECK (true);`)
    ).toEqual(['framework_slot']);
  });
});

describe('checkMigrationHygiene', () => {
  const clean: MigrationFile[] = [
    {
      name: '20260702120000_framework_add_modules',
      sql: `CREATE TABLE "framework_module" ("id" TEXT);
            CREATE INDEX "idx_m" ON "framework_module" ("id");`,
    },
    {
      name: '20260629120000_add_knowledge_document_slug',
      sql: `ALTER TABLE "ai_knowledge_document" ADD COLUMN "slug" TEXT;`,
    },
  ];

  it('passes a clean tree (framework migration = only framework_ DDL)', () => {
    expect(checkMigrationHygiene(clean)).toEqual([]);
  });

  it('flags a framework migration that touches a core table', () => {
    const violations = checkMigrationHygiene([
      {
        name: '20260702120000_framework_add_modules',
        sql: `CREATE TABLE "framework_module" ("id" TEXT);
              ALTER TABLE "ai_agent" ADD COLUMN "moduleSlug" TEXT;`,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.tables).toEqual(['ai_agent']);
    expect(violations[0]?.reason).toMatch(/non-framework_ tables/);
  });

  it('flags a core migration that touches a framework_ table', () => {
    const violations = checkMigrationHygiene([
      {
        name: '20260702130000_add_something',
        sql: `CREATE TABLE "framework_slot" ("id" TEXT);`,
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.tables).toEqual(['framework_slot']);
    expect(violations[0]?.reason).toMatch(/framework_ tables/);
  });

  it('does NOT flag a framework migration whose table has an FK to a core table', () => {
    // framework → core FKs are legitimate (framework is built on core). Hygiene
    // keys on structural DDL ownership, not FK targets.
    const violations = checkMigrationHygiene([
      {
        name: '20260702120000_framework_add_modules',
        sql: `CREATE TABLE "framework_module" (
                "id" TEXT NOT NULL,
                "userId" TEXT NOT NULL,
                CONSTRAINT "framework_module_pkey" PRIMARY KEY ("id")
              );
              ALTER TABLE "framework_module"
                ADD CONSTRAINT "framework_module_userId_fkey"
                FOREIGN KEY ("userId") REFERENCES "User"("id")
                ON DELETE CASCADE ON UPDATE CASCADE;`,
      },
    ]);
    expect(violations).toEqual([]);
  });

  it('returns no violations for an empty migration set', () => {
    expect(checkMigrationHygiene([])).toEqual([]);
  });
});

describe('scanForFrameworkVocab', () => {
  it('flags a framework-coined identifier in a core file', () => {
    const hits = scanForFrameworkVocab([
      { path: 'lib/orchestration/context.ts', content: 'interface Ctx {\n  moduleId: string;\n}' },
    ]);
    expect(hits).toEqual([{ path: 'lib/orchestration/context.ts', token: 'moduleId', line: 2 }]);
  });

  it('does NOT flag the generic `scope` carrier', () => {
    const hits = scanForFrameworkVocab([
      { path: 'lib/orchestration/capability.ts', content: 'scope?: Record<string, string>;' },
    ]);
    expect(hits).toEqual([]);
  });

  it('does NOT flag a framework term that only appears in a comment', () => {
    // Prose mentioning a framework term must not read as a leak (consistent with
    // extractTables ignoring comments).
    const hits = scanForFrameworkVocab([
      { path: 'lib/a.ts', content: '// this maps to the framework moduleId\nconst x = 1;' },
      { path: 'lib/b.ts', content: '/* nodeKey lives on the framework side */\nexport {};' },
    ]);
    expect(hits).toEqual([]);
  });

  it('still flags a framework term used in code even with a nearby comment', () => {
    const hits = scanForFrameworkVocab([
      { path: 'lib/c.ts', content: '// ok\ninterface Ctx {\n  moduleId: string;\n}' },
    ]);
    expect(hits).toEqual([{ path: 'lib/c.ts', token: 'moduleId', line: 3 }]);
  });

  it('respects word boundaries (no partial-token matches)', () => {
    const hits = scanForFrameworkVocab([
      { path: 'lib/x.ts', content: 'const submoduleIdentifier = 1; const nodeKeys = [];' },
    ]);
    expect(hits).toEqual([]);
  });

  it('reports one hit per (file, token, line)', () => {
    const hits = scanForFrameworkVocab([
      { path: 'lib/a.ts', content: 'moduleSlug\nnodeKey' },
      { path: 'lib/b.ts', content: 'dataSlot' },
    ]);
    expect(hits).toEqual([
      { path: 'lib/a.ts', token: 'moduleSlug', line: 1 },
      { path: 'lib/a.ts', token: 'nodeKey', line: 2 },
      { path: 'lib/b.ts', token: 'dataSlot', line: 1 },
    ]);
  });
});

describe('isCoreSource', () => {
  // The vocab scan runs over `lib`, `app`, `components`, `prisma/schema`. Anything
  // this returns true for is held to the zero-framework-vocabulary ban, so a path
  // wrongly classified as core fails CI for using the vocabulary it is entitled to.
  it.each([
    ['a core lib module', 'lib/orchestration/chat/handler.ts'],
    ['a core route', 'app/api/v1/admin/orchestration/agents/route.ts'],
    ['a core component', 'components/admin/orchestration/agents-table.tsx'],
    ['a core page', 'app/(protected)/dashboard/page.tsx'],
    ['the platform schema', 'prisma/schema/platform.prisma'],
    // A leaf's OWN vocabulary is not a reserved namespace — it is core as far as
    // this scan is concerned, and the leaf overrides via its own ESLint seam.
    ['a leaf route outside the reserved namespace', 'app/(protected)/programme/page.tsx'],
  ])('classifies %s as core', (_label, rel) => {
    expect(isCoreSource(rel)).toBe(true);
  });

  it.each([
    ['the framework itself', 'lib/framework/facilitation/journey/create.ts'],
    ['framework admin pages', 'app/admin/framework/modules/page.tsx'],
    ['framework admin components', 'components/admin/framework/journey-canvas.tsx'],
    ['framework admin routes', 'app/api/v1/admin/framework/modules/route.ts'],
    ['framework consumer routes', 'app/api/v1/framework/surface/route.ts'],
    ['a framework schema file', 'prisma/schema/framework-facilitation.prisma'],
  ])('exempts %s (framework tier)', (_label, rel) => {
    expect(isCoreSource(rel)).toBe(false);
  });

  it.each([
    ['the leaf lib surface', 'lib/app/leaf-bootstrap.ts'],
    ['the leaf schema', 'prisma/schema/app.prisma'],
    // #157: these three MIRROR the reserved-namespace exemptions in
    // lib/framework/eslint.config.mjs. Exempting a leaf route from the import ban
    // without exempting it here just moves the failure to this scan.
    ['leaf consumer routes', 'app/api/v1/app/runs/route.ts'],
    ['leaf authenticated pages', 'app/(protected)/app/dashboard/page.tsx'],
    ['leaf public pages', 'app/(public)/app/landing/page.tsx'],
    ['leaf auth-flow pages', 'app/(auth)/app/onboarding/page.tsx'],
    ['leaf admin pages', 'app/admin/app/settings/page.tsx'],
    ['leaf components', 'components/app/run-card.tsx'],
  ])('exempts %s (leaf tier)', (_label, rel) => {
    expect(isCoreSource(rel)).toBe(false);
  });

  it('exempts test files wherever they live', () => {
    expect(isCoreSource('lib/orchestration/handler.test.ts')).toBe(false);
    expect(isCoreSource('components/foo.spec.tsx')).toBe(false);
  });

  it('does not exempt a path that merely CONTAINS a reserved segment', () => {
    // Prefix matching, not substring: a core route about "apps" is still core.
    expect(isCoreSource('app/api/v1/admin/apps/route.ts')).toBe(true);
    expect(isCoreSource('lib/apps/registry.ts')).toBe(true);
    // ...and a file NAMED like the leaf schema elsewhere is not the leaf schema.
    expect(isCoreSource('lib/framework-adjacent.ts')).toBe(true);
  });
});
