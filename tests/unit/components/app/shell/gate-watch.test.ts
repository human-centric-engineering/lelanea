/**
 * `GateWatch` — a gate refusal from our own API takes the person to the gate
 * (t-159).
 *
 * `watchForGate` is driven with a fake `fetch` and a recorded `navigate`, so
 * what is proved is the decision: which responses navigate, where to, once,
 * and that every response — refusal or not — still reaches its caller intact.
 */

import { describe, it, expect, vi } from 'vitest';

import { gateLocationFrom, watchForGate } from '@/components/app/shell/gate-watch';
import { GATE_REQUIRED } from '@/lib/app/gateway/gate-codes';

const ORIGIN = 'http://localhost:3000';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const GATED_403 = () =>
  json(403, {
    success: false,
    error: { code: GATE_REQUIRED, message: 'x', details: { location: '/verify-email?email=a' } },
  });
const GATED_TURN_409 = () =>
  json(409, {
    success: false,
    error: { code: 'CONFLICT', message: 'x', details: { reason: GATE_REQUIRED } },
  });

function harness(response: () => Response) {
  const target = { fetch: vi.fn(async () => response()) as unknown as typeof fetch };
  const navigate = vi.fn();
  const restore = watchForGate(target, navigate, ORIGIN);
  return { target, navigate, restore };
}

describe('gateLocationFrom', () => {
  it('reads the location from an app route refusal', async () => {
    await expect(gateLocationFrom(GATED_403())).resolves.toBe('/verify-email?email=a');
  });

  it('sends a refused turn to the gate page', async () => {
    await expect(gateLocationFrom(GATED_TURN_409())).resolves.toBe('/app/begin');
  });

  it('never follows a location off this site', async () => {
    for (const location of ['https://evil.example/', '//evil.example/', '/\\evil.example']) {
      const response = json(403, {
        success: false,
        error: { code: GATE_REQUIRED, details: { location } },
      });
      await expect(gateLocationFrom(response)).resolves.toBe('/app/begin');
    }
  });

  it('ignores every other refusal', async () => {
    const other = [
      json(403, { success: false, error: { code: 'FORBIDDEN', message: 'no' } }),
      json(409, {
        success: false,
        error: { code: 'CONFLICT', details: { reason: 'TURN_IN_FLIGHT' } },
      }),
      json(401, { success: false, error: { code: GATE_REQUIRED } }),
      new Response('not json', { status: 403 }),
    ];
    for (const response of other) await expect(gateLocationFrom(response)).resolves.toBeNull();
  });
});

describe('watchForGate', () => {
  it('navigates on a gate refusal from our own API, and still hands the response back', async () => {
    const { target, navigate } = harness(GATED_403);

    const response = await target.fetch('/api/v1/app/notes');

    expect(navigate).toHaveBeenCalledWith('/verify-email?email=a');
    // The caller's own read of the body is untouched by ours.
    expect(await response.json()).toMatchObject({ error: { code: GATE_REQUIRED } });
  });

  it('navigates once, however many panes are refused together', async () => {
    const { target, navigate } = harness(GATED_TURN_409);
    await Promise.all([target.fetch('/api/v1/app/usage'), target.fetch('/api/v1/app/notes')]);
    await target.fetch('/api/v1/framework/facilitation/facilitator/chat/stream');
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('leaves another origin, a non-API path and a success alone', async () => {
    const offSite = harness(GATED_403);
    await offSite.target.fetch('https://elsewhere.example/api/v1/app/notes');
    await offSite.target.fetch('/app/journey');
    expect(offSite.navigate).not.toHaveBeenCalled();

    const ok = harness(() => json(200, { success: true, data: {} }));
    await ok.target.fetch('/api/v1/app/notes');
    expect(ok.navigate).not.toHaveBeenCalled();
  });

  it('calls the original on its owner, as the browser requires of window.fetch', async () => {
    const target: { fetch: typeof fetch } = {
      fetch: function (this: unknown) {
        // A detached call would leave `this` undefined: the browser's "Illegal invocation".
        if (this !== target) throw new TypeError('Illegal invocation');
        return Promise.resolve(json(200, { success: true }));
      },
    };
    watchForGate(target, vi.fn(), ORIGIN);
    await expect(target.fetch('/api/v1/app/notes')).resolves.toBeInstanceOf(Response);
  });

  it('puts the original fetch back, unless something wrapped it after', () => {
    const original = vi.fn() as unknown as typeof fetch;
    const target = { fetch: original };
    const restore = watchForGate(target, vi.fn(), ORIGIN);
    expect(target.fetch).not.toBe(original);
    restore();
    expect(target.fetch).toBe(original);

    const later = vi.fn() as unknown as typeof fetch;
    const restoreAgain = watchForGate(target, vi.fn(), ORIGIN);
    target.fetch = later;
    restoreAgain();
    expect(target.fetch).toBe(later);
  });
});
