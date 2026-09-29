/**
 * The golden set's dataset id (t-114). `ai_dataset.id` is unique across the
 * install while the golden set is per org, so an org other than the install
 * org carries its id in the dataset's; the install org keeps the id its
 * datasets and comparisons already have. The org is always named by the
 * caller, so this stays a pure string builder.
 *
 * @see lib/app/voice/golden-set.ts
 */
import { describe, it, expect } from 'vitest';

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

  it('gives each org a prefix of its own for listing its versions', () => {
    expect(goldenSetDatasetId('', INSTALL_ORG_ID)).toBe('lelanea-voice-golden-set-v');
    expect(goldenSetDatasetId('', 'corg2')).toBe('lelanea-voice-golden-set-corg2-v');
  });
});
