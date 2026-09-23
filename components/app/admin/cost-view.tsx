/**
 * The admin cost view: who and what is spending, this UTC month (f-budget t-97).
 *
 * With no revenue every conversation is pure cost, and this is the number that
 * sets prices later (§7.2). Sunrise's `/admin/orchestration/costs` is per agent
 * and per model; with one agent it cannot say which person is running away.
 * This can.
 *
 * ## Server components, platform chrome
 *
 * Nothing here is interactive — every level of the drill-down is its own page
 * and a link — so none of it ships to the browser. It uses Sunrise's
 * `components/ui/table` rather than anything brand-styled, for the reason
 * `waitlist-table.tsx` gives: `/admin/**` is the `admin` surface, which the
 * brand theme does not reach.
 *
 * ## Every spend through `figure()`, every other amount through `amount()`
 *
 * Every figure that sums spend goes through `figure()` in
 * `lib/app/agent/cost-view.ts`, which says "at least" where unpriced rows make
 * it short — so no total can forget the floor — and each half of the headline,
 * and each of a turn's reply and side, is a floor only for its own unpriced
 * rows. Amounts that carry no floor of their own — a limit, an overage, one
 * row — go through `amount()`. Both refuse to print `$0.00` for spend that
 * exists. And the headline totals are the API's own, never a sum of the listed
 * rows, which would state the shown part as the whole whenever the list is cut.
 *
 * @see lib/app/agent/cost-view.ts — every judgement these render
 * @see .context/app/budget.md — "The admin cost view"
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { costConversationPage, costTurnPage } from '@/lib/app/agent/endpoint';
import {
  amount,
  figure,
  limitStanding,
  people,
  RUNAWAY_MULTIPLE,
  runawayConversations,
  windowLabel,
  type ConversationGroup,
  type ConversationTurnsReading,
  type CostBreakdown,
  type CostGroup,
  type PersonGroup,
  type TurnReading,
} from '@/lib/app/agent/cost-view';

/** Said wherever a read failed — the rest of the page still stands. */
function Unread({ what }: { what: string }) {
  return (
    <p role="alert" className="text-destructive text-sm">
      {what} did not load. Reload the page — if it keeps failing, the metering endpoint is the thing
      to check.
    </p>
  );
}

/** Said under a cut list: what is missing, and that the totals are not. */
function Truncated({ shown }: { shown: number }) {
  return (
    <p className="text-muted-foreground text-xs">
      The {shown} largest are listed; smaller ones are not. The totals above cover every one.
    </p>
  );
}

function Floor({ unpricedRows }: { unpricedRows: number }) {
  if (unpricedRows <= 0) return null;
  return (
    <span className="text-muted-foreground text-xs">
      {' '}
      · {unpricedRows} unpriced {unpricedRows === 1 ? 'row' : 'rows'}
    </span>
  );
}

