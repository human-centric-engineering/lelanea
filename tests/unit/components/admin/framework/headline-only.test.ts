/**
 * Unit test — headlineOnly.
 *
 * @see components/admin/framework/headline-only.ts
 */

import { describe, it, expect } from 'vitest';

import { headlineOnly } from '@/components/admin/framework/headline-only';
import { APIClientError } from '@/lib/api/client';
import { readSaveError } from '@/lib/errors/save-error';

describe('headlineOnly', () => {
  const refused = new APIClientError('Please re-propose', 'VALIDATION_ERROR', 400, {
    baseVersion: ['Proposed against version 3'],
  });

  it('makes readSaveError show the message, not the details', () => {
    const options = { fallback: 'fallback', fields: {} };
    expect(readSaveError(refused, options).message).toBe('Proposed against version 3');
    expect(readSaveError(headlineOnly(refused), options).message).toBe('Please re-propose');
  });

  it('keeps the code and status', () => {
    expect(headlineOnly(refused)).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it("keeps validateRequestBody's list, whose message says nothing", () => {
    const invalid = new APIClientError('Invalid request body', 'VALIDATION_ERROR', 400, {
      errors: [{ path: 'name', message: 'Too long' }],
    });
    expect(headlineOnly(invalid)).toBe(invalid);
  });

  it('leaves anything else alone', () => {
    const bug = new Error('a bug');
    expect(headlineOnly(bug)).toBe(bug);
  });
});
