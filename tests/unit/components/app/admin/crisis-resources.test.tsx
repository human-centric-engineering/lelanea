// @vitest-environment happy-dom
/**
 * The crisis helplines admin surface (f-safety t-63).
 *
 * What someone using it would notice going wrong: editing offered before the
 * tables are seeded, a sign-off offered over unsaved edits (it would sign off
 * the old words), a sign-off that does not send the version on screen, a saved
 * edit still shown as signed off, a removal with no second step, and a refusal
 * from the route that never reaches the screen.
 *
 * @see components/app/admin/crisis-resources.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CrisisResourcesPanel, type CrisisViewJson } from '@/components/app/admin/crisis-resources';
import {
  CRISIS_COPY_ENDPOINT,
  CRISIS_COPY_SIGN_OFF_ENDPOINT,
  CRISIS_REGIONS_ENDPOINT,
  crisisRegionEndpoint,
  crisisRegionSignOffEndpoint,
} from '@/lib/app/safety/endpoint';

const COPY = {
  hardIntro: 'Hard intro.',
  softIntro: 'Soft intro.',
  emergency: 'Call your local emergency number now.',
  keptMessage: 'Still in the box.',
  internationalName: 'Find A Helpline',
  internationalContact: 'findahelpline.com',
  internationalUrl: 'https://findahelpline.com',
  internationalHours: 'Over 130 countries',
  status: 'signed_off' as const,
  version: 2,
  signedOffAt: '2026-09-19T10:00:00.000Z',
  updatedAt: '2026-09-19T10:00:00.000Z',
};
const GB = {
  region: 'GB',
  emergencyNumber: '999',
  services: [{ name: 'Samaritans', contact: 'Call 116 123', hours: 'Free, 24 hours a day' }],
  malformed: false,
  status: 'draft' as const,
  version: 3,
  signedOffAt: null,
  updatedAt: '2026-09-19T10:00:00.000Z',
};
const VIEW: CrisisViewJson = { seeded: true, copy: COPY, regions: [GB] };

const fetchMock = vi.fn();

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(status: number, message: string) {
  return new Response(JSON.stringify({ success: false, error: { code: 'CONFLICT', message } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function sent(call: number): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return {
    url,
    method: init.method ?? 'GET',
    body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});

describe('before the seed', () => {
  it('says the built-in version is served and offers nothing to edit', () => {
    render(<CrisisResourcesPanel initialView={{ seeded: false, copy: null, regions: [] }} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/npm run db:seed/);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the shared wording', () => {
  it('saves every field, and shows the result as a draft', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({
        copy: { ...COPY, hardIntro: 'Reworded.', status: 'draft', version: 3 },
        changed: ['hardIntro'],
      })
    );
    render(<CrisisResourcesPanel initialView={VIEW} />);

    const intro = screen.getByLabelText('Opening — when the conversation stops');
    await user.clear(intro);
    await user.type(intro, 'Reworded.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/draft/));
    const { url, method, body } = sent(0);
    expect([url, method]).toEqual([CRISIS_COPY_ENDPOINT, 'PUT']);
    expect(body).toMatchObject({ hardIntro: 'Reworded.', internationalUrl: COPY.internationalUrl });
    const copySection = screen.getByRole('region', { name: 'The wording every country shares' });
    expect(within(copySection).getByText('Draft — awaiting sign-off')).toBeInTheDocument();
    expect(within(copySection).getByRole('button', { name: 'Sign off v3' })).toBeEnabled();
  });

  it('will not sign off over unsaved edits, and signs off the version on screen', async () => {
    const user = userEvent.setup();
    const draft = { ...COPY, status: 'draft' as const, version: 4 };
    fetchMock.mockResolvedValueOnce(ok({ copy: { ...draft, status: 'signed_off' } }));
    render(<CrisisResourcesPanel initialView={{ ...VIEW, copy: draft }} />);

    const signOff = screen.getByRole('button', { name: 'Sign off v4' });
    await user.type(screen.getByLabelText('Directory — name'), ' (edited)');
    expect(signOff).toBeDisabled();
    await user.clear(screen.getByLabelText('Directory — name'));
    await user.type(screen.getByLabelText('Directory — name'), COPY.internationalName);
    expect(signOff).toBeEnabled();

    await user.click(signOff);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signed off.'));
    expect(sent(0)).toEqual({
      url: CRISIS_COPY_SIGN_OFF_ENDPOINT,
      method: 'POST',
      body: { version: 4 },
    });
  });

  it('shows the route’s refusal', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      refused(409, 'The shared wording was changed since you read it.')
    );
    render(<CrisisResourcesPanel initialView={{ ...VIEW, copy: { ...COPY, status: 'draft' } }} />);
    await user.click(screen.getByRole('button', { name: 'Sign off v2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed since you read it/);
  });
});

describe('a country', () => {
  it('signs off a draft region at its version', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ region: { ...GB, status: 'signed_off' } }));
    render(<CrisisResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Sign off v3' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sign off v3' })).toBeNull());
    expect(sent(0)).toEqual({
      url: crisisRegionSignOffEndpoint('GB'),
      method: 'POST',
      body: { version: 3 },
    });
  });

  it('edits the number and helplines, adding one, and saves as a draft', async () => {
    const user = userEvent.setup();
    const saved = {
      ...GB,
      emergencyNumber: '999 or 112',
      services: [...GB.services, { name: 'Shout', contact: 'Text SHOUT to 85258', hours: '24/7' }],
      version: 4,
    };
    fetchMock.mockResolvedValueOnce(
      ok({ region: saved, changed: ['emergencyNumber', 'services'] })
    );
    render(<CrisisResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit GB' });
    await user.clear(within(form).getByLabelText('Emergency number'));
    await user.type(within(form).getByLabelText('Emergency number'), '999 or 112');
    await user.click(within(form).getByRole('button', { name: /Add a helpline/ }));
    const names = within(form).getAllByLabelText('Name');
    await user.type(names[1], 'Shout');
    await user.type(within(form).getAllByLabelText('How to reach them')[1], 'Text SHOUT to 85258');
    await user.type(within(form).getAllByLabelText('When they answer')[1], '24/7');
    await user.click(within(form).getByRole('button', { name: 'Save as a draft' }));

    expect(await screen.findByText('Shout')).toBeInTheDocument();
    expect(sent(0)).toEqual({
      url: crisisRegionEndpoint('GB'),
      method: 'PUT',
      body: { emergencyNumber: '999 or 112', services: saved.services },
    });
    expect(screen.getByText('v4')).toBeInTheDocument();
  });

  it('removes only after a second, explicit step', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ removed: 'GB' }));
    render(<CrisisResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/only the international directory/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove GB' }));
    await waitFor(() => expect(screen.getByText(/No countries are listed/)).toBeInTheDocument());
    expect(sent(0)).toMatchObject({ url: crisisRegionEndpoint('GB'), method: 'DELETE' });
  });

  it('adds a country, upper-casing the code as it is typed', async () => {
    const user = userEvent.setup();
    const fr = { ...GB, region: 'FR', emergencyNumber: '112', version: 1 };
    fetchMock.mockResolvedValueOnce(ok({ region: fr }, 201));
    render(<CrisisResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: /Add a country/ }));
    const form = screen.getByRole('form', { name: 'Add a country' });
    await user.type(within(form).getByLabelText('Country code'), 'fr');
    await user.type(within(form).getByLabelText('Emergency number'), '112');
    await user.type(within(form).getByLabelText('Name'), 'Samaritans');
    await user.type(within(form).getByLabelText('How to reach them'), 'Call 116 123');
    await user.type(within(form).getByLabelText('When they answer'), 'Free, 24 hours a day');
    await user.click(within(form).getByRole('button', { name: 'Add as a draft' }));

    expect(await screen.findByText('FR')).toBeInTheDocument();
    expect(sent(0)).toEqual({
      url: CRISIS_REGIONS_ENDPOINT,
      method: 'POST',
      body: { region: 'FR', emergencyNumber: '112', services: GB.services },
    });
  });

  it('says so, and offers no sign-off, when a region’s stored services are malformed', () => {
    render(
      <CrisisResourcesPanel
        initialView={{ ...VIEW, regions: [{ ...GB, services: [], malformed: true }] }}
      />
    );
    expect(screen.getAllByText(/malformed/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Sign off v3' })).toBeNull();
  });
});
