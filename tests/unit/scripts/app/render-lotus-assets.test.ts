/**
 * Where `npm run lotus:assets` writes. The bytes are pinned by
 * `lotus-assets.test.ts` against the files in the tree; this pins the paths,
 * which is what Sunrise 0.14.0 moved: its favicons live in `app/` now, and a
 * `public/favicon.*` beside them is refused by Next (divergence row 13).
 *
 * @see scripts/app/render-lotus-assets.ts
 */
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const { writeFileSync, toFile, logged } = vi.hoisted(() => ({
  writeFileSync: vi.fn(),
  toFile: vi.fn().mockResolvedValue(undefined),
  logged: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, writeFileSync };
});

// Every sharp call chains to a PNG buffer or a file; the image itself is not
// what this test is about.
vi.mock('sharp', () => {
  const chain = {
    resize: () => chain,
    png: () => chain,
    flatten: () => chain,
    toBuffer: () => Promise.resolve(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    toFile,
  };
  return { default: () => chain };
});

async function run(): Promise<string[]> {
  vi.spyOn(console, 'log').mockImplementation(logged);
  await import('@/scripts/app/render-lotus-assets');
  await vi.waitFor(() => expect(logged).toHaveBeenCalled());
  const root = process.cwd();
  return [
    ...writeFileSync.mock.calls.map(([file]) => path.relative(root, String(file))),
    ...toFile.mock.calls.map(([file]) => path.relative(root, String(file))),
  ];
}

describe('npm run lotus:assets', () => {
  it("writes the favicons where Sunrise's app/ convention reads them, and none to public/", async () => {
    const written = await run();

    expect(written).toEqual(
      expect.arrayContaining(['app/icon.svg', 'app/favicon.ico', 'app/apple-icon.png'])
    );
    expect(written.filter((file) => file.startsWith('public/favicon'))).toEqual([]);

    // The ICO is a real container: three PNG entries, 16/32/48.
    const ico = writeFileSync.mock.calls.find(([file]) =>
      String(file).endsWith(path.join('app', 'favicon.ico'))
    )?.[1] as Buffer;
    expect(ico.readUInt16LE(4)).toBe(3);
    expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);
  });
});
