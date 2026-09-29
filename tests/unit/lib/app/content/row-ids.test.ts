/**
 * `idsBySlug` (t-113): a child row finds its parent's generated id by name,
 * and a name nobody wrote is refused rather than written as a dangling key.
 */
import { describe, it, expect } from 'vitest';
import { idsBySlug } from '@/lib/app/content/row-ids';

describe('idsBySlug', () => {
  const idOf = idsBySlug(
    [
      { id: 'cgenerated1', slug: 'module_01_values' },
      { id: 'cgenerated2', slug: 'module_02_body' },
    ],
    'journey module'
  );

  it('returns the generated id written for each name', () => {
    expect(idOf('module_01_values')).toBe('cgenerated1');
    expect(idOf('module_02_body')).toBe('cgenerated2');
  });

  it('refuses rows that name one parent twice, rather than picking by order', () => {
    expect(() =>
      idsBySlug(
        [
          { id: 'cinstall', slug: 'the_mission' },
          { id: 'cother', slug: 'the_mission' },
        ],
        'foundational document'
      )
    ).toThrow('More than one foundational document is named "the_mission"');
  });

  it('refuses a name with no row, naming what was looked for', () => {
    expect(() => idOf('module_99_missing')).toThrow(
      'There is no journey module "module_99_missing"'
    );
  });
});
