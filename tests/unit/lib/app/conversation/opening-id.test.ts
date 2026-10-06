/**
 * The ids of the turns the agent opens: the welcome (t-122) and each
 * session's recap (f-recap t-142).
 *
 * @see lib/app/conversation/opening-id.ts
 */

import { describe, expect, it } from 'vitest';

import {
  isAgentOpenedTurnId,
  isOpeningTurnId,
  isRecapTurnId,
  OPENING_TURN_ID,
  recapTurnId,
} from '@/lib/app/conversation/opening-id';

describe('recapTurnId', () => {
  it('is keyed on the session, so two sessions never share one', () => {
    expect(recapTurnId('ses_a')).not.toBe(recapTurnId('ses_b'));
    expect(recapTurnId('ses_a')).toBe(recapTurnId('ses_a'));
  });

  it('is a recap’s and not the welcome’s', () => {
    expect(isRecapTurnId(recapTurnId('ses_a'))).toBe(true);
    expect(isOpeningTurnId(recapTurnId('ses_a'))).toBe(false);
    expect(isRecapTurnId(OPENING_TURN_ID)).toBe(false);
  });

  it('reads any version of the prefix as a recap', () => {
    expect(isRecapTurnId('app_recap_v2_ses_a')).toBe(true);
  });
});

describe('isAgentOpenedTurnId', () => {
  it('is true of the welcome and a recap, and of no member turn', () => {
    expect(isAgentOpenedTurnId(OPENING_TURN_ID)).toBe(true);
    expect(isAgentOpenedTurnId(recapTurnId('ses_a'))).toBe(true);
    expect(isAgentOpenedTurnId('srv_123')).toBe(false);
    expect(isAgentOpenedTurnId('a-client-id')).toBe(false);
  });
});
