/**
 * One thing plays at a time in the resources drawer: starting an audio piece
 * stops any other, and opening a video stops the audio (f-resources t-120).
 *
 * A window event rather than shared state, because the players are siblings in
 * lists the drawer re-renders and none of them owns the others. Each player
 * announces itself when it actually starts, and every other player that hears
 * a different id stops.
 */

const PLAY_EVENT = 'lelanea:media-play';

/** Say that the player named `id` has started. */
export function announcePlay(id: string): void {
  window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: id }));
}

/**
 * Call `stop` whenever a player other than `id` starts. Returns the
 * unsubscribe, for an effect's cleanup.
 */
export function onOtherPlay(id: string, stop: () => void): () => void {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && event.detail !== id) stop();
  };
  window.addEventListener(PLAY_EVENT, listener);
  return () => window.removeEventListener(PLAY_EVENT, listener);
}
