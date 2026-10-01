/**
 * Where a video can play from, and how a link becomes a still and a player
 * (f-resources t-119).
 *
 * The design's video is a picture card that opens a lightbox playing the video
 * in the page (`lelanea.html`, `.videocard` and `#lightbox`). Where her videos
 * will be hosted is not decided, so each host is an entry here and YouTube is
 * the first. A second host (Vimeo, a streaming host) is a second entry: its own
 * id rule, still and player URL. Its origin goes in `appFrameSrc`
 * (`lib/app/csp.ts`).
 *
 * **The player is built from a validated id, never from the stored link.** The
 * link is what an admin typed. The id is checked against the host's own id
 * rule, and the embed and thumbnail URLs are assembled from it, so a hostile
 * link resolves to `null` (no player) rather than to an iframe on a host the CSP
 * allows. That is the condition `lib/app/csp.ts` puts on widening `frame-src`.
 *
 * Pure and client-safe: the admin form reads {@link SUPPORTED_VIDEO_HOSTS} for
 * its help text, and the server derives {@link VideoPlayer} for every client.
 *
 * @see lib/app/content/resource-view.ts — where a stored video gains its player
 * @see components/app/shell/resources-drawer.tsx — the card and the lightbox
 */

/** What a client needs to show a video's still and play it in the page. */
export interface VideoPlayer {
  host: 'youtube';
  /** The host's own id for the video, validated. */
  id: string;
  /** The still for the card. */
  thumbnailUrl: string;
  /** What the lightbox's iframe loads. */
  embedUrl: string;
}

/** The hosts a video link may name today, as an admin reads them. */
export const SUPPORTED_VIDEO_HOSTS = ['YouTube'] as const;

/** The link forms an admin may paste, as the form's help and the refusal show them. */
export const VIDEO_LINK_EXAMPLES = [
  'https://www.youtube.com/watch?v=…',
  'https://youtu.be/…',
] as const;

/** The admin's refusal for a link no host resolves. */
export const UNSUPPORTED_VIDEO_LINK_MESSAGE = `A video link must be a ${SUPPORTED_VIDEO_HOSTS.join(
  ' or '
)} link, such as ${VIDEO_LINK_EXAMPLES.join(' or ')}, so it can play in the page.`;

/** The origin the YouTube player is embedded from: the privacy-enhanced one. */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com';

/** YouTube's id: eleven characters from its URL-safe alphabet. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** The hosts a YouTube link is written on. `youtu.be` is handled apart: its id is the path. */
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

/** The path forms whose second segment is the id: `/embed/<id>`, `/shorts/<id>`, `/live/<id>`. */
const YOUTUBE_ID_PATHS = new Set(['embed', 'shorts', 'live']);

/**
 * YouTube's own words in the id's place, eleven characters like an id:
 * `/embed/videoseries?list=…` embeds a playlist and `/embed/live_stream?channel=…`
 * a channel's live stream. Neither names a video, so neither has a still or
 * plays from an id alone.
 */
const YOUTUBE_RESERVED_IDS = new Set(['videoseries', 'live_stream']);

/**
 * Where the video should start, in whole seconds, from the link's `t` or
 * `start`: `90`, `90s`, `1m30s` or `1h2m3s`. `null` for none, or for anything
 * else, so nothing but digits reaches the embed.
 */
function startSecondsFrom(url: URL): number | null {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (raw === null) return null;
  const match = /^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s?)?$/.exec(raw);
  if (!match || raw === '') return null;
  const [, h, m, s] = match;
  const seconds = Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  return seconds > 0 ? seconds : null;
}

/** The id a YouTube link names, or `null` when it names none. */
function youtubeIdFrom(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);
  let candidate: string | null | undefined;
  if (host === 'youtu.be') {
    candidate = segments[0];
  } else if (YOUTUBE_HOSTS.has(host)) {
    if (segments.length === 1 && segments[0] === 'watch') candidate = url.searchParams.get('v');
    else if (segments.length >= 2 && YOUTUBE_ID_PATHS.has(segments[0] ?? '')) {
      candidate = segments[1];
    }
  }
  return candidate && YOUTUBE_ID.test(candidate) && !YOUTUBE_RESERVED_IDS.has(candidate)
    ? candidate
    : null;
}

/**
 * The player for a video link, or `null` when no supported host resolves it.
 *
 * A link that does not parse, uses a scheme other than http(s), or names a host
 * or an id that is not valid resolves to `null`. The caller shows a card that
 * opens the link instead.
 */
export function resolveVideoPlayer(href: string): VideoPlayer | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  const id = youtubeIdFrom(url);
  if (id === null) return null;
  // A start time in the link is kept, as it was when the card opened the link
  // itself: an admin pointing at the part of a long talk that matters.
  const start = startSecondsFrom(url);
  return {
    host: 'youtube',
    id,
    // `hqdefault` exists for every video; `maxresdefault` does not. It is 4:3
    // with bars above and below a 16:9 picture, which a centred `cover` crop
    // into the card's 16:9 frame removes.
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    // `rel=0` keeps the suggestions at the end to the same channel;
    // `playsinline` stops iOS taking the video full screen on play.
    embedUrl: `${YOUTUBE_EMBED_ORIGIN}/embed/${id}?autoplay=1&rel=0&playsinline=1${
      start === null ? '' : `&start=${start}`
    }`,
  };
}

/** Whether a video link can play in the page. */
export function isPlayableVideoLink(href: string): boolean {
  return resolveVideoPlayer(href) !== null;
}

/**
 * The refusal for a video link being written, or `null` when it may be.
 *
 * **Only a link being set or changed is held to it.** A video entered before
 * t-119 may have a link no host plays. It is still served (with no player), so
 * it must stay exportable, and an admin must be able to correct its title
 * without inventing a new link. So the rule applies when a video is created,
 * or its link changes, and not to every write that carries the link unchanged.
 *
 * @param before - the video's stored link, or `null` for a new video
 */
export function videoLinkRefusal(before: string | null, next: string): string | null {
  if (before !== null && before === next) return null;
  return isPlayableVideoLink(next) ? null : UNSUPPORTED_VIDEO_LINK_MESSAGE;
}

/**
 * {@link videoLinkRefusal} for a resource's stored fields: `null` unless the
 * resource is a video with a link. The one place the store's writes and an
 * import's plan both ask, so the two cannot apply different rules.
 *
 * @param before - the resource as stored, or `null` for a new one
 */
export function videoFieldsRefusal(
  before: { href: string | null } | null,
  next: { kind: string; href: string | null }
): string | null {
  if (next.kind !== 'video' || next.href === null) return null;
  return videoLinkRefusal(before?.href ?? null, next.href);
}
