// @vitest-environment happy-dom

/**
 * The first-run sequence (t-103): her Initiation with the person's name, then
 * each read offered in turn, each skippable, each recorded as the person moves
 * past it.
 *
 * `FirstRunView` renders with her real documents, served as the seed stores
 * them, so the greeting asserted is the authored one. The API client is
 * mocked; what a recorded beat does to the ledger is
 * `tests/unit/lib/app/onboarding/first-run-store.test.ts`.
 *
 * FORK NOTE — the greeting assertions read Lelañea's `the_initiation`
 * ("Welcome, {{first_name}}."). A fork with its own welcome rewrites those.
 *
 * @see components/app/onboarding/first-run-view.tsx
 * @see components/app/onboarding/first-run.tsx
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/app/content/document-store', async () =>
  (await import('@/tests/helpers/app/foundational-documents')).fakeDocumentStore()
);

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/lib/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/client')>();
  return { ...actual, apiClient: { ...actual.apiClient, post } };
});

// The banner clearance has its own tests (`consent-clearance.test.tsx`); here
// only that the first run applies what it answers.
const { clearance } = vi.hoisted(() => ({ clearance: { current: 0 } }));
vi.mock('@/components/app/ui/consent-clearance', () => ({
  useConsentBannerClearance: () => clearance.current,
}));

import { FIRST_RUN_COPY, FIRST_RUN_ROUTE } from '@/components/app/onboarding/first-run';
import { FirstRunView } from '@/components/app/onboarding/first-run-view';
import * as sections from '@/lib/app/content/sections';
import { FIRST_RUN_BEATS, type FirstRunBeat } from '@/lib/app/onboarding/first-run';

async function renderView(
  userName: string | null,
  pending: readonly FirstRunBeat[] = FIRST_RUN_BEATS
) {
  const element = await FirstRunView({ pending, userName });
  return render(<>{element}</>);
}

const recorded = () =>
  post.mock.calls.map(([, options]) => (options as { body: { beat: string } }).body.beat);

beforeEach(() => {
  vi.clearAllMocks();
  post.mockResolvedValue({ recorded: true });
  clearance.current = 0;
});

describe('the Initiation, by name', () => {
  it('greets the person by their first name', async () => {
    await renderView('Maya Reyes');
    expect(screen.getByText('Welcome, Maya.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'The Initiation' })).toBeInTheDocument();
  });

  it.each([
    ['no name', null],
    ['a blank name', '   '],
    ['the platform’s “User” stand-in', 'User'],
  ])('closes the sentence over %s, with no stray comma', async (_label, userName) => {
    const { container } = await renderView(userName);
    expect(screen.getByText('Welcome.')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/Welcome, ?[.,]/);
    expect(text).not.toContain('User');
    expect(text).not.toContain('{{first_name}}');
    // The vocative mid-document closes the same way.
    expect(text).not.toMatch(/You, ,|You, are/);
  });
});

describe('the reads, in sequence', () => {
  it('follows the Initiation with each read, in order, and records each as it is passed', async () => {
    const user = userEvent.setup();
    await renderView('Maya');

    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.continue }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'The Heart Behind Lelañea' })
    ).toHaveFocus();

    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.skip }));
    expect(screen.getByRole('heading', { level: 1, name: 'The Mission' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.skip }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'About the Creator' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.skip }));
    expect(
      screen.getByRole('heading', { level: 1, name: 'The Lineage of Lelañea' })
    ).toBeInTheDocument();

    expect(recorded()).toEqual([
      'initiation',
      'read:the_heart_behind_lelanea',
      'read:the_mission',
      'read:about_the_creator',
    ]);
    expect(post.mock.calls[0]?.[0]).toBe(FIRST_RUN_ROUTE);
  });

  it('offers each read before showing it, and opens it on request', async () => {
    const user = userEvent.setup();
    await renderView('Maya', ['read:the_mission']);

    expect(screen.queryByTestId('first-run-read-body')).toBeNull();
    expect(post).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.read }));
    const body = screen.getByTestId('first-run-read-body');
    expect(body).toHaveFocus();
    expect(body.textContent?.length).toBeGreaterThan(200);
    // Opening it is not moving past it.
    expect(post).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.continue }));
    expect(recorded()).toEqual(['read:the_mission']);
  });

  it('ends by rendering nothing, which leaves the conversation', async () => {
    const user = userEvent.setup();
    const { container } = await renderView('Maya', ['read:the_lineage_of_lelanea']);
    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.skip }));
    expect(container.firstChild).toBeNull();
  });

  it('moves on even when the beat does not land', async () => {
    post.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    await renderView('Maya', ['initiation', 'read:the_mission']);
    await user.click(screen.getByRole('button', { name: FIRST_RUN_COPY.continue }));
    expect(screen.getByRole('heading', { level: 1, name: 'The Mission' })).toBeInTheDocument();
  });

  it('loads only what is still to come', async () => {
    const spy = vi.spyOn(sections, 'requireDocument');
    await renderView('Maya', ['read:about_the_creator']);
    expect(spy.mock.calls.map(([id]) => id)).toEqual(['about_the_creator']);
    expect(screen.queryByText('Welcome, Maya.')).toBeNull();
  });
});

describe('when her words cannot be read', () => {
  it('renders nothing rather than an error over the shell', async () => {
    vi.spyOn(sections, 'requireDocument').mockRejectedValueOnce(new Error('not seeded'));
    const element = await FirstRunView({ pending: FIRST_RUN_BEATS, userName: 'Maya' });
    expect(element).toBeNull();
  });
});

describe('the cookie banner', () => {
  it('keeps the button clear of it while it shows', async () => {
    clearance.current = 140;
    await renderView('Maya', ['initiation']);
    expect(screen.getByTestId('first-run').style.paddingBottom).toBe('140px');
  });

  it('reserves nothing when there is no banner', async () => {
    await renderView('Maya', ['initiation']);
    expect(screen.getByTestId('first-run').style.paddingBottom).toBe('');
  });
});

describe('the copy', () => {
  it('names no count', () => {
    for (const line of Object.values(FIRST_RUN_COPY)) {
      expect(line).not.toMatch(/\b(\d+|one|two|three|four|five)\b/i);
    }
  });
});
