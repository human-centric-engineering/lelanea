/**
 * Every word the conversation pane says of its own (§10 t-64).
 *
 * One module, so a locale can replace it later rather than being retrofitted
 * across components (product description §11: externalised strings from the
 * first line). Her replies are not here — they are hers. What is here is the
 * frame around them: the placeholder, the thinking row, the empty transcript.
 *
 * The endings' copy in her register, and the banner, are t-65's and will sit
 * beside these.
 */

export const CONVERSATION_COPY = {
  /** The composer's accessible name. */
  composerLabel: 'Message Lelañea',
  placeholder: 'What would you like to talk about today?',
  hint: 'shift + return for a new line',
  send: 'Send',
  sendBusy: 'Send — waiting for her reply',
  /** The mic is t-67's; until then it says so, as the stub did. */
  micArriving: 'Record a voice note — arrives with the conversation',

  /** The three-dot row while she has said nothing yet. */
  thinking: 'thinking',
  /** The same row once the first-words deadline has passed. */
  stillThinking: 'still thinking — this is taking a little longer than usual',

  /** The transcript with nothing in it yet. */
  empty: 'This is where you and Lelañea talk. Say whatever is on your mind.',
  /** While the transcript is being read back. */
  loading: 'Finding where you left off…',
  /** The transcript could not be read; the composer still works. */
  unreadable: 'Your earlier conversation could not be read just now. You can still talk to her.',

  /** Accessible name of the whole transcript region. */
  transcriptLabel: 'The conversation so far',
  /** Accessible name of her mark beside a reply. */
  herMark: 'Lelañea',
} as const;
