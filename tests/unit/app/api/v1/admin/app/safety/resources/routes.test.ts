/**
 * The crisis resource admin routes (f-safety t-63): admin-only, Zod-validated,
 * and every write that changes something goes to the admin audit log — the
 * only place "who edited" and "who signed off" are kept. The draft reset and
 * the version check are the writer's, proved in `crisis-admin.test.ts`.
 *
 * @see app/api/v1/admin/app/safety/resources/
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

import {
  mockAdminUser,
  mockAuthenticatedUser,
  mockUnauthenticatedUser,
} from '@/tests/helpers/auth';

const admin = vi.hoisted(() => ({
  getCrisisAdminView: vi.fn(),
  updateCrisisCopy: vi.fn(),
  signOffCrisisCopy: vi.fn(),
  createCrisisRegion: vi.fn(),
  updateCrisisRegion: vi.fn(),
  signOffCrisisRegion: vi.fn(),
  removeCrisisRegion: vi.fn(),
  logAdminAction: vi.fn(),
}));

vi.mock('@/lib/auth/config', () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock('next/headers', () => ({ headers: () => Promise.resolve(new Headers()) }));
vi.mock('@/lib/app/safety/crisis-admin', () => admin);
vi.mock('@/lib/orchestration/audit/admin-audit-logger', () => ({
  logAdminAction: admin.logAdminAction,
}));

import { auth } from '@/lib/auth/config';
import { GET } from '@/app/api/v1/admin/app/safety/resources/route';
import { PUT as putCopy } from '@/app/api/v1/admin/app/safety/resources/copy/route';
import { POST as signOffCopy } from '@/app/api/v1/admin/app/safety/resources/copy/sign-off/route';
import { POST as addRegion } from '@/app/api/v1/admin/app/safety/resources/regions/route';
import {
  PUT as putRegion,
  DELETE as deleteRegion,
} from '@/app/api/v1/admin/app/safety/resources/regions/[region]/route';
import { POST as signOffRegion } from '@/app/api/v1/admin/app/safety/resources/regions/[region]/sign-off/route';

const BASE = 'https://lelanea.com/api/v1/admin/app/safety/resources';
const SERVICE = { name: 'Samaritans', contact: 'Call 116 123', hours: '24 hours a day' };
const COPY_BODY = {
  hardIntro: 'Hard.',
  softIntro: 'Soft.',
  emergency: 'Call your local emergency number now.',
  keptMessage: 'Kept.',
  internationalName: 'Find A Helpline',
  internationalContact: 'findahelpline.com',
  internationalUrl: 'https://findahelpline.com',
  internationalHours: 'Over 130 countries',
};
const REGION_ROW = {
  region: 'GB',
  emergencyNumber: '999',
  services: [SERVICE],
  malformed: false,
  status: 'draft',
  version: 3,
};

function req(method: string, path: string, body?: unknown): NextRequest {
  return new Request(`${BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const regionParams = (region: string) => ({ params: Promise.resolve({ region }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth.api.getSession).mockResolvedValue(mockAdminUser());
  admin.getCrisisAdminView.mockResolvedValue({ seeded: true, copy: null, regions: [REGION_ROW] });
  admin.updateCrisisCopy.mockResolvedValue({
    copy: { ...COPY_BODY, status: 'draft', version: 2 },
    changes: { hardIntro: { from: 'Old.', to: 'Hard.' } },
  });
  admin.signOffCrisisCopy.mockResolvedValue({ ...COPY_BODY, status: 'signed_off', version: 2 });
  admin.createCrisisRegion.mockResolvedValue({ ...REGION_ROW, region: 'FR', version: 1 });
  admin.updateCrisisRegion.mockResolvedValue({
    region: REGION_ROW,
    changes: { emergencyNumber: { from: '112', to: '999' } },
  });
  admin.signOffCrisisRegion.mockResolvedValue({ ...REGION_ROW, status: 'signed_off' });
  admin.removeCrisisRegion.mockResolvedValue(REGION_ROW);
});

describe('the guard', () => {
  it('answers 401 to nobody and 403 to a non-admin on every route, and writes nothing', async () => {
    const calls = () => [
      GET(req('GET', '')),
      putCopy(req('PUT', '/copy', COPY_BODY)),
      signOffCopy(req('POST', '/copy/sign-off', { version: 1 })),
      addRegion(
        req('POST', '/regions', { region: 'FR', emergencyNumber: '112', services: [SERVICE] })
      ),
      putRegion(
        req('PUT', '/regions/GB', { emergencyNumber: '999', services: [SERVICE] }),
        regionParams('GB')
      ),
      deleteRegion(req('DELETE', '/regions/GB'), regionParams('GB')),
      signOffRegion(req('POST', '/regions/GB/sign-off', { version: 1 }), regionParams('GB')),
    ];

    vi.mocked(auth.api.getSession).mockResolvedValue(mockUnauthenticatedUser());
    for (const response of await Promise.all(calls())) expect(response.status).toBe(401);

    vi.mocked(auth.api.getSession).mockResolvedValue(mockAuthenticatedUser('USER'));
    for (const response of await Promise.all(calls())) expect(response.status).toBe(403);

    for (const fn of Object.values(admin)) expect(fn).not.toHaveBeenCalled();
  });
});

describe('GET', () => {
  it('returns whether the tables are the source, and what they hold', async () => {
    const response = await GET(req('GET', ''));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { seeded: boolean; regions: unknown[] } };
    expect(body.data.seeded).toBe(true);
    expect(body.data.regions).toHaveLength(1);
  });
});

describe('PUT copy', () => {
  it('saves, and audits the before and after', async () => {
    const response = await putCopy(req('PUT', '/copy', COPY_BODY));
    expect(response.status).toBe(200);
    expect(admin.updateCrisisCopy).toHaveBeenCalledWith(COPY_BODY);
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_crisis_copy.update',
        changes: { hardIntro: { from: 'Old.', to: 'Hard.' } },
        metadata: { version: 2, status: 'draft' },
      })
    );
  });

  it('writes no audit entry for a save that changed nothing', async () => {
    admin.updateCrisisCopy.mockResolvedValue({
      copy: { ...COPY_BODY, status: 'signed_off', version: 1 },
      changes: {},
    });
    expect((await putCopy(req('PUT', '/copy', COPY_BODY))).status).toBe(200);
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing field', { ...COPY_BODY, keptMessage: undefined }],
    ['an empty intro', { ...COPY_BODY, hardIntro: '   ' }],
    ['a directory link that is not https', { ...COPY_BODY, internationalUrl: 'http://x.example' }],
    ['an unknown field', { ...COPY_BODY, status: 'signed_off' }],
  ])('refuses 400 for %s, writing nothing', async (_label, body) => {
    expect((await putCopy(req('PUT', '/copy', body))).status).toBe(400);
    expect(admin.updateCrisisCopy).not.toHaveBeenCalled();
  });
});

describe('sign-off', () => {
  it('signs off the copy at the version read, and audits who did', async () => {
    expect((await signOffCopy(req('POST', '/copy/sign-off', { version: 2 }))).status).toBe(200);
    expect(admin.signOffCrisisCopy).toHaveBeenCalledWith(2);
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_crisis_copy.sign_off', metadata: { version: 2 } })
    );
  });

  it('signs off a region, upper-casing its code', async () => {
    const response = await signOffRegion(
      req('POST', '/regions/gb/sign-off', { version: 3 }),
      regionParams('gb')
    );
    expect(response.status).toBe(200);
    expect(admin.signOffCrisisRegion).toHaveBeenCalledWith('GB', 3);
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_crisis_region.sign_off',
        entityId: 'app_crisis_region:GB',
      })
    );
  });

  it('refuses 400 without a version', async () => {
    expect((await signOffCopy(req('POST', '/copy/sign-off', {}))).status).toBe(400);
    expect(admin.signOffCrisisCopy).not.toHaveBeenCalled();
  });
});

describe('regions', () => {
  it('adds one (201), upper-casing the code, and audits it', async () => {
    const response = await addRegion(
      req('POST', '/regions', { region: 'fr', emergencyNumber: '112', services: [SERVICE] })
    );
    expect(response.status).toBe(201);
    expect(admin.createCrisisRegion).toHaveBeenCalledWith({
      region: 'FR',
      emergencyNumber: '112',
      services: [SERVICE],
    });
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_crisis_region.create' })
    );
  });

  it.each([
    ['a three-letter code', { region: 'FRA', emergencyNumber: '112', services: [SERVICE] }],
    ['no services', { region: 'FR', emergencyNumber: '112', services: [] }],
    [
      'a service with no contact',
      { region: 'FR', emergencyNumber: '112', services: [{ ...SERVICE, contact: '' }] },
    ],
  ])('refuses 400 for %s', async (_label, body) => {
    expect((await addRegion(req('POST', '/regions', body))).status).toBe(400);
    expect(admin.createCrisisRegion).not.toHaveBeenCalled();
  });

  it('edits one, and audits the before and after', async () => {
    const body = { emergencyNumber: '999', services: [SERVICE] };
    expect((await putRegion(req('PUT', '/regions/GB', body), regionParams('GB'))).status).toBe(200);
    expect(admin.updateCrisisRegion).toHaveBeenCalledWith('GB', body);
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_crisis_region.update',
        changes: { emergencyNumber: { from: '112', to: '999' } },
      })
    );
  });

  it('writes no audit entry for a region save that changed nothing', async () => {
    admin.updateCrisisRegion.mockResolvedValue({ region: REGION_ROW, changes: {} });
    const body = { emergencyNumber: '999', services: [SERVICE] };
    expect((await putRegion(req('PUT', '/regions/GB', body), regionParams('GB'))).status).toBe(200);
    expect(admin.logAdminAction).not.toHaveBeenCalled();
  });

  it('refuses 400 for a region code in the path that is not one', async () => {
    const response = await putRegion(
      req('PUT', '/regions/G1', { emergencyNumber: '999', services: [SERVICE] }),
      regionParams('G1')
    );
    expect(response.status).toBe(400);
    expect(admin.updateCrisisRegion).not.toHaveBeenCalled();
  });

  it('removes one, and audits what it held', async () => {
    expect((await deleteRegion(req('DELETE', '/regions/GB'), regionParams('GB'))).status).toBe(200);
    expect(admin.removeCrisisRegion).toHaveBeenCalledWith('GB');
    expect(admin.logAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'app_crisis_region.delete',
        metadata: expect.objectContaining({ emergencyNumber: '999', services: [SERVICE] }),
      })
    );
  });
});
