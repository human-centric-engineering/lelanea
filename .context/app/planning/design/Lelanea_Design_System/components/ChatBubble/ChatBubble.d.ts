import type * as React from 'react';

export interface ChatBubbleProps {
  /** `ai` = stone bubble with lotus avatar; `user` = deep-teal bubble, right aligned. */
  from?: 'ai' | 'user';
  children?: React.ReactNode;
  /** Show the lotus avatar on AI turns. */
  avatar?: boolean;
  style?: React.CSSProperties;
}

/** A single chat turn in a sit. */
export function ChatBubble(props: ChatBubbleProps): JSX.Element;
