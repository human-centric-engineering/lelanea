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
  /** Its media type, for the `<source>` a client may want to declare. */
  type: 'audio/mpeg' | 'audio/mp4';
}

/** The file types an audio link may name today, as an admin reads them. */
export const SUPPORTED_AUDIO_FILES = ['.mp3', '.m4a'] as const;

/** The admin's refusal for an audio link that is not one. */
export const UNSUPPORTED_AUDIO_LINK_MESSAGE = `An audio link must be an https link to an audio file ending ${SUPPORTED_AUDIO_FILES.join(
  ' or '
)}, such as https://…/episode.mp3, so it can play in the page.`;

const TYPE_BY_EXTENSION: Readonly<Record<string, AudioPlayer['type']>> = {
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
  // `http` link would be accepted here and then fail in every browser.
  if (url.protocol !== 'https:') return null;
  const path = url.pathname.toLowerCase();
  const extension = SUPPORTED_AUDIO_FILES.find((ext) => path.endsWith(ext));
  if (extension === undefined) return null;
  const type = TYPE_BY_EXTENSION[extension];
  if (type === undefined) return null;
  return { src: url.href, type };
}

/**
 * The refusal for an audio piece's link being written, or `null` when it may
 * be: `null` unless the resource is an audio piece with a link that is new or
 * changed. A link carried unchanged is not re-checked, so an audio piece
 * entered before t-120 still exports and can have its title corrected. The
 * same rule as `videoFieldsRefusal`, asked by the same callers.
 *
 * @param before - the resource as stored, or `null` for a new one
 */
export function audioFieldsRefusal(
  before: { href: string | null } | null,
  next: { kind: string; href: string | null }
): string | null {
  if (next.kind !== 'audio' || next.href === null) return null;
  if (before !== null && before.href === next.href) return null;
  return resolveAudioPlayer(next.href) === null ? UNSUPPORTED_AUDIO_LINK_MESSAGE : null;
}
