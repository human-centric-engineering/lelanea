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
    ['a Shorts link', `https://www.youtube.com/shorts/${ID}`],
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
