/**
 * Which audio links play in the page, and how (f-resources t-120).
 *
 * An audio piece plays inline in its drawer card (owner ruling, 1 Oct 2026).
 * Where her audio will be hosted is not decided, so the first supported source
 * is the one almost every host can give: **a direct link to an audio file**, an
 * `https` URL whose path ends `.mp3` or `.m4a`, played by the browser's own
 * `<audio>` element and our own controls. A host-specific player, or upload in
 * the admin, is a later entry here (Hub idea #41).
 *
 * **Any other audio link is still accepted** (owner ruling, t-120 review): an
 * episode page on a podcast site or Spotify opens in a new tab, as every audio
 * link did before. Unlike a video, nothing is refused for its host.
 *
 * **The CSP decides where it can actually play from.** `media-src` is fixed at
 * `'self' blob:` in Sunrise's `lib/security/headers.ts`, with no app seam, so a
 * file on another origin is refused by the browser until its origin is allowed.
 * That ask is on sunrise#841. When a host is chosen, its origin is added there,
 * or in a fork fix if Sunrise has not shipped the seam. The card says so when a
 * file will not play, and offers the link.
 *
 * Unlike a video's embed, the `<audio>` source IS the stored link: a file has
 * no id to rebuild it from. What makes that safe is that it is held to `https`
 * and a media file's extension, it is only ever an `<audio src>` (never a frame
 * or a script), and the CSP limits where it can load from.
 *
 * Pure and client-safe, like `video-hosts.ts`.
 *
 * @see lib/app/content/video-hosts.ts — the same shape for video
 */

/** What a client needs to play an audio piece inline. */
export interface AudioPlayer {
  /** The file's URL, as stored: `https`, ending `.mp3` or `.m4a`. */
  src: string;
  /**
   * Its media type. The web card does not need it (the browser sniffs the
   * file); a native client choosing a player may.
   */
  type: 'audio/mpeg' | 'audio/mp4';
}

/** The file types an audio link may name today, as an admin reads them. */
export const SUPPORTED_AUDIO_FILES = ['.mp3', '.m4a'] as const;

const TYPE_BY_EXTENSION: Readonly<
  Record<(typeof SUPPORTED_AUDIO_FILES)[number], AudioPlayer['type']>
> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
};

/**
 * The player for an audio link, or `null` when it is not a direct `https` link
 * to an `.mp3` or `.m4a` file. The caller shows a card that opens the link.
 */
export function resolveAudioPlayer(href: string): AudioPlayer | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  // `https` only: a page served over https will not play `http` media, so an
  // `http` file is shown as a card that opens it, not a player that cannot.
  if (url.protocol !== 'https:') return null;
  const path = url.pathname.toLowerCase();
  const extension = SUPPORTED_AUDIO_FILES.find((ext) => path.endsWith(ext));
  if (extension === undefined) return null;
  return { src: url.href, type: TYPE_BY_EXTENSION[extension] };
}
