// @vitest-environment happy-dom

/**
 * The dialog that answers "what is actually in the voice test set?".
 *
 * It exists because the page could not answer it: the questions were only
 * rendered beside a run's answers, so before anything had been queued the
 * surface offered a button and a paragraph of prose about a set nobody could
 * read. The two things worth pinning are therefore (a) it renders the AUTHORED
 * set it was handed — every question, and the control's whole prompt — rather
 * than a hard-coded description of one, and (b) it stays shut until asked, so
 * the explanation is available without being in the way.
 *
 * @see components/app/admin/golden-set-dialog.tsx
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GoldenSetDialog, type GoldenSetView } from '@/components/app/admin/golden-set-dialog';

const VIEW: GoldenSetView = {
  version: '2.3',
  provenanceNote: 'FIXTURE PROVENANCE: where these questions came from.',
  awaitingSignOffFrom: 'FIXTURE REVIEWER',
  prompts: [
    {
      key: 'first-hello',
      kind: 'greeting',
      prompt: 'FIXTURE QUESTION ONE',
      probe: 'FIXTURE PROBE ONE',
    },
    {
      key: 'nothing-on-this',
      kind: 'retrieval-empty',
      prompt: 'FIXTURE QUESTION TWO',
      probe: 'FIXTURE PROBE TWO',
    },
  ],
  controlInstructions: 'FIXTURE CONTROL SYSTEM PROMPT',
};

describe('GoldenSetDialog', () => {
  it('stays shut until it is opened', () => {
    render(<GoldenSetDialog goldenSet={VIEW} />);

    expect(screen.queryByText('FIXTURE QUESTION ONE')).toBeNull();
    expect(screen.getByRole('button', { name: /what is in the test set/i })).toBeVisible();
  });

  it('shows every authored question with what it is probing', async () => {
    const user = userEvent.setup();
    render(<GoldenSetDialog goldenSet={VIEW} />);

    await user.click(screen.getByRole('button', { name: /what is in the test set/i }));

    // Every one, not the first few: a dialog that silently truncated would leave
    // an operator believing the test covers less than it does.
    for (const entry of VIEW.prompts) {
      expect(screen.getByText(entry.prompt)).toBeVisible();
      // Without the probe a question is just a sentence — the probe is what says
      // whether the answer is supposed to decline, to ground a claim, or to
      // admit it has nothing.
      expect(screen.getByText(entry.probe)).toBeVisible();
      expect(screen.getByText(entry.kind)).toBeVisible();
    }
  });

  it('shows the control’s whole prompt, so the thing it is measured against is readable', async () => {
    const user = userEvent.setup();
    render(<GoldenSetDialog goldenSet={VIEW} />);

    await user.click(screen.getByRole('button', { name: /what is in the test set/i }));

    expect(screen.getByText('FIXTURE CONTROL SYSTEM PROMPT')).toBeVisible();
  });

  it('says the set is a draft when it is still awaiting sign-off', async () => {
    const user = userEvent.setup();
    render(<GoldenSetDialog goldenSet={VIEW} />);

    await user.click(screen.getByRole('button', { name: /what is in the test set/i }));

    expect(screen.getByText(/FIXTURE REVIEWER/)).toBeVisible();
  });

  it('does not claim a draft when nobody is awaiting sign-off', async () => {
    // A signed-off set rendered as "drafted, not final" understates what the
    // numbers on the board are worth.
    const user = userEvent.setup();
    render(<GoldenSetDialog goldenSet={{ ...VIEW, awaitingSignOffFrom: null }} />);

    await user.click(screen.getByRole('button', { name: /what is in the test set/i }));

    expect(screen.queryByText(/drafted, not final/i)).toBeNull();
  });

  it('names the seeder when there is no set to show, rather than an empty list', async () => {
    // `null` is what the page passes when `getGoldenSetAdminView()` threw, and
    // that is the ordinary state of an environment which has migrated but not
    // been seeded — migrations run before every deploy, the seeder only on
    // request. The page degrades instead of throwing so the operator keeps the
    // surface; this dialog is then the thing that has to say why it is empty.
    const user = userEvent.setup();
    render(<GoldenSetDialog goldenSet={null} />);

    await user.click(screen.getByRole('button', { name: /what is in the test set/i }));

    expect(screen.getByText(/npm run db:seed/)).toBeVisible();
    expect(screen.getByText(/could not be read/i)).toBeVisible();
  });
});
