'use client';

import { useEffect, useState } from 'react';

import { Lotus } from '@/components/app/ui/lotus';
import { LotusSvg } from '@/components/app/lab/lotus-svg';
import { LotusThree } from '@/components/app/lab/lotus-three';
import { VARIANTS } from '@/components/app/lab/lotus-variants';

/** t-131 prototype bench. Not product UI. */
export function LotusLab({
  frozenMs,
  reducedMotion,
  only,
  theme,
}: {
  frozenMs?: number;
  reducedMotion?: boolean;
  only?: string;
  theme?: string;
}) {
  const [playKey, setPlayKey] = useState(0);
  useEffect(() => {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  const ids = only?.split(',');
  const size = ids && ids.length === 1 ? 640 : 300;
  // Default: the photo-led round plus C1, the owner's pick from round one.
  const shown = VARIANTS.filter((v) =>
    ids ? ids.includes(v.id) : v.set === 'photo' || v.id === 'C1' || theme === 'all'
  );
  const common = { size, frozenMs, reducedMotion, playKey };

  return (
    <main className="bg-background text-foreground min-h-screen p-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="font-serif text-2xl">Lotus lab (t-131)</h1>
        <button
          type="button"
          className="rounded-full border px-4 py-1 text-sm"
          onClick={() => setPlayKey((k) => k + 1)}
        >
          Replay
        </button>
        <button
          type="button"
          className="rounded-full border px-4 py-1 text-sm"
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          Toggle dark
        </button>
        <span className="text-muted-foreground text-sm">
          ?only=R1,C1 to compare a few · ?t=1400 to freeze a moment · earlier round:
          ?only=C1,C2,C3,S1,S2,S3,S4,S5,S6,S7,S8,S9,S10,S11,S12,S13
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(310px,1fr))] gap-x-4 gap-y-6">
        {!ids && (
          <figure className="flex flex-col items-center gap-2">
            <div className="flex h-[175px] items-end">
              <Lotus key={`a${playKey}`} size={150} autoOpen idle water />
            </div>
            <figcaption className="text-muted-foreground text-xs">A · today</figcaption>
          </figure>
        )}
        {shown.map((v) => (
          <figure key={v.id} className="flex flex-col items-center gap-2">
            {v.renderer === 'three' ? (
              <LotusThree {...common} config={v.config} />
            ) : (
              <LotusSvg {...common} config={v.config} look={v.look} />
            )}
            <figcaption className="text-xs">
              <strong>{v.id}</strong> <span className="text-muted-foreground">· {v.label}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
