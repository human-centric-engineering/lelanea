// @vitest-environment happy-dom

/**
 * The transcript view's live turn: the AI's opening shows the thinking row and
 * no bubble of the person's, where a member's turn shows both (t-122).
 *
 * @see components/app/conversation/transcript.tsx
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Transcript } from '@/components/app/conversation/transcript';
import type { LiveTurn } from '@/components/app/conversation/use-conversation';

const live = (fields: Partial<LiveTurn>): LiveTurn => ({
  turnId: 't1',
  userText: 'hello',
  replyText: '',
  stillThinking: false,
  capabilities: [],
  suggestions: [],
  ...fields,
});

describe('Transcript — the live turn', () => {
  it('shows a member’s words and the thinking row', () => {
    render(<Transcript phase="thinking" entries={[]} live={live({})} unreadable={false} />);
    expect(screen.getByLabelText('You said')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('shows the thinking row and no bubble for the AI’s opening', () => {
    render(
      <Transcript
        phase="thinking"
        entries={[]}
        live={live({ turnId: 'app_opening_v1', userText: '', opening: true })}
        unreadable={false}
      />
    );
    expect(screen.queryByLabelText('You said')).toBeNull();
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
