/**
 * The framework tier's erasure hook and stale writer (Sunrise 0.16.0 §122).
 *
 * `eraseFromBindingTemplates` runs inside the erasure transaction: it is handed the transaction
 * client, so the tests hand it a small stateful fake of what it touches and assert the rows it
 * leaves; the SQL itself is checked against a real database by a smoke run, not here. The blanking itself is core's real `blankAddressInTemplate`.
 *
 * @see lib/framework/privacy/erasure.ts
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ErasureTxContext } from '@/lib/privacy/erasure-hooks';
import {
  BINDING_PAGE_SIZE,
  BINDING_TEMPLATES_HOOK,
  DISPATCH_FILE,
  eraseFromBindingTemplates,
  initFrameworkErasureHooks,
} from '@/lib/framework/privacy/erasure';
import {
  __resetErasureCleanupHooksForTests,
  getAppStaleWriters,
  getErasureCleanupHooks,
} from '@/lib/privacy/erasure-hooks';

interface BindingRow {
  id: string;
  moduleId: string;
  eventType: string;
  workflowId: string;
  orgId: string | null;
  inputTemplate: unknown;
}

/**
 * The two tables the hook touches. Its read is one raw `SELECT … FOR NO KEY UPDATE`, answered here
 * the way Postgres would: rows past the cursor, with a template, whose folded text holds the
 * search term (or every one, when the address cannot be searched for), a page at a time.
 */
function fakeTx(rows: BindingRow[]) {
  const audits: Array<Record<string, unknown>> = [];
  const pages: number[] = [];
  const sql: string[] = [];
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      sql.push(strings.join('?'));
      const [after, scanAll, term, , limit] = values as [
        string,
        boolean,
        string | null,
        unknown,
        number,
      ];
      const page = [...rows]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter((r) => r.id > after && r.inputTemplate !== null)
        .filter(
          (r) =>
            scanAll ||
            (term !== null && JSON.stringify(r.inputTemplate).toLowerCase().includes(term))
        )
        .slice(0, limit)
        .map((r) => ({ ...r }));
      pages.push(page.length);
      return page;
    },
    moduleWorkflowBinding: {
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { inputTemplate: unknown };
      }) => {
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error(`no binding ${where.id}`);
        row.inputTemplate = data.inputTemplate;
        return row;
      },
    },
    aiAdminAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return data;
      },
    },
  };
  return { tx, audits, pages, sql };
}

function binding(id: string, inputTemplate: unknown): BindingRow {
  return {
    id,
    moduleId: 'm-1',
    eventType: 'module.completed',
    workflowId: 'wf-1',
    orgId: 'org-1',
    inputTemplate,
  };
}

function ctx(tx: unknown, overrides: Partial<ErasureTxContext> = {}): ErasureTxContext {
  return {
    tx: tx as ErasureTxContext['tx'],
    userId: 'user-1',
    email: ' Erased@Example.com ',
    emailVerified: true,
    ...overrides,
  };
}

describe('eraseFromBindingTemplates', () => {
  it('blanks the verified address wherever a template holds it, and audits each change', async () => {
    const rows = [
      binding('b1', { to: 'erased@example.com', cc: 'kept@example.com' }),
      binding('b2', { recipients: ['ERASED@example.com', 'kept@example.com'] }),
      binding('b3', { to: 'kept@example.com' }),
      binding('b4', null),
    ];
    const { tx, audits } = fakeTx(rows);

    const changed = await eraseFromBindingTemplates(ctx(tx));

    expect(changed).toBe(2);
    expect(rows[0].inputTemplate).toEqual({ to: '', cc: 'kept@example.com' });
    expect(rows[1].inputTemplate).toEqual({ recipients: ['kept@example.com'] });
    expect(rows[2].inputTemplate).toEqual({ to: 'kept@example.com' });
    expect(rows[3].inputTemplate).toBeNull();
    expect(audits.map((a) => a.entityId)).toEqual(['b1', 'b2']);
    expect(audits[0]).toMatchObject({
      action: 'module_workflow_binding.recipient_erased',
      entityType: 'module_workflow_binding',
      changes: { inputTemplateValuesCleared: { from: 1, to: 0 } },
      metadata: expect.objectContaining({ orgId: 'org-1', workflowId: 'wf-1' }),
    });
    // The audit row never carries the address it erased.
    expect(JSON.stringify(audits)).not.toMatch(/erased@example\.com/i);
  });

  it('matches nothing for an unverified account — its address may be a stranger’s', async () => {
    const rows = [binding('b1', { to: 'erased@example.com' })];
    const { tx, audits } = fakeTx(rows);

    const changed = await eraseFromBindingTemplates(ctx(tx, { emailVerified: false }));

    expect(changed).toBe(0);
    expect(rows[0].inputTemplate).toEqual({ to: 'erased@example.com' });
    expect(audits).toEqual([]);
  });

  it('reads every page, so a binding past the first is not missed', async () => {
    const rows = Array.from({ length: BINDING_PAGE_SIZE + 1 }, (_, i) =>
      binding(`b${String(i).padStart(4, '0')}`, { to: 'erased@example.com' })
    );
    const { tx, pages } = fakeTx(rows);

    const changed = await eraseFromBindingTemplates(ctx(tx));

    expect(pages).toEqual([BINDING_PAGE_SIZE, 1]);
    expect(changed).toBe(BINDING_PAGE_SIZE + 1);
    expect(rows[BINDING_PAGE_SIZE].inputTemplate).toEqual({ to: '' });
  });
});

