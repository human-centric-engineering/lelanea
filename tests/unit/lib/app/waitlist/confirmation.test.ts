/**
 * The waitlist confirmation's send — the properties the route relies on.
 *
 * It sends the right thing to the right address, it never throws whatever the
 * mailer does, and it never puts the address in the leaf's own log line.
 *
 * @see lib/app/waitlist/confirmation.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendEmailMock, log, env } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  // One object, mutated per case, so the origin fallback can be driven
  // without re-importing the module.
  env: {
    NEXT_PUBLIC_APP_URL: 'https://lelanea.example',
    BETTER_AUTH_URL: 'https://fallback.example',
  },
}));

vi.mock('@/lib/email/send', () => ({ sendEmail: sendEmailMock }));
vi.mock('@/lib/logging', () => ({ logger: log }));
vi.mock('@/lib/env', () => ({ env }));

import WaitlistConfirmationEmail from '@/components/app/emails/waitlist-confirmation';
import { sendWaitlistConfirmation } from '@/lib/app/waitlist/confirmation';

const INPUT = { entryId: 'entry-1', email: 'ada@example.com', name: 'Ada Lovelace' };

beforeEach(() => {
  vi.clearAllMocks();
  env.NEXT_PUBLIC_APP_URL = 'https://lelanea.example';
  sendEmailMock.mockResolvedValue({ success: true, status: 'sent', id: 'msg-1' });
});

describe('sendWaitlistConfirmation', () => {
  it('sends the confirmation template to the joiner, from the app origin', async () => {
    await sendWaitlistConfirmation(INPUT);

    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const [options] = sendEmailMock.mock.calls[0];
    expect(options.to).toBe('ada@example.com');
    expect(options.subject).toMatch(/on the .* list/);
    expect(options.react.type).toBe(WaitlistConfirmationEmail);
    expect(options.react.props).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      baseUrl: 'https://lelanea.example',
    });
  });

  it('falls back to the auth URL for the origin when the public one is unset', async () => {
    env.NEXT_PUBLIC_APP_URL = undefined;
    await sendWaitlistConfirmation(INPUT);
    expect(sendEmailMock.mock.calls[0][0].react.props.baseUrl).toBe('https://fallback.example');
  });

  it('logs the entry id, never the address', async () => {
    await sendWaitlistConfirmation(INPUT);
    const logged = JSON.stringify([
      ...log.info.mock.calls,
      ...log.warn.mock.calls,
      ...log.error.mock.calls,
    ]);
    expect(logged).toContain('entry-1');
    expect(logged).not.toContain('ada@example.com');
  });

  it('logs a mailer failure and does not throw', async () => {
    sendEmailMock.mockResolvedValue({ success: false, status: 'failed', error: 'bounced' });
    await expect(sendWaitlistConfirmation(INPUT)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(
      'Waitlist confirmation not sent',
      expect.objectContaining({ entryId: 'entry-1', status: 'failed', error: 'bounced' })
    );
  });

  it('logs an unconfigured mailer as not sent, and does not throw', async () => {
    sendEmailMock.mockResolvedValue({ success: false, status: 'not_configured' });
    await expect(sendWaitlistConfirmation(INPUT)).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalled();
  });

  it('logs a thrown mailer and does not throw', async () => {
    // `sendEmail` has its own try; this is the guard for anything outside it —
    // the render, the env read — because the caller has already answered the
    // visitor and there is nobody left to catch.
    sendEmailMock.mockRejectedValue(new Error('network'));
    await expect(sendWaitlistConfirmation(INPUT)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'Waitlist confirmation threw',
      expect.objectContaining({ entryId: 'entry-1', error: 'network' })
    );
  });

  it('logs a non-Error throw as a string, and does not throw', async () => {
    sendEmailMock.mockRejectedValue('boom');
    await expect(sendWaitlistConfirmation(INPUT)).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalledWith(
      'Waitlist confirmation threw',
      expect.objectContaining({ error: 'boom' })
    );
  });
});
