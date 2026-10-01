// @vitest-environment happy-dom

/**
 * "Begin the journey" (§3.9, t-106): what the step says, what it posts, and
 * what it does when the post fails. That the shell's map reads its states
 * again afterwards is `map-drawer.test.tsx`; what the route does is the
 * route's test and `hand-off.test.ts`.
 *
 * @see components/app/onboarding/begin-journey.tsx
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post } };
});
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/logging', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  BEGIN_JOURNEY_COPY,
  BEGIN_JOURNEY_ROUTE,
  BeginJourney,
} from '@/components/app/onboarding/begin-journey';

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ outcome: 'begun', next: '/app/modules/values' });
});

describe('BeginJourney', () => {
  it('says skipped questions are waiting, and where, when there are some', () => {
    render(<BeginJourney waiting moduleName="Onboarding" />);

    expect(screen.getByRole('heading', { name: BEGIN_JOURNEY_COPY.heading })).toBeInTheDocument();
    expect(screen.getByText(BEGIN_JOURNEY_COPY.waiting('Onboarding'))).toBeInTheDocument();
    expect(screen.queryByText(BEGIN_JOURNEY_COPY.revisable('Onboarding'))).toBeNull();
  });

  it('says the answers can be changed later when nothing was skipped', () => {
    render(<BeginJourney waiting={false} moduleName="Onboarding" />);

    expect(screen.getByText(BEGIN_JOURNEY_COPY.revisable('Onboarding'))).toBeInTheDocument();
    expect(screen.queryByText(BEGIN_JOURNEY_COPY.waiting('Onboarding'))).toBeNull();
  });

  it('is honest that Values is not written yet', () => {
    render(<BeginJourney waiting={false} moduleName="Onboarding" />);
    expect(screen.getByText(BEGIN_JOURNEY_COPY.values)).toBeInTheDocument();
    expect(BEGIN_JOURNEY_COPY.values).toMatch(/not written yet/);
  });

  it('posts, then goes where the route says, once', async () => {
    const onBegun = vi.fn();
    const user = userEvent.setup();
    render(<BeginJourney waiting={false} moduleName="Onboarding" onBegun={onBegun} />);

    await user.click(screen.getByRole('button', { name: BEGIN_JOURNEY_COPY.begin }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/modules/values'));
    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith(BEGIN_JOURNEY_ROUTE);
    expect(onBegun).toHaveBeenCalledOnce();
  });

  it('says it failed and stays pressable when the post fails', async () => {
    post.mockRejectedValueOnce(new Error('409'));
    const user = userEvent.setup();
    render(<BeginJourney waiting={false} moduleName="Onboarding" />);

    await user.click(screen.getByRole('button', { name: BEGIN_JOURNEY_COPY.begin }));

    expect(await screen.findByText(BEGIN_JOURNEY_COPY.failed)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    const button = screen.getByRole('button', { name: BEGIN_JOURNEY_COPY.begin });
    expect(button).toBeEnabled();

    await user.click(button);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/app/modules/values'));
  });

  it('refuses to go somewhere outside the app the response names', async () => {
    post.mockResolvedValueOnce({ outcome: 'begun', next: 'https://elsewhere.example' });
    const user = userEvent.setup();
    render(<BeginJourney waiting={false} moduleName="Onboarding" />);

    await user.click(screen.getByRole('button', { name: BEGIN_JOURNEY_COPY.begin }));

    expect(await screen.findByText(BEGIN_JOURNEY_COPY.failed)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
