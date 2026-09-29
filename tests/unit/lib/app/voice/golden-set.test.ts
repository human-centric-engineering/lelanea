/**
 * The golden set's dataset id (t-114). `ai_dataset.id` is unique across the
 * install while the golden set is per org, so an org other than the install
 * org carries its id in the dataset's; the install org keeps the id its
 * datasets and comparisons already have.
 *
 * @see lib/app/voice/golden-set.ts
 */
import { describe, it, expect, vi } from 'vitest';

const tenant = vi.hoisted(() => ({ orgId: 'install' }));
vi.mock('@/lib/tenancy/context', () => ({ requireOrgId: () => tenant.orgId }));

import { goldenSetDatasetId } from '@/lib/app/voice/golden-set';
import { INSTALL_ORG_ID } from '@/lib/tenancy/constants';

describe('goldenSetDatasetId', () => {
  it('keeps the id the install org has always had', () => {
    expect(goldenSetDatasetId('1.1', INSTALL_ORG_ID)).toBe('lelanea-voice-golden-set-v1.1');
  });

  it('puts any other org in the id, so two orgs never claim the same dataset', () => {
    expect(goldenSetDatasetId('1.1', 'corg2')).toBe('lelanea-voice-golden-set-corg2-v1.1');
    expect(goldenSetDatasetId('1.1', 'corg2')).not.toBe(goldenSetDatasetId('1.1', INSTALL_ORG_ID));
  });

  it('takes the org the request entered when none is named', () => {
    tenant.orgId = 'corg3';
    expect(goldenSetDatasetId('2.0')).toBe('lelanea-voice-golden-set-corg3-v2.0');
    tenant.orgId = INSTALL_ORG_ID;
    expect(goldenSetDatasetId('2.0')).toBe('lelanea-voice-golden-set-v2.0');
  });
});
