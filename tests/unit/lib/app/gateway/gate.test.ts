/**
 * Where the gate sends a person, and in what order it decides.
 *
 * The ledger is mocked here (its own behaviour is `acknowledgements.test.ts`);
 * what this file owns is the verification rule and the precedence between the
 * two checks. `@/lib/env` is mocked explicitly, as `B9` says to, because the
 * harness reads server-side variables as undefined and the rule under test is
 * exactly a branch on one.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const { env, getGateStatus } = vi.hoisted(() => ({
  env: { REQUIRE_EMAIL_VERIFICATION: undefined as boolean | undefined, NODE_ENV: 'test' },
  getGateStatus: vi.fn(),
}));
vi.mock('@/lib/env', () => ({ env }));
vi.mock('@/lib/app/gateway/acknowledgements', () => ({ getGateStatus }));

import {
  BEGIN_ROUTE,
  gateRedirectFor,
  isEmailVerificationRequired,
  VERIFY_EMAIL_ROUTE,
  verificationRedirectFor,
} from '@/lib/app/gateway/gate';

const VERIFIED = { id: 'user-1', email: 'ada@example.com', emailVerified: true };
const UNVERIFIED = { ...VERIFIED, emailVerified: false };

beforeEach(() => {
  vi.clearAllMocks();
  env.REQUIRE_EMAIL_VERIFICATION = undefined;
  env.NODE_ENV = 'test';
  getGateStatus.mockResolvedValue({ complete: true, kinds: [], outstanding: [] });
});

describe('isEmailVerificationRequired', () => {
  it('is the platform rule: the variable if set, else production-only', () => {
    expect(isEmailVerificationRequired()).toBe(false);
    env.NODE_ENV = 'production';
    expect(isEmailVerificationRequired()).toBe(true);
    env.REQUIRE_EMAIL_VERIFICATION = false;
    expect(isEmailVerificationRequired()).toBe(false);
    env.NODE_ENV = 'development';
    env.REQUIRE_EMAIL_VERIFICATION = true;
    expect(isEmailVerificationRequired()).toBe(true);
  });

  it('evaluates the SAME expression lib/auth/config.ts applies to sign-in', () => {
    // The platform does not export its rule, so the gate restates it. This is
    // the pin: if Sunrise changes how it decides, the gate and sign-in disagree
    // and this fails naming both files.
    const rule = "env.REQUIRE_EMAIL_VERIFICATION ?? env.NODE_ENV === 'production'";
    const config = readFileSync(path.join(process.cwd(), 'lib/auth/config.ts'), 'utf8');
    const gate = readFileSync(path.join(process.cwd(), 'lib/app/gateway/gate.ts'), 'utf8');
    expect(config).toContain(rule);
    expect(gate).toContain(rule);
  });
});

describe('verificationRedirectFor', () => {
  it('sends an unverified address to the verify page, with the email for the resend', () => {
    env.REQUIRE_EMAIL_VERIFICATION = true;
    expect(verificationRedirectFor(UNVERIFIED)).toBe(
      `${VERIFY_EMAIL_ROUTE}?email=ada%40example.com`
    );
  });

  it('does not ask when verification is off — nobody was ever sent an email', () => {
    env.REQUIRE_EMAIL_VERIFICATION = false;
    expect(verificationRedirectFor(UNVERIFIED)).toBeNull();
  });

  it('lets a verified address through whatever the setting', () => {
    env.REQUIRE_EMAIL_VERIFICATION = true;
    expect(verificationRedirectFor(VERIFIED)).toBeNull();
  });
});

describe('gateRedirectFor', () => {
  it('sends to /app/begin while any kind is outstanding', async () => {
    getGateStatus.mockResolvedValue({ complete: false, kinds: [], outstanding: ['terms'] });
    await expect(gateRedirectFor(VERIFIED)).resolves.toBe(BEGIN_ROUTE);
    expect(getGateStatus).toHaveBeenCalledWith('user-1');
  });

  it('lets a fully acknowledged person in', async () => {
    await expect(gateRedirectFor(VERIFIED)).resolves.toBeNull();
  });

  it('checks verification FIRST, and does not read the ledger for an unverified address', async () => {
    env.REQUIRE_EMAIL_VERIFICATION = true;
    getGateStatus.mockResolvedValue({ complete: false, kinds: [], outstanding: ['terms'] });

    const target = await gateRedirectFor(UNVERIFIED);

    expect(target).toMatch(new RegExp(`^${VERIFY_EMAIL_ROUTE}`));
    expect(getGateStatus).not.toHaveBeenCalled();
  });
});
