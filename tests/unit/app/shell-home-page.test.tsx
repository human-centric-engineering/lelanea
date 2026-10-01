// @vitest-environment happy-dom

/**
 * The shell's clean view: the first run until it is behind the person, then
 * nothing, leaving the conversation pane to be the view.
 *
 * t-9 gave `/app` a placeholder saying the conversation arrives later. t-10
 * moved that copy into `ConversationPane`, which the layout renders for every
 * route in the group — so a page that still returned it would put a second copy
 * *underneath* the pane already saying it, and the two would drift. t-103 gave
 * the page one thing of its own: the first run, which is the whole view until
 * each beat is behind the person. t-104 follows it with the discovery
 * questions, which `DiscoveryView` shows or not (stubbed here; see
 * `tests/unit/components/app/onboarding/discovery.test.tsx`).
 *
 * `FirstRunView` is stubbed to its props here; what it renders is
 * `tests/unit/components/app/onboarding/first-run.test.tsx`.
 *
 * @see app/(lelanea)/app/page.tsx
 */

import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  getFirstRunProgress: vi.fn(),
  getDiscoveryState: vi.fn(),
}));
vi.mock('@/lib/auth/utils', () => ({ getServerSession: mocks.getServerSession }));
vi.mock('@/lib/app/onboarding/first-run-store', () => ({
  getFirstRunProgress: mocks.getFirstRunProgress,
}));
vi.mock('@/lib/app/onboarding/discovery-store', () => ({
  getDiscoveryState: mocks.getDiscoveryState,
}));
vi.mock('@/components/app/onboarding/first-run-view', () => ({
  FirstRunView: ({
    userId,
    pending,
    userName,
    children,
  }: {
    userId: string;
    pending: string[];
    userName: string;
    children?: React.ReactNode;
  }) => (
    <div data-testid="first-run-view" data-user-id={userId} data-user-name={userName}>
      <span data-testid="pending">{pending.join(' ')}</span>
      <div data-testid="after-first-run">{children}</div>
    </div>
  ),
}));
vi.mock('@/components/app/onboarding/discovery-view', () => ({
  DiscoveryView: ({ userId, where, state }: { userId: string; where: string; state: unknown }) => (
    <div data-testid="discovery-view" data-user-id={userId} data-where={where}>
      {JSON.stringify(state)}
    </div>
  ),
}));

import ShellHomePage from '@/app/(lelanea)/app/page';
import { ONBOARDING_READS } from '@/lib/app/onboarding/first-run';

async function renderPage() {
  return render(await ShellHomePage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getServerSession.mockResolvedValue({ user: { id: 'user_1', name: 'Maya Reyes' } });
  mocks.getFirstRunProgress.mockResolvedValue({ initiationShown: false, readsOffered: [] });
  mocks.getDiscoveryState.mockResolvedValue(DISCOVERY);
});

/** Stands in for the person's discovery state; `DiscoveryView` decides what it shows. */
const DISCOVERY = { position: { next: 'q01', skipped: [], finished: false }, started: false };

describe('the shell clean view', () => {
  it('is the first run for someone who has not been welcomed, with their name', async () => {
    const { getByTestId } = await renderPage();
    const view = getByTestId('first-run-view');
    expect(getByTestId('pending')).toHaveTextContent('initiation read:the_heart_behind_lelanea');
    expect(view).toHaveAttribute('data-user-name', 'Maya Reyes');
    expect(view).toHaveAttribute('data-user-id', 'user_1');
    expect(mocks.getFirstRunProgress).toHaveBeenCalledWith('user_1');
  });

  it('resumes where the person left off', async () => {
    mocks.getFirstRunProgress.mockResolvedValue({
      initiationShown: true,
      readsOffered: ['the_heart_behind_lelanea', 'the_mission'],
    });
    const { getByTestId } = await renderPage();
    expect(getByTestId('pending').textContent).toBe(
      'read:about_the_creator read:the_lineage_of_lelanea'
    );
  });

  it('hands the first run the discovery questions to follow its last beat (t-104)', async () => {
    const { getByTestId } = await renderPage();
    const questions = getByTestId('after-first-run').querySelector(
      '[data-testid="discovery-view"]'
    );
    expect(questions).toHaveAttribute('data-where', 'app');
    expect(questions).toHaveAttribute('data-user-id', 'user_1');
    expect(mocks.getDiscoveryState).toHaveBeenCalledWith('user_1');
  });

  it('is the discovery questions once every beat is behind the person (t-104)', async () => {
    mocks.getFirstRunProgress.mockResolvedValue({
      initiationShown: true,
      readsOffered: [...ONBOARDING_READS],
    });
    const { getByTestId, queryByTestId } = await renderPage();
    expect(queryByTestId('first-run-view')).toBeNull();
    expect(getByTestId('discovery-view')).toHaveTextContent(JSON.stringify(DISCOVERY));
  });

  it('renders nothing when the reads are behind the person and the questions cannot be read', async () => {
    mocks.getFirstRunProgress.mockResolvedValue({
      initiationShown: true,
      readsOffered: [...ONBOARDING_READS],
    });
    mocks.getDiscoveryState.mockResolvedValue(null);
    const { container } = await renderPage();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing, rather than welcoming again, when the ledger could not be read', async () => {
    mocks.getFirstRunProgress.mockResolvedValue(null);
    const { container } = await renderPage();
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing without a session: the layout has already sent them away', async () => {
    mocks.getServerSession.mockResolvedValue(null);
    const { container } = await renderPage();
    expect(container.firstChild).toBeNull();
    expect(mocks.getFirstRunProgress).not.toHaveBeenCalled();
  });
});
