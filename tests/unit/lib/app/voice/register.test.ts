/**
 * The register rules (f-registers t-125): which register a turn is steered to,
 * where each module starts, and the config field an admin edits.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_REGISTER,
  moduleDefaultRegister,
  parseRegister,
  parseRegisterSource,
  registerConfigField,
  REGISTERS,
  selectRegister,
} from '@/lib/app/voice/register';

describe('selectRegister', () => {
  it.each([
    // moduleRegister, recentCrisis → register, source
    ['teaching', false, 'teaching', 'module'],
    ['guiding', false, 'guiding', 'module'],
    [null, false, DEFAULT_REGISTER, 'module'],
    ['teaching', true, 'guiding', 'safety'],
    ['guiding', true, 'guiding', 'safety'],
    [null, true, 'guiding', 'safety'],
  ] as const)(
    'module %s, crisis %s → %s from %s',
    (moduleRegister, recentCrisis, register, source) => {
      expect(selectRegister({ moduleRegister, recentCrisis })).toEqual({ register, source });
    }
  );

  it('never steers to teaching alongside a crisis, whatever the module says', () => {
    // Population first: teaching is reachable at all.
    expect(selectRegister({ moduleRegister: 'teaching', recentCrisis: false }).register).toBe(
      'teaching'
    );
    for (const moduleRegister of [...REGISTERS, null]) {
      expect(selectRegister({ moduleRegister, recentCrisis: true }).register).toBe('guiding');
    }
  });
});

describe('where a module starts', () => {
  it('starts Values at teaching and every other module at guiding', () => {
    expect(moduleDefaultRegister('values')).toBe('teaching');
    expect(moduleDefaultRegister('boundaries')).toBe('guiding');
    expect(moduleDefaultRegister('onboarding')).toBe('guiding');
    expect(DEFAULT_REGISTER).toBe('guiding');
  });

  it('gives the config field that module’s start as its default, and refuses anything else', () => {
    const values = z.object({ register: registerConfigField('values') });
    const other = z.object({ register: registerConfigField('boundaries') });

    expect(values.parse({})).toEqual({ register: 'teaching' });
    expect(other.parse({})).toEqual({ register: 'guiding' });
    expect(values.parse({ register: 'guiding' })).toEqual({ register: 'guiding' });
    expect(() => other.parse({ register: 'stern' })).toThrow();
  });

  it('describes the field for the admin who sets it', () => {
    expect(registerConfigField('values').description).toMatch(/Guiding holds space/);
  });
});

describe('reading a stored value', () => {
  it('reads a register or a source, and nothing else', () => {
    expect(parseRegister('teaching')).toBe('teaching');
    expect(parseRegister('Teaching')).toBeNull();
    expect(parseRegister(null)).toBeNull();
    expect(parseRegisterSource('safety')).toBe('safety');
    expect(parseRegisterSource('asked')).toBeNull();
  });
});
