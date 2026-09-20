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
function Harness({ voiceInput = 'available' as const, initial = '', busy = false }) {
  const [value, setValue] = React.useState(initial);
  return (
    <Composer
      value={value}
      onChange={setValue}
      onSend={onSend}
      busy={busy}
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
  // After the next paint, as a browser would: after React has committed the value.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
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

  it('replaces a selection in the middle, spaced from the words either side', async () => {
    const user = userEvent.setup();
    render(<Harness initial="Before SELECTED after." />);
    box().focus();
    (box() as HTMLTextAreaElement).setSelectionRange(7, 15);
    await user.click(mic());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));
    await waitFor(() => expect(box()).toHaveValue('Before what I said after.'));
    // The caret sits after the words that landed.
    await waitFor(() =>
      expect((box() as HTMLTextAreaElement).selectionStart).toBe('Before what I said'.length)
    );
  });

  it('puts the words at the end of a box the person has not clicked into since it mounted', async () => {
    // A remounted box (the pane parked and unparked) reports its caret at 0
    // until it is clicked; the words belong after what is there.
    const user = userEvent.setup();
    render(<Harness initial="Hello there" />);
    await user.click(mic());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));
    await waitFor(() => expect(box()).toHaveValue('Hello there what I said'));
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

  it('keeps what was typed while the words were on their way', async () => {
    let release!: () => void;
    vi.mocked(fetchImpl).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve(
              new Response(JSON.stringify({ success: true, data: { text: 'what I said' } }), {
                status: 200,
              })
            );
        })
    );
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(mic());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(CONVERSATION_COPY.micTranscribing)
    );
    // Typing meanwhile.
    await user.type(box(), 'hello');
    await act(async () => release());
    await waitFor(() => expect(box()).toHaveValue('hello what I said'));
  });

  it('sends the clip itself at the cap rather than letting the recorder drop it', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(mic());
    await screen.findByRole('button', { name: CONVERSATION_COPY.micStop });
    // The hook reads the clock on a real 200 ms tick; jump the clock past the cap.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 121_000);
    try {
      await waitFor(() => expect(posts).toHaveLength(1), { timeout: 3000 });
      await waitFor(() => expect(box()).toHaveValue('what I said'));
      expect(mic()).toBeTruthy();
    } finally {
      clock.mockRestore();
    }
  });

  it('can always be stopped, even once a turn is in flight', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness />);
    await user.click(mic());
    await screen.findByRole('button', { name: CONVERSATION_COPY.micStop });
    // A turn starts while recording: the send disc greys; the stop must not.
    rerender(<Harness busy />);
    const stop = screen.getByRole('button', { name: CONVERSATION_COPY.micStop });
    expect(stop).not.toBeDisabled();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(stop);
    await waitFor(() => expect(box()).toHaveValue('what I said'));
    // And starting a new one does wait.
    expect(mic()).toBeDisabled();
  });

  it('keeps the disc live, named with the reason, when the browser was told no — a press asks again', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(mic());
    const denied = await screen.findByRole('button', { name: CONVERSATION_COPY.micDenied });
    expect(denied).not.toBeDisabled();
    expect(posts).toHaveLength(0);
    // A dismissed prompt reads the same as a refused one; the person may allow it now.
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    await user.click(denied);
    await screen.findByRole('button', { name: CONVERSATION_COPY.micStop });
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('withdraws itself when a switch was turned off while the pane was open', async () => {
    vi.mocked(fetchImpl).mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({ success: false, error: { code: 'VOICE_DISABLED', message: 'off' } }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
    );
    const user = userEvent.setup();
    render(<Harness initial="Mine." />);
    await user.click(mic());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(CONVERSATION_COPY.micWithdrawn)
    );
    expect(screen.queryByRole('button', { name: /voice note/i })).toBeNull();
    expect(box()).toHaveValue('Mine.');
  });

  it('says the microphone could not be reached — not that a clip failed — when no clip was made', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('busy'), { name: 'NotReadableError' }));
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(mic());
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe(CONVERSATION_COPY.micUnreachable)
    );
    expect(mic()).not.toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  it('names the clip by its MIME', async () => {
    (FakeRecorder as unknown as { isTypeSupported: (m: string) => boolean }).isTypeSupported = () =>
      false;
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(mic());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await user.click(screen.getByRole('button', { name: CONVERSATION_COPY.micStop }));
    await waitFor(() => expect(posts).toHaveLength(1));
    const form = await posts[0].formData();
    const file = form.get('audio');
    expect(file).toBeInstanceOf(File);
    // The fake's default MIME is audio/webm; the name follows it.
    expect((file as File).name).toBe('voice-note.webm');
    (FakeRecorder as unknown as { isTypeSupported: (m: string) => boolean }).isTypeSupported = (
      m
    ) => (PREFERRED_MIMES as readonly string[]).includes(m);
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
