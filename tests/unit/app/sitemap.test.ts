/**
 * The sitemap lists the routes this app actually has (t-5).
 *
 * The failure worth guarding is not a crash — it is the sitemap and the router
 * disagreeing, in either direction, silently:
 *
 * - A route listed here that does not exist hands crawlers a 404 and, on the
 *   two entries this task deleted, advertised Sunrise's placeholder marketing
 *   pages as Lelañea's own.
 * - A route the site links to but omits here is discoverable by crawl and
 *   absent from the map, which is the state that quietly persists because
 *   nothing renders it.
 *
 * So the assertion is made against the filesystem rather than against a second
 * hand-written list, which would be the same drift one file further along.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import sitemap from '@/app/sitemap';

const PUBLIC_DIR = path.join(process.cwd(), 'app', '(public)');

/** Every route segment under `(public)` that has a `page.tsx`. */
function routesOnDisk(): string[] {
  return readdirSync(PUBLIC_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(path.join(PUBLIC_DIR, e.name, 'page.tsx')))
    .map((e) => `/${e.name}`)
    .sort();
}

const paths = () => sitemap().map((entry) => new URL(entry.url).pathname.replace(/\/$/, '') || '/');

describe('app/sitemap', () => {
  describe('the base URL', () => {
    const original = process.env.NEXT_PUBLIC_APP_URL;

    afterEach(() => {
      if (original === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = original;
    });

    it('uses the configured app URL', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://lelanea.com';
      const expectedOrigin = new URL('https://lelanea.com').origin;

      for (const entry of sitemap()) {
        expect(new URL(entry.url).origin).toBe(expectedOrigin);
      }
    });

    it('falls back to localhost when nothing is configured', () => {
      // The fallback is what a local `next build` uses. Left unexercised it
      // would be the branch that only ever runs on someone else's machine.
      delete process.env.NEXT_PUBLIC_APP_URL;

      const urls = sitemap().map((e) => e.url);
      expect(urls.length).toBeGreaterThan(0);
      for (const url of urls) {
        expect(url.startsWith('http://localhost:3000')).toBe(true);
      }
    });
  });

  it('lists the home page', () => {
    expect(paths()).toContain('/');
  });

  it('lists every public route that exists on disk', () => {
    const listed = paths();
    const onDisk = routesOnDisk();

    // Establish the population — an empty read would make this vacuous.
    expect(onDisk.length).toBeGreaterThan(0);
    for (const route of onDisk) {
      expect(listed, `${route} has a page.tsx but is missing from the sitemap`).toContain(route);
    }
  });

  it('lists no route that does not exist', () => {
    const onDisk = new Set([...routesOnDisk(), '/']);

    for (const route of paths()) {
      expect(onDisk, `${route} is in the sitemap but has no page.tsx`).toContain(route);
    }
  });

  it('no longer advertises the deleted starter pages', () => {
    // These were Sunrise's placeholders; /contact hardcoded "Have a question
    // about Sunrise?". Both are gone, and this is what stops either being
    // reinstated in the map alone.
    expect(paths()).not.toContain('/about');
    expect(paths()).not.toContain('/contact');
  });

  it('gives every entry a priority and a change frequency', () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);

    for (const entry of entries) {
      expect(typeof entry.priority).toBe('number');
      expect(entry.changeFrequency).toBeTruthy();
      expect(entry.lastModified).toBeTruthy();
    }
  });

  it('ranks the home page above the legal pages', () => {
    const byPath = new Map(
      sitemap().map((e) => [new URL(e.url).pathname.replace(/\/$/, '') || '/', e.priority ?? 0])
    );

    expect(byPath.get('/')).toBeGreaterThan(byPath.get('/privacy') ?? 1);
    expect(byPath.get('/')).toBeGreaterThan(byPath.get('/terms') ?? 1);
  });
});
