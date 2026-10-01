/**
 * Unit Tests: which video links play in the page, and what a link becomes
 * (f-resources t-119).
 *
 * The player's iframe `src` is the one place an admin's link could reach a
 * frame the CSP allows, so the cases that matter most are the hostile ones: a
 * look-alike host, a bad id, a scheme other than http(s), and parameters
 * smuggled into the link. Each must resolve to no player, or to a player built
 * from the validated id alone.
 *
 * @see lib/app/content/video-hosts.ts
 */

import { describe, it, expect } from 'vitest';

import {
  isPlayableVideoLink,
  resolveVideoPlayer,
  UNSUPPORTED_VIDEO_LINK_MESSAGE,
  YOUTUBE_EMBED_ORIGIN,
} from '@/lib/app/content/video-hosts';

const ID = 'dQw4w9WgXcQ';

describe('a YouTube link', () => {
  it.each([
    ['a watch link', `https://www.youtube.com/watch?v=${ID}`],
    ['a watch link with more parameters', `https://www.youtube.com/watch?v=${ID}&t=42s&list=PL1`],
    ['a watch link without www', `https://youtube.com/watch?v=${ID}`],
    ['a mobile watch link', `https://m.youtube.com/watch?v=${ID}`],
    ['a short link', `https://youtu.be/${ID}`],
    ['a short link with a start time', `https://youtu.be/${ID}?t=30`],
    ['an embed link', `https://www.youtube.com/embed/${ID}`],
    ['a privacy-enhanced embed link', `https://www.youtube-nocookie.com/embed/${ID}`],
    ['a YouTube Music link', `https://music.youtube.com/watch?v=${ID}`],
    ['a short link on www', `https://www.youtu.be/${ID}`],
    ['an older /v/ link', `https://www.youtube.com/v/${ID}`],
    ['a live link', `https://www.youtube.com/live/${ID}`],
    ['an upper-case host', `https://WWW.YOUTUBE.COM/watch?v=${ID}`],
  ])('resolves %s to its id', (_what, href) => {
    expect(resolveVideoPlayer(href)).toMatchObject({ host: 'youtube', id: ID });
    expect(isPlayableVideoLink(href)).toBe(true);
  });

  it('builds the still and the privacy-enhanced embed from the id', () => {
    expect(resolveVideoPlayer(`https://youtu.be/${ID}`)).toEqual({
      host: 'youtube',
      id: ID,
      thumbnailUrl: `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`,
      embedUrl: `${YOUTUBE_EMBED_ORIGIN}/embed/${ID}?autoplay=1&rel=0&playsinline=1`,
    });
  });

  it('carries nothing from the link into the player but the id', () => {
    const player = resolveVideoPlayer(
      `https://www.youtube.com/watch?v=${ID}&autoplay=0&origin=https%3A%2F%2Fevil.example#x"onload="alert(1)`
    );
    expect(player?.embedUrl).toBe(
      `${YOUTUBE_EMBED_ORIGIN}/embed/${ID}?autoplay=1&rel=0&playsinline=1`
    );
    expect(player?.thumbnailUrl).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
  });
});

describe('a start time in the link', () => {
  const embed = (start: string) =>
    `${YOUTUBE_EMBED_ORIGIN}/embed/${ID}?autoplay=1&rel=0&playsinline=1${start}`;

  it.each([
    ['seconds', `https://youtu.be/${ID}?t=90`, '&start=90'],
    ['seconds with an s', `https://www.youtube.com/watch?v=${ID}&t=90s`, '&start=90'],
    ['minutes and seconds', `https://youtu.be/${ID}?t=1m30s`, '&start=90'],
    ['hours, minutes and seconds', `https://youtu.be/${ID}?t=1h2m3s`, '&start=3723'],
    ['an embed link’s start', `https://www.youtube.com/embed/${ID}?start=45`, '&start=45'],
    ['a #t= fragment', `https://www.youtube.com/watch?v=${ID}#t=1m30s`, '&start=90'],
    [
      'a start when the t beside it is not a time',
      `https://www.youtube.com/embed/${ID}?start=45&t=x`,
      '&start=45',
    ],
  ])('is carried into the embed from %s', (_what, href, start) => {
    expect(resolveVideoPlayer(href)?.embedUrl).toBe(embed(start));
  });

  it.each([
    ['zero', `https://youtu.be/${ID}?t=0`],
    ['words', `https://youtu.be/${ID}?t=soon`],
    ['an injected parameter', `https://youtu.be/${ID}?t=30%26list%3DPLx`],
    ['a negative number', `https://youtu.be/${ID}?t=-5`],
  ])('is dropped when it is %s, so nothing but digits reaches the embed', (_what, href) => {
    expect(resolveVideoPlayer(href)?.embedUrl).toBe(embed(''));
  });
});

describe('a link no host plays', () => {
  it.each([
    ['another host', 'https://vimeo.com/76979871'],
    ['a direct file', 'https://example.com/her-video.mp4'],
    ['a look-alike host', `https://youtube.com.evil.example/watch?v=${ID}`],
    ['a host that only ends in youtube.com', `https://notyoutube.com/watch?v=${ID}`],
    ['a short link on a look-alike host', `https://youtu.be.evil.example/${ID}`],
    ['a channel page', 'https://www.youtube.com/@lelanea'],
    ['a watch link with no id', 'https://www.youtube.com/watch'],
    ['an id one character short', 'https://youtu.be/dQw4w9WgXc'],
    ['an id one character long', 'https://youtu.be/dQw4w9WgXcQQ'],
    ['an id with a character YouTube never uses', 'https://youtu.be/dQw4w9WgX.Q'],
    ['an id carrying markup', `https://www.youtube.com/watch?v=${ID}"><script>`],
    ['an embed path with no id', 'https://www.youtube.com/embed/'],
    // Vertical, and the frame is 16:9: refused until a frame can take its shape.
    ['a Shorts link', `https://www.youtube.com/shorts/${ID}`],
    // YouTube's own words in the id's place: eleven characters, but no video.
    [
      'a playlist embed',
      'https://www.youtube.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG',
    ],
    [
      'a channel live-stream embed',
      'https://www.youtube.com/embed/live_stream?channel=UC1234567890',
    ],
    ['a javascript: link', `javascript:alert('https://youtu.be/${ID}')`],
    ['a data: link', 'data:text/html,<p>hi</p>'],
    ['something that is not a URL', 'youtu.be/dQw4w9WgXcQ'],
    ['an empty string', ''],
  ])('resolves %s to no player', (_what, href) => {
    expect(resolveVideoPlayer(href)).toBeNull();
    expect(isPlayableVideoLink(href)).toBe(false);
  });
});

describe('what an admin reads when a link is refused', () => {
  it('names the host that is supported and shows the two link forms', () => {
    expect(UNSUPPORTED_VIDEO_LINK_MESSAGE).toMatch(/YouTube/);
    expect(UNSUPPORTED_VIDEO_LINK_MESSAGE).toMatch(/youtube\.com\/watch\?v=/);
    expect(UNSUPPORTED_VIDEO_LINK_MESSAGE).toMatch(/youtu\.be/);
  });
});
