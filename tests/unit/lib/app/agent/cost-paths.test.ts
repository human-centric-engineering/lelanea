/**
 * The cost view's paths (f-budget t-97). A turn id is client-chosen — any
 * trimmed 1–128 characters — so every segment is encoded. `.` and `..` cannot
 * be made safe by escaping (the URL standard reads `%2E` as a dot); see the
 * note on `segment()`.
 *
 * @see lib/app/agent/endpoint.ts
 */

import { describe, expect, it } from 'vitest';

import {
  adminConversationTurnsEndpoint,
  adminTurnMeterEndpoint,
  costConversationPage,
  costTurnPage,
} from '@/lib/app/agent/endpoint';

const PERSON = 'cmu7person000000000000000';

describe('cost view paths', () => {
  it('encodes an ordinary id', () => {
    expect(costTurnPage(PERSON, 'turn 1/a')).toBe(`/admin/app/cost/turns/${PERSON}/turn%201%2Fa`);
    expect(adminTurnMeterEndpoint(PERSON, 'turn 1')).toBe(
      `/api/v1/admin/app/metering/users/${PERSON}/turns/turn%201`
    );
  });

  it('builds the conversation paths the same way', () => {
    expect(costConversationPage('cmuconv1')).toBe('/admin/app/cost/conversations/cmuconv1');
    expect(adminConversationTurnsEndpoint('cmuconv1')).toBe(
      '/api/v1/admin/app/metering/conversations/cmuconv1'
    );
  });
});
