/**
 * Unit Tests: which audio links play inline (f-resources t-120). Any other
 * audio link is accepted and opens in a new tab; this is only which ones play.
 *
 * An audio piece's `<audio src>` is its stored link, so what is accepted must
 * be a direct `https` link to an `.mp3` or `.m4a` file and nothing that only
 * looks like one: a page about the audio, a file named in the query string, a
 * scheme a page served over https will not play.
 *
 * @see lib/app/content/audio-hosts.ts
 */

import { describe, it, expect } from 'vitest';

import {
  AUDIO_MEDIA_ORIGINS,
  canPlayInPage,
  resolveAudioPlayer,
} from '@/lib/app/content/audio-hosts';

describe('an audio link that plays inline', () => {
  it.each([
    ['an .mp3 file', 'https://cdn.example/episodes/one.mp3', 'audio/mpeg'],
    ['an .m4a file', 'https://cdn.example/episodes/one.m4a', 'audio/mp4'],
    ['an upper-case extension', 'https://cdn.example/ONE.MP3', 'audio/mpeg'],
    [
      'a file with a signed query string',
      'https://cdn.example/one.mp3?sig=abc&exp=1',
      'audio/mpeg',
    ],
  ])('resolves %s to a player', (_what, href, type) => {
    expect(resolveAudioPlayer(href)).toEqual({ src: href, type });
  });
});

describe('an audio link that does not', () => {
  it.each([
    ['an http file, which an https page will not play', 'http://cdn.example/one.mp3'],
    ['another audio format', 'https://cdn.example/one.wav'],
    ['a video file', 'https://cdn.example/one.mp4'],
    ['a page about the audio', 'https://soundcloud.com/her/an-episode'],
    ['a file named only in the query', 'https://cdn.example/play?file=one.mp3'],
    ['a path that only contains .mp3', 'https://cdn.example/one.mp3/page'],
    ['a javascript: link', 'javascript:alert(1)//.mp3'],
    ['a data: link', 'data:audio/mpeg;base64,AAAA.mp3'],
    ['something that is not a URL', 'one.mp3'],
  ])('resolves %s to no player', (_what, href) => {
    expect(resolveAudioPlayer(href)).toBeNull();
  });
});

describe('where the web page may play a file from', () => {
  const PAGE = 'https://lelanea.example';

  it('plays a file on the page’s own origin', () => {
    expect(canPlayInPage(`${PAGE}/uploads/one.mp3`, PAGE)).toBe(true);
  });

  it('does not play a file on another origin while none is allowed', () => {
    // Pinned: the list is the media-src this app adds, and Sunrise gives it no
    // seam yet (sunrise#841). Adding an origin here without adding it to the
    // CSP would offer a player the browser refuses.
    expect(AUDIO_MEDIA_ORIGINS).toEqual([]);
    expect(canPlayInPage('https://cdn.example/one.mp3', PAGE)).toBe(false);
  });

  it('does not take a look-alike for the page’s origin', () => {
    expect(canPlayInPage('https://lelanea.example.evil/one.mp3', PAGE)).toBe(false);
    expect(canPlayInPage('http://lelanea.example/one.mp3', PAGE)).toBe(false);
    expect(canPlayInPage('not a url', PAGE)).toBe(false);
  });
});
