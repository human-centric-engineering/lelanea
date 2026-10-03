import { notFound } from 'next/navigation';

import { LotusBench } from '@/components/app/lab/lotus-bench';
import { LotusLab } from '@/components/app/lab/lotus-lab';

/**
 * t-131 prototype bench: today's bloom beside the candidate renderers.
 * Development only — 404 in production.
 *
 * `?t=<ms>` freezes every candidate at that point in the opening, `?rm=1`
 * simulates reduced motion, `?only=svg|three|current` shows one, large, `?theme=light|dark` forces a mode.
 */
export default async function LotusLabPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === 'production') notFound();
  const params = await searchParams;
  const one = (k: string) => (typeof params[k] === 'string' ? params[k] : undefined);
  const t = one('t');
  const bench = one('bench');
  if (bench) return <LotusBench id={bench} />;
  return (
    <LotusLab
      frozenMs={t !== undefined && Number.isFinite(Number(t)) ? Number(t) : undefined}
      reducedMotion={one('rm') === '1'}
      only={one('only')}
      theme={one('theme')}
    />
  );
}
