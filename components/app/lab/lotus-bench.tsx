'use client';

import { useEffect, useState } from 'react';

import { LotusSvg } from '@/components/app/lab/lotus-svg';
import { VARIANTS } from '@/components/app/lab/lotus-variants';

/** t-131: frame-time bench for one variant's opening. Writes results into the DOM. */
export function LotusBench({ id }: { id: string }) {
  const v = VARIANTS.find((x) => x.id === id) ?? VARIANTS[0];
  const [result, setResult] = useState('running');
  useEffect(() => {
    const times: number[] = [];
    let last = performance.now();
    let raf = 0;
    const t0 = last;
    const tick = (now: number) => {
      times.push(now - last);
      last = now;
      if (now - t0 < 3400) raf = requestAnimationFrame(tick);
      else {
        const sorted = [...times].sort((a, b) => a - b);
        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        setResult(
          `frames=${times.length} avg=${avg.toFixed(1)}ms p95=${sorted[Math.floor(sorted.length * 0.95)].toFixed(1)}ms max=${sorted[sorted.length - 1].toFixed(1)}ms`
        );
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div>
      <pre id="bench">{result}</pre>
      <LotusSvg size={300} config={v.config} look={v.look} />
    </div>
  );
}
