/**
 * Integration tests — framework module workflow-binding admin API
 * (f-module-bindings t-3).
 *
 * The HTTP contract over the workflow-binding service/queries: every route is
 * admin-guarded, bodies/params are validated, the right function is called with the
 * mapped args, and the standard envelope / status is returned. The service + queries
 * are mocked (their behaviour is proven against a stateful fake in
 * tests/integration/lib/framework/modules/workflow-bindings/*).
 *
 * The mocks are created via `vi.hoisted` and referenced directly, so this test — under
 * an `api/` path, not a `lib/framework` path — never *imports* `@/lib/framework` and
 * stays on the right side of the X6 boundary.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { NotFoundError, StaleRecordError, ValidationError } from '@/lib/api/errors';
import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const svc = vi.hoisted(() => ({
  bindWorkflow: vi.fn(),
  updateWorkflowBinding: vi.fn(),
  unbindWorkflow: vi.fn(),
  listModuleWorkflowBindings: vi.fn(),
}));

vi.mock('@/lib/framework/modules/workflow-bindings/service', () => ({
  bindWorkflow: svc.bindWorkflow,
  updateWorkflowBinding: svc.updateWorkflowBinding,
  unbindWorkflow: svc.unbindWorkflow,
}));
vi.mock('@/lib/framework/modules/workflow-bindings/queries', () => ({
  listModuleWorkflowBindings: svc.listModuleWorkflowBindings,
}));
vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => Promise.resolve(new Headers())) }));

import * as listRoute from '@/app/api/v1/admin/framework/modules/[slug]/workflows/route';
import * as bindingRoute from '@/app/api/v1/admin/framework/modules/[slug]/workflows/[bindingId]/route';
import { auth } from '@/lib/auth/config';

const BASE = 'http://localhost/api/v1/admin/framework/modules';
const WORKFLOW_ID = 'cjld2cjxh0000qzrmn831i7rn';
const BINDING_ID = 'cjld2cyuq0000qzrmabcdef12';

function req(
  method: string,
  body?: unknown,
  url = BASE,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest(url, {
    method,
    ...(body !== undefined
      ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }
      : {}),
  });
}
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });
const ctx2 = (slug: string, bindingId: string) => ({
  params: Promise.resolve({ slug, bindingId }),
});
const asAdmin = () => vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
async function parse<T>(res: Response): Promise<T> {
  return JSON.parse(await res.text()) as T;
}
const validBind = { workflowId: WORKFLOW_ID, eventType: 'module.completed' };
// As the service returns it: versioned (`withTemplateVersion`).
const bindingRow = {
  version: '"v-test"',
  id: BINDING_ID,
  moduleId: 'm1',
  workflowId: WORKFLOW_ID,
  eventType: 'module.completed',
  enabled: true,
};

beforeEach(() => vi.clearAllMocks());

describe('admin guard — every route', () => {
  const routes: [string, () => Promise<Response>][] = [
    ['GET /workflows', () => listRoute.GET(req('GET'), ctx('reading'))],
    ['POST /workflows', () => listRoute.POST(req('POST', validBind), ctx('reading'))],
    [
      'PATCH /workflows/:id',
      () => bindingRoute.PATCH(req('PATCH', { enabled: false }), ctx2('reading', BINDING_ID)),
    ],
    [
      'DELETE /workflows/:id',
      () => bindingRoute.DELETE(req('DELETE'), ctx2('reading', BINDING_ID)),
    ],
  ];

  it.each(routes)('%s returns 401 when unauthenticated', async (_name, invoke) => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    expect((await invoke()).status).toBe(401);
  });

  it('does not touch the service for an unauthorized caller', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    await listRoute.POST(req('POST', validBind), ctx('reading'));
    expect(svc.bindWorkflow).not.toHaveBeenCalled();
  });

  it('returns 403 for a non-admin', async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
    expect((await listRoute.GET(req('GET'), ctx('reading'))).status).toBe(403);
  });
});

describe('GET /modules/:slug/workflows', () => {
  it('returns the bindings in the envelope', async () => {
    asAdmin();
    svc.listModuleWorkflowBindings.mockResolvedValue([
      { ...bindingRow, workflow: { id: WORKFLOW_ID, name: 'W', hasPublishedVersion: true } },
    ]);
    const res = await listRoute.GET(req('GET'), ctx('reading'));
    expect(res.status).toBe(200);
    expect(svc.listModuleWorkflowBindings).toHaveBeenCalledWith('reading');
    const body = await parse<{ success: boolean; data: unknown[] }>(res);
    expect(body).toMatchObject({ success: true, data: [{ eventType: 'module.completed' }] });
  });

  it('rejects a malformed slug with 400 (not 404), service untouched', async () => {
    asAdmin();
    const res = await listRoute.GET(req('GET'), ctx('BAD SLUG'));
    expect(res.status).toBe(400);
    expect(svc.listModuleWorkflowBindings).not.toHaveBeenCalled();
  });

  it('propagates NotFoundError (unknown module) as 404', async () => {
    asAdmin();
    svc.listModuleWorkflowBindings.mockRejectedValue(new NotFoundError('nope'));
    expect((await listRoute.GET(req('GET'), ctx('ghost'))).status).toBe(404);
  });
});

describe('POST /modules/:slug/workflows', () => {
  it('binds a workflow (201) and forwards the mapped args', async () => {
    asAdmin();
    svc.bindWorkflow.mockResolvedValue(bindingRow);
    const res = await listRoute.POST(
      req('POST', {
        workflowId: WORKFLOW_ID,
        eventType: 'module.completed',
        inputTemplate: { a: 1 },
        enabled: false,
      }),
      ctx('reading')
    );
    expect(res.status).toBe(201);
    // A create is new intent, not a copy: no `If-Match`, and it returns the version to save against.
    expect((await parse<{ data: { version: string } }>(res)).data.version).toBe('"v-test"');
    expect(svc.bindWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleSlug: 'reading',
        workflowId: WORKFLOW_ID,
        eventType: 'module.completed',
        inputTemplate: { a: 1 },
        enabled: false,
      })
    );
  });

  it('rejects a missing eventType before calling the service (400)', async () => {
    asAdmin();
    const res = await listRoute.POST(req('POST', { workflowId: WORKFLOW_ID }), ctx('reading'));
    expect(res.status).toBe(400);
    expect(svc.bindWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a non-cuid workflowId (400)', async () => {
    asAdmin();
    expect(
      (
        await listRoute.POST(
          req('POST', { workflowId: 'not-a-cuid', eventType: 'module.completed' }),
          ctx('reading')
        )
      ).status
    ).toBe(400);
  });

  it('maps a duplicate/unknown-workflow ValidationError from the service to 400', async () => {
    asAdmin();
    svc.bindWorkflow.mockRejectedValue(new ValidationError('dup'));
    expect((await listRoute.POST(req('POST', validBind), ctx('reading'))).status).toBe(400);
  });

  it('maps a NotFoundError (unknown module) to 404', async () => {
    asAdmin();
    svc.bindWorkflow.mockRejectedValue(new NotFoundError('unknown module'));
    expect((await listRoute.POST(req('POST', validBind), ctx('reading'))).status).toBe(404);
  });
});

describe('PATCH /modules/:slug/workflows/:bindingId', () => {
  it('updates a binding and forwards the mapped args', async () => {
    asAdmin();
    svc.updateWorkflowBinding.mockResolvedValue({ ...bindingRow, enabled: false });
    const res = await bindingRoute.PATCH(
      req('PATCH', { enabled: false, inputTemplate: { x: 1 } }, BASE, { 'If-Match': '"v1"' }),
      ctx2('reading', BINDING_ID)
    );
    expect(res.status).toBe(200);
    expect(svc.updateWorkflowBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        moduleSlug: 'reading',
        bindingId: BINDING_ID,
        enabled: false,
        inputTemplate: { x: 1 },
        loadedAt: ['"v1"'],
      })
    );
    expect((await parse<{ data: { version: string } }>(res)).data.version).toBe('"v-test"');
  });

  it('refuses a template save without If-Match (428), service untouched', async () => {
    asAdmin();
    const res = await bindingRoute.PATCH(
      req('PATCH', { inputTemplate: { x: 1 } }),
      ctx2('reading', BINDING_ID)
    );
    expect(res.status).toBe(428);
    expect(svc.updateWorkflowBinding).not.toHaveBeenCalled();
  });

  it('answers a stale template save with 412 STALE_RECORD', async () => {
    asAdmin();
    svc.updateWorkflowBinding.mockRejectedValue(new StaleRecordError());
    const res = await bindingRoute.PATCH(
      req('PATCH', { inputTemplate: { x: 1 } }, BASE, { 'If-Match': '"old"' }),
      ctx2('reading', BINDING_ID)
    );
    expect(res.status).toBe(412);
    expect((await parse<{ error: { code: string } }>(res)).error.code).toBe('STALE_RECORD');
  });

  it('toggles enabled with no If-Match: nothing erasure scrubs is written', async () => {
    asAdmin();
    svc.updateWorkflowBinding.mockResolvedValue({ ...bindingRow, enabled: false });
    const res = await bindingRoute.PATCH(
      req('PATCH', { enabled: false }),
      ctx2('reading', BINDING_ID)
    );
    expect(res.status).toBe(200);
    expect(svc.updateWorkflowBinding).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, inputTemplate: undefined, loadedAt: undefined })
    );
  });

  it('rejects an empty patch body (400)', async () => {
    asAdmin();
    const res = await bindingRoute.PATCH(req('PATCH', {}), ctx2('reading', BINDING_ID));
    expect(res.status).toBe(400);
    expect(svc.updateWorkflowBinding).not.toHaveBeenCalled();
  });

  it('rejects a malformed bindingId (400)', async () => {
    asAdmin();
    const res = await bindingRoute.PATCH(req('PATCH', { enabled: false }), ctx2('reading', 'nope'));
    expect(res.status).toBe(400);
    expect(svc.updateWorkflowBinding).not.toHaveBeenCalled();
  });

  it('propagates NotFoundError (binding not in module) as 404', async () => {
    asAdmin();
    svc.updateWorkflowBinding.mockRejectedValue(new NotFoundError('nope'));
    expect(
      (await bindingRoute.PATCH(req('PATCH', { enabled: false }), ctx2('reading', BINDING_ID)))
        .status
    ).toBe(404);
  });
});

describe('DELETE /modules/:slug/workflows/:bindingId', () => {
  it('unbinds and returns the envelope', async () => {
    asAdmin();
    svc.unbindWorkflow.mockResolvedValue(undefined);
    const res = await bindingRoute.DELETE(req('DELETE'), ctx2('reading', BINDING_ID));
    expect(res.status).toBe(200);
    expect(svc.unbindWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ moduleSlug: 'reading', bindingId: BINDING_ID })
    );
    const body = await parse<{ data: { unbound: boolean } }>(res);
    expect(body.data.unbound).toBe(true);
  });

  it('propagates NotFoundError as 404', async () => {
    asAdmin();
    svc.unbindWorkflow.mockRejectedValue(new NotFoundError('nope'));
    expect((await bindingRoute.DELETE(req('DELETE'), ctx2('reading', BINDING_ID))).status).toBe(
      404
    );
  });
});