function Section({
  title,
  lede,
  children,
}: {
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2" aria-label={title}>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        {lede ? <p className="text-muted-foreground text-sm">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * The headline: everything, the part no person incurred, the part people did —
 * each a floor only for its own unpriced rows.
 */
function Headline({ breakdown }: { breakdown: CostBreakdown }) {
  const { totals } = breakdown;
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-md border p-3">
        <p className="text-muted-foreground text-xs">This month, everything</p>
        <p className="text-xl font-semibold tabular-nums" data-figure="total">
          {figure(totals)}
        </p>
        <p className="text-muted-foreground text-xs">
          {totals.costRows} cost {totals.costRows === 1 ? 'row' : 'rows'}
          <Floor unpricedRows={totals.unpricedRows} />
        </p>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-muted-foreground text-xs">Platform cost — no person incurred it</p>
        <p className="text-xl font-semibold tabular-nums" data-figure="platform">
          {figure({
            costUsd: totals.platformCostUsd,
            unpricedRows: totals.platformUnpricedRows,
          })}
        </p>
        <p className="text-muted-foreground text-xs">
          Ingestion, scheduled work, and erased accounts. Never added to anyone below.
        </p>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-muted-foreground text-xs">Incurred by people</p>
        <p className="text-xl font-semibold tabular-nums" data-figure="people">
          {figure({
            // Two float sums over different rows, subtracted: held at zero so
            // noise never reads as "<$0.01" or "-$0.00" (/code-review round 3).
            costUsd: Math.max(0, totals.costUsd - totals.platformCostUsd),
            // Each half carries only its own unpriced rows, so one side's
            // missing price never casts doubt on the other's figure.
            unpricedRows: totals.unpricedRows - totals.platformUnpricedRows,
          })}
        </p>
      </div>
    </div>
  );
}

function StandingBadge({ group }: { group: PersonGroup }) {
  const standing = limitStanding(group);
  if (!standing || standing.kind === 'under') return null;
  const label =
    standing.kind === 'past'
      ? // `amount()`, so an overage under a cent is `<$0.01`, never "$0.00".
        `past limit by ${amount(standing.byUsd)}`
      : standing.kind === 'nothing-allowed'
        ? 'spent against a $0 limit'
        : 'at limit';
  return <Badge variant="destructive">{label}</Badge>;
}

function PeopleTable({ breakdown }: { breakdown: CostBreakdown<PersonGroup> }) {
  const rows = people(breakdown);
  if (rows.length === 0)
    return (
      <p className="text-muted-foreground text-sm">No one has spent anything yet this month.</p>
    );
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Person</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead className="text-right">Limit</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((group) => (
            <TableRow key={group.key} data-person={group.key ?? ''}>
              <TableCell>
                {group.user ? (
                  <>
                    <span className="font-medium">{group.user.name}</span>{' '}
                    <span className="text-muted-foreground text-xs">{group.user.email}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground">An account that no longer exists</span>
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {figure(group)}
                <Floor unpricedRows={group.unpricedRows} />
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {group.ceiling ? (
                  <>
                    {amount(group.ceiling.ceilingUsd)}
                    {group.ceiling.source === 'override' ? (
                      <span className="text-muted-foreground text-xs"> · their own</span>
                    ) : null}
                  </>
                ) : (
                  '—'
                )}
              </TableCell>
              <TableCell>
                <StandingBadge group={group} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* The rows shown, not the groups returned: the platform group is one of those. */}
      {breakdown.truncated ? <Truncated shown={rows.length} /> : null}
    </>
  );
}

function ConversationsTable({ breakdown }: { breakdown: CostBreakdown<ConversationGroup> }) {
  if (breakdown.groups.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No conversation has cost anything yet this month.
      </p>
    );
  }
  const runaways = runawayConversations(breakdown);
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Conversation</TableHead>
            <TableHead>Whose</TableHead>
            <TableHead className="text-right">Spent</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.groups.map((group) => (
            <TableRow key={group.key ?? 'none'} data-conversation={group.key ?? ''}>
              <TableCell>
                {group.key ? (
                  <Link
                    href={costConversationPage(group.key)}
                    className="underline-offset-4 hover:underline"
                  >
                    {group.conversation?.title || 'Untitled conversation'}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">Not in a conversation</span>
                )}
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {group.conversation?.user?.name ?? (group.key ? '—' : '')}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {figure(group)}
                <Floor unpricedRows={group.unpricedRows} />
              </TableCell>
              <TableCell>
                {group.key && runaways.has(group.key) ? (
                  <Badge variant="destructive">far above the rest</Badge>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {breakdown.truncated ? <Truncated shown={breakdown.groups.length} /> : null}
    </>
  );
}

/** Seat, model, day: a key and a figure, and nothing to flag. */
function PlainTable({
  breakdown,
  keyLabel,
  none,
}: {
  breakdown: CostBreakdown<CostGroup>;
  keyLabel: string;
  none: string;
}) {
  if (breakdown.groups.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing yet this month.</p>;
  }
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{keyLabel}</TableHead>
            <TableHead className="text-right">Spent</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {breakdown.groups.map((group) => (
            <TableRow key={group.key ?? 'none'}>
              <TableCell>
                {group.key ?? <span className="text-muted-foreground">{none}</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {figure(group)}
                <Floor unpricedRows={group.unpricedRows} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {breakdown.truncated ? <Truncated shown={breakdown.groups.length} /> : null}
    </>
  );
}

export interface CostOverviewProps {
  byUser: CostBreakdown<PersonGroup> | null;
  byConversation: CostBreakdown<ConversationGroup> | null;
  bySeat: CostBreakdown | null;
  byModel: CostBreakdown | null;
  byDay: CostBreakdown | null;
}

/** The page: the headline, then who, then what, then how. */
export function CostOverview({
  byUser,
  byConversation,
  bySeat,
  byModel,
  byDay,
}: CostOverviewProps) {
  // Every breakdown carries the same totals over the same window; the first
  // that loaded states them.
  const headline = byUser ?? byConversation ?? bySeat ?? byModel ?? byDay;
  return (
    <div className="space-y-8">
      {headline ? (
        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">{windowLabel(headline.window)}</p>
          <Headline breakdown={headline} />
        </div>
      ) : (
        <Unread what="This month's figures" />
      )}

      <Section
        title="Who"
        lede="Each person's spend against what they may spend this month. A person at or past their limit is flagged — their next turn is refused until the month resets."
      >
        {byUser ? <PeopleTable breakdown={byUser} /> : <Unread what="The people" />}
      </Section>

      <Section
        title="Which conversations"
        lede={`Open one to see its turns. A conversation costing ${RUNAWAY_MULTIPLE}× or more the typical one listed here is flagged.`}
      >
        {byConversation ? (
          <ConversationsTable breakdown={byConversation} />
        ) : (
          <Unread what="The conversations" />
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-3">
        <Section title="By seat">
          {bySeat ? (
            <PlainTable breakdown={bySeat} keyLabel="Seat" none="No seat" />
          ) : (
            <Unread what="The seats" />
          )}
        </Section>
        <Section title="By model">
          {byModel ? (
            <PlainTable breakdown={byModel} keyLabel="Model" none="No model" />
          ) : (
            <Unread what="The models" />
          )}
        </Section>
        <Section title="By day (UTC)">
          {byDay ? (
            <PlainTable breakdown={byDay} keyLabel="Day" none="—" />
          ) : (
            <Unread what="The days" />
          )}
        </Section>
      </div>
    </div>
  );
}

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/** One conversation's turns, costliest first — the middle of the drill-down. */
export function ConversationTurnsView({ reading }: { reading: ConversationTurnsReading }) {
  if (reading.turns.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No turns in this conversation had any cost in {windowLabel(reading.window)}.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-sm">
        Turns with cost in this conversation in {windowLabel(reading.window)}, costliest first. Each
        figure is the turn&rsquo;s whole cost — its reply and everything it caused on the side,
        every attempt. Costs in the conversation tied to no turn are counted in its figure on the
        cost page but are not listed here.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Started (UTC)</TableHead>
            <TableHead>Seat</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reading.turns.map((turn) => (
            <TableRow key={`${turn.userId}:${turn.turnId}`} data-turn={turn.turnId}>
              <TableCell>
                <Link
                  href={costTurnPage(turn.userId, turn.turnId)}
                  className="underline-offset-4 hover:underline"
                >
                  {when.format(new Date(turn.startedAt))}
                </Link>
              </TableCell>
              <TableCell>{turn.seat}</TableCell>
              <TableCell className="text-sm">{turn.model ?? '—'}</TableCell>
              <TableCell className="text-sm">
                {turn.status}
                {turn.attempts > 1 ? ` · ${turn.attempts} attempts` : ''}
                {turn.errorCode ? ` · ${turn.errorCode}` : ''}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {figure(turn)}
                <Floor unpricedRows={turn.unpricedRows} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {reading.truncated ? (
        <p className="text-muted-foreground text-xs">
          The {reading.turns.length} costliest turns are listed; cheaper ones are not.
        </p>
      ) : null}
    </div>
  );
}

/** One turn, every row it cost — the bottom of the drill-down. */
export function TurnCostView({ reading }: { reading: TurnReading }) {
  // The reply and the side each a floor only for their own unpriced rows.
  const unpricedReply = reading.rows.filter((row) => row.unpriced && row.part === 'reply').length;
  const unpricedSide = reading.rows.filter((row) => row.unpriced && row.part !== 'reply').length;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">The whole turn</p>
          <p className="text-xl font-semibold tabular-nums" data-figure="turn">
            {figure(reading)}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">The reply</p>
          <p className="text-xl font-semibold tabular-nums" data-figure="reply">
            {figure({ costUsd: reading.replyCostUsd, unpricedRows: unpricedReply })}
          </p>
        </div>
        <div className="rounded-md border p-3">
          <p className="text-muted-foreground text-xs">
            On the side — searches, summaries, tools, earlier attempts
          </p>
          <p className="text-xl font-semibold tabular-nums" data-figure="side">
            {figure({ costUsd: reading.sideCostUsd, unpricedRows: unpricedSide })}
          </p>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        {reading.seat} · {reading.model ?? 'no model recorded'} · {reading.status}
        {reading.attempts > 1 ? ` · ${reading.attempts} attempts` : ''}
        {reading.errorCode ? ` · ended ${reading.errorCode}` : ''}
        {reading.conversationId ? (
          <>
            {' · '}
            <Link
              href={costConversationPage(reading.conversationId)}
              className="underline-offset-4 hover:underline"
            >
              its conversation
            </Link>
          </>
        ) : null}
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When (UTC)</TableHead>
            <TableHead>Part</TableHead>
            <TableHead>Operation</TableHead>
            <TableHead>Model</TableHead>
            <TableHead className="text-right">Tokens in / out</TableHead>
            <TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {reading.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-sm">{when.format(new Date(row.createdAt))}</TableCell>
              <TableCell>{row.part}</TableCell>
              <TableCell className="text-sm">{row.operation}</TableCell>
              <TableCell className="text-sm">{row.model}</TableCell>
              <TableCell className="text-right text-sm tabular-nums">
                {row.inputTokens} / {row.outputTokens}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.unpriced ? (
                  <span className="text-muted-foreground">no price on file</span>
                ) : (
                  amount(row.costUsd)
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
