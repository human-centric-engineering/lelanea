// @vitest-environment happy-dom

/**
 * The microphone (§10 t-67): a recording puts words in the box and sends
 * nothing; a browser that cannot record, or was told no, gets the disabled
 * disc with its reason; a clip that could not be transcribed leaves the box
 * alone. Rendered through the composer, whose caret the words land at.
 *
 * A fake `MediaRecorder`, as the platform's own hook test fakes it.
 *
 * @see components/app/conversation/voice-note.tsx
 * @see components/app/conversation/composer.tsx
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Composer } from '@/components/app/conversation/composer';
import { CONVERSATION_COPY } from '@/lib/app/conversation/copy';
import { PREFERRED_MIMES } from '@/lib/hooks/use-voice-recording';

vi.mock('@/lib/logging', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

class FakeRecorder {
  public state: 'inactive' | 'recording' = 'inactive';
  public mimeType: string;
  private listeners = new Map<string, Array<(event?: unknown) => void>>();
  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
  }
  addEventListener(event: string, cb: (event?: unknown) => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
  }
  removeEventListener(): void {}
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    const blob = new Blob([new Uint8Array([26, 69, 223, 163])], { type: this.mimeType });
    for (const cb of this.listeners.get('dataavailable') ?? []) cb({ data: blob });
    for (const cb of this.listeners.get('stop') ?? []) cb();
  }
}
(FakeRecorder as unknown as { isTypeSupported: (m: string) => boolean }).isTypeSupported = (m) =>
  (PREFERRED_MIMES as readonly string[]).includes(m);

const getUserMedia = vi.fn();
const posts: Request[] = [];
let transcript: { text: string } | 'fail' = { text: 'what I said' };

const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const href = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
  posts.push(new Request(`https://lelanea.test${href}`, init));
  if (transcript === 'fail') return new Response('', { status: 502 });
  return new Response(JSON.stringify({ success: true, data: transcript }), { status: 200 });
}) as unknown as typeof fetch;

/** The composer as the pane renders it, with its own draft state and a spy on send. */
function Harness({ voiceInput = 'available' as const, initial = '' }) {
  const [value, setValue] = React.useState(initial);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={onSend}
      busy={false}
      voiceInput={voiceInput}
      fetchImpl={fetchImpl}
    />
  );
}
const onSend = vi.fn();

const box = () => screen.getByRole('textbox', { name: CONVERSATION_COPY.composerLabel });
const mic = () => screen.getByRole('button', { name: CONVERSATION_COPY.mic });

beforeEach(() => {
  vi.clearAllMocks();
  posts.length = 0;
  transcript = { text: 'what I said' };
  getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a voice note', () => {
  it('is named for what happens to the recording: nothing', () => {
    render(<Harness />);
    expect(mic().getAttribute('aria-label')).toMatch(/never kept/);
  });

  it('puts the words in the box, at the caret, and sends nothing', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Before." />);
    // Caret at the end of what is there.
    box().focus();
    (box() as HTMLTextAreaElement).setSelectionRange(7, 7);

    await user.click(mic());
    await waitFor(() =>
      expect(screen.getByRole('button', { name: CONVERSATION_COPY.micStop })).toBeTruthy()
    );
    expect(screen.getByRole('status').textContent).toMatch(/^Recording/);
    await act(async () => {
      // Long enough to hold a word.
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));

    await waitFor(() => expect(box()).toHaveValue('Before. what I said'));
    // The clip went to the transcribe route as multipart, and nowhere else.
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/api/v1/app/agent/transcribe');
    expect(posts[0].method).toBe('POST');
    expect(onSend).not.toHaveBeenCalled();
    // And the disc is a microphone again.
    expect(mic()).toBeTruthy();
  });

  it('leaves the box alone and says so when the clip could not be turned into words', async () => {
    transcript = 'fail';
    const user = userEvent.setup();
    render(<Harness initial="Mine." />);
    await user.click(mic());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(CONVERSATION_COPY.micFailed)
    );
    expect(box()).toHaveValue('Mine.');
    expect(mic()).not.toBeDisabled();
  });

  it('is the disabled disc with its reason when the browser was told no', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(mic());
    const denied = await screen.findByRole('button', { name: CONVERSATION_COPY.micDenied });
    expect(denied).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  it('is the disabled disc with its reason in a browser that cannot record', () => {
    vi.stubGlobal('MediaRecorder', undefined);
    render(<Harness />);
    const cannot = screen.getByRole('button', { name: CONVERSATION_COPY.micUnsupported });
    expect(cannot).toBeDisabled();
  });

  it('is absent when the route says voice input is off, or there is nothing to transcribe with', () => {
    const { unmount } = render(<Harness voiceInput={'off' as never} />);
    expect(screen.queryByRole('button', { name: /voice note/i })).toBeNull();
    unmount();
    render(<Harness voiceInput={'no_provider' as never} />);
    expect(screen.queryByRole('button', { name: /voice note/i })).toBeNull();
  });
});
