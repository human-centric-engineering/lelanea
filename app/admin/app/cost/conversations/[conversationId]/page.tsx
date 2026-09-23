import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { serverFetch, parseApiResponse } from '@/lib/api/server-fetch';
import { ConversationTurnsView } from '@/components/app/admin/cost-view';
import { adminConversationTurnsEndpoint, COST_ADMIN_PAGE } from '@/lib/app/agent/endpoint';
import type { ConversationTurnsReading } from '@/lib/app/agent/cost-view';

export const metadata: Metadata = { title: 'Cost — one conversation' };

type Read =
  { kind: 'ok'; reading: ConversationTurnsReading } | { kind: 'missing' } | { kind: 'failed' };

async function getTurns(conversationId: string): Promise<Read> {
  try {
    const response = await serverFetch(adminConversationTurnsEndpoint(conversationId));
    // The route refuses an id that is not one with a 400: that is a page that
    // does not exist, not an endpoint to go and debug (/code-review round 3).
    if (response.status === 400 || response.status === 404) return { kind: 'missing' };
    if (!response.ok) return { kind: 'failed' };
    const parsed = await parseApiResponse<ConversationTurnsReading>(response);
    return parsed.success ? { kind: 'ok', reading: parsed.data } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * A costly conversation, opened to its turns (f-budget t-97): the middle of
 * the drill-down from the cost page to one turn's every row. One read — the
 * turns carry their own costs and their person's id for the next link.
 */
export default async function CostConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const read = await getTurns(conversationId);
  if (read.kind === 'missing') notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href={COST_ADMIN_PAGE} className="text-muted-foreground text-sm hover:underline">
          ← Cost
        </Link>
        <h2 className="text-lg font-semibold">One conversation&rsquo;s turns</h2>
      </div>
      {read.kind === 'ok' ? (
        <ConversationTurnsView reading={read.reading} />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          This conversation&rsquo;s turns did not load. Reload the page — if it keeps failing, the
          metering endpoint is the thing to check.
        </p>
      )}
    </div>
  );
}