describe('eraseFromBindingTemplates — ordered against an operator save', () => {
  it('reads the bindings it may rewrite under a row lock, so a save waits for the erasure', async () => {
    const { tx, sql } = fakeTx([binding('b1', { to: 'erased@example.com' })]);

    await eraseFromBindingTemplates(ctx(tx));

    // Core's schedule pass takes the same lock; without it a save between the read and the
    // write is overwritten, or commits an address the read did not see.
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/FROM framework_module_workflow b/);
    expect(sql[0]).toMatch(/FOR NO KEY UPDATE OF b/);
  });

  it('narrows to templates holding the address, and reads every one when it cannot be searched', async () => {
    const rows = [
      binding('b1', { to: 'erased@example.com' }),
      binding('b2', { to: 'other@example.com' }),
    ];
    const searched = fakeTx(rows);
    await eraseFromBindingTemplates(ctx(searched.tx));
    expect(searched.pages).toEqual([1]);

    // A quote in the address is escaped in the JSON text, so it is searched by domain instead.
    const byDomain = fakeTx([binding('b1', { to: 'o"neil@example.com' })]);
    expect(await eraseFromBindingTemplates(ctx(byDomain.tx, { email: 'o"neil@example.com' }))).toBe(
      1
    );

    // Neither the address nor its domain is printable ASCII: every template is read.
    const scanned = fakeTx([
      binding('b1', { to: 'jürgen@bücher.de' }),
      binding('b2', { to: 'other@example.com' }),
    ]);
    expect(await eraseFromBindingTemplates(ctx(scanned.tx, { email: 'jürgen@bücher.de' }))).toBe(1);
    expect(scanned.pages).toEqual([2]);
    expect(scanned.audits.map((a) => a.entityId)).toEqual(['b1']);
  });

  it('blanks a template that is the bare address to the empty value', async () => {
    const rows = [binding('b1', 'erased@example.com')];
    const { tx } = fakeTx(rows);

    expect(await eraseFromBindingTemplates(ctx(tx))).toBe(1);
    expect(rows[0].inputTemplate).toBe('');
  });
});

describe('initFrameworkErasureHooks', () => {
  beforeEach(() => __resetErasureCleanupHooksForTests());

  it('registers the binding-template hook and declares the dispatcher as a taken-at writer', () => {
    initFrameworkErasureHooks();
    initFrameworkErasureHooks(); // idempotent: keyed registries replace, never duplicate

    const hooks = getErasureCleanupHooks().filter((h) => h.name === BINDING_TEMPLATES_HOOK);
    expect(hooks).toHaveLength(1);
    expect(hooks[0].scrubInTransaction).toBeTypeOf('function');
    expect(getAppStaleWriters()).toEqual([
      expect.objectContaining({
        file: DISPATCH_FILE,
        model: 'AiWorkflowExecution',
        anchor: 'taken-at',
      }),
    ]);
  });

  it('registers a hook that blanks the subject in binding templates when erasure runs it', async () => {
    initFrameworkErasureHooks();
    const hook = getErasureCleanupHooks().find((h) => h.name === BINDING_TEMPLATES_HOOK);
    const rows = [binding('b1', { to: 'erased@example.com' })];
    const { tx } = fakeTx(rows);

    await hook?.scrubInTransaction?.(ctx(tx));

    expect(rows[0].inputTemplate).toEqual({ to: '' });
  });
});
