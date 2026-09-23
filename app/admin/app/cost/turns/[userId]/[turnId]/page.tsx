import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { TurnCostView } from '@/components/app/admin/cost-view';
import { adminTurnMeterEndpoint, COST_ADMIN_PAGE } from '@/lib/app/agent/endpoint';
import type { TurnReading } from '@/lib/app/agent/cost-view';

export const metadata: Metadata = { title: 'Cost — one turn' };

type Read = { kind: 'ok'; reading: TurnReading } | { kind: 'missing' } | { kind: 'failed' };

async function getTurn(userId: string, turnId: string): Promise<Read> {
  try {
    const response = await serverFetch(adminTurnMeterEndpoint(userId, turnId));
    if (response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'failed' };
    const parsed = await parseApiResponse<TurnReading>(response);
    return parsed.success ? { kind: 'ok', reading: parsed.data } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * One turn, every row it cost (f-budget t-97) — the bottom of the drill-down,
 * and the first reader `GET /api/v1/admin/app/metering/users/:userId/turns/:turnId`
 * has had since #66. It is the only read that sums a turn's SIDE costs — a
 * search's embedding, a summary, tool calls, an earlier attempt's rows — which
 * were spent too. Addressed by person and turn, as the route is, because turn
 * ids are unique per person.
 */
export default async function CostTurnPage({
  params,
}: {
  params: Promise<{ userId: string; turnId: string }>;
}) {
  const { userId, turnId } = await params;
  const read = await getTurn(userId, turnId);
  if (read.kind === 'missing') notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={COST_ADMIN_PAGE} className="text-muted-foreground text-sm hover:underline">
          ← Cost
        </Link>
        <h2 className="text-lg font-semibold">One turn&rsquo;s cost</h2>
      </div>
      {read.kind === 'ok' ? (
        <TurnCostView reading={read.reading} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          This turn did not load. Reload the page — if it keeps failing, the metering endpoint is
          the thing to check.
        </p>
      )}
    </div>
  );
}
