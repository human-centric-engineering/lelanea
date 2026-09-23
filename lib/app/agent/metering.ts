/**
 * The meter, readable — what anyone's conversations cost, and what produced
 * each turn (§08 t-56; product description §3.20, §7.2, §11).
 *
 * t-54 made every turn write who took it, on which seat, and tagged its cost
 * rows with the turn id. None of it could be read without a database console,
 * which for a meter is the same as not metering (`HB9`). This is the read side
 * f-budget's usage view, f-conversation's per-turn drawer and the admin cost
 * view share. It enforces nothing.
 *
 * ## The cost log is the only source of dollars
 *
 * Every dollar and token here is summed from Sunrise's `ai_cost_log`, read in
 * place. Nothing is copied into a table of ours: a second table of dollars is a
 * second answer, and the two drift. The turn record (`app_turn`) is read for
 * what the cost log does not know — the fingerprint version, the seat, the
 * turn's status — never for its own `costUsd`, which is the chat call alone.
 *
 * ## Three rules every aggregate keeps
 *
 * - **Totals reconcile.** A breakdown's totals are the sum of the cost rows in
 *   its window, computed separately from the groups, so they stay whole when the
 *   group list is truncated.
 * - **A row with no user is platform cost.** Knowledge ingestion, scheduled
 *   work, and the rows of an erased account carry no user. They are counted in
 *   every admin total and reported as `platformCostUsd` — never dropped, never
 *   attributed to anyone. A member's own read simply does not include them.
 * - **Seat comes from the row's tag, else from its conversation.** Rows written
 *   before t-54 carry no `seat`; for those the conversation's facilitation
 *   context (`contextType = 'facilitation'`, `contextId` = the seat) answers. The
 *   untagged reply embedding is seated the same way.
 *
 * ## $0 is not "free"
 *
 * A row that used tokens and was costed at $0 on a non-local provider was priced
 * by a registry with no rate for its model (see "A turn costed at nothing" in
 * the doc). Such rows are counted as `unpricedRows` everywhere, so a total that
 * contains them reads as a floor, not an answer.
 *
 * ## Watch item: no `(userId, createdAt)` index
 *
 * The month-to-date read filters `ai_cost_log` by user and time. Sunrise indexes
 * `userId` alone, and an index we added to a Sunrise table would be dropped by
 * the next generated migration. Fine at current volume. **Trigger to revisit:**
 * this query showing in slow-query logs — then it is an upstream request.
 *
 * @see .context/app/agent.md — "Reading the meter"
 */

import type { AppTurn, AppTurnPricing, AppTurnStatus } from '@prisma/client';

import { prisma } from '@/lib/db/client';
import { isRecord } from '@/lib/utils';
import { FACILITATION_SURFACE_CONTEXT_TYPE } from '@/lib/framework/facilitation/agents/surface';
import {
  getEffectiveMonthlyCeiling,
  getEffectiveMonthlyCeilings,
  type EffectiveCeiling,
} from '@/lib/app/agent/settings';
import type { MeterDimension } from '@/lib/validations/app-metering';

/** A half-open UTC window, `[from, to)`. */
export interface MeterWindow {
  from: Date;
  to: Date;
}

/** Spend and tokens over a set of cost rows. */
export interface MeterTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** How many cost rows were summed. */
  costRows: number;
  /** Rows that used tokens yet were costed at $0 on a provider not configured as local. */
  unpricedRows: number;
}

/**
 * One group of a breakdown.
 *
 * `key` is the dimension's value: a user id, a conversation id, a seat, a model
 * id, or a `YYYY-MM-DD` UTC day. **Null means the row has none** — platform cost
 * when grouped by user, unseated when by seat, no conversation when by
 * conversation.
 */
export interface MeterGroup extends MeterTotals {
  key: string | null;
}

/**
 * An admin breakdown by user names the people, and carries what each may spend
 * this month, so the view needs no second fetch — neither for a name nor to
 * flag whoever is at or past their limit (f-budget t-97). Both are null on the
 * platform-cost group, which is nobody.
 */
export interface MeterUserGroup extends MeterGroup {
  user: { name: string; email: string } | null;
  ceiling: EffectiveCeiling | null;
}

/**
 * An admin breakdown by conversation says whose each one is and what it is
 * called (t-97) — the owner's id is also what the drill-down to a turn needs,
 * because turn ids are unique per person, not globally. Null for the group of
 * rows with no conversation, and for a conversation since deleted.
 */
export interface MeterConversationGroup extends MeterGroup {
  conversation: {
    title: string | null;
    userId: string | null;
    user: { name: string; email: string } | null;
  } | null;
}

export interface MeterBreakdown<G extends MeterGroup = MeterGroup> {
  by: MeterDimension;
  window: MeterWindow;
  /** Every cost row in the window, whether or not its group was returned. */
  totals: MeterTotals & {
    /** The share of `costUsd` with no user. Always 0 on a member's own read. */
    platformCostUsd: number;
  };
  groups: G[];
  /**
   * More groups existed than `limit`. The smallest were left out — by day, the
   * oldest — never the totals.
   */
  truncated: boolean;
}

/** The current UTC month, from its first instant to now. */
export function monthToDateWindow(now: Date = new Date()): MeterWindow {
  return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to: now };
}

/** A requested window, defaulting to month to date on whichever end is missing. */
export function resolveWindow(
  requested: { from?: Date; to?: Date },
  now: Date = new Date()
): MeterWindow {
  const to = requested.to ?? now;
  return { from: requested.from ?? monthToDateWindow(to).from, to };
}

// ─── Raw rows ────────────────────────────────────────────────────────────────

/** Postgres SUM/COUNT come back as bigint or numeric-as-string; coerce once. */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return 0;
}

interface RawTotals {
  cost_usd: unknown;
  input_tokens: unknown;
  output_tokens: unknown;
  cost_rows: unknown;
  unpriced_rows: unknown;
}

function toTotals(raw: RawTotals | undefined): MeterTotals {
  return {
    costUsd: toNumber(raw?.cost_usd),
    inputTokens: toNumber(raw?.input_tokens),
    outputTokens: toNumber(raw?.output_tokens),
    costRows: toNumber(raw?.cost_rows),
    unpricedRows: toNumber(raw?.unpriced_rows),
  };
}

// ─── Breakdowns ──────────────────────────────────────────────────────────────

interface BreakdownScope {
  by: MeterDimension;
  window: MeterWindow;
  /** One person's rows. Null: every row, user-less included. */
  userId: string | null;
  limit: number;
}

/**
 * Group the cost log in a window by one dimension.
 *
 * One statement per question and no string-built SQL: the dimension is a bound
 * parameter picked by `CASE`, so every value reaching Postgres is a parameter.
 * The conversation join exists only to seat untagged rows.
 */
async function breakdown(scope: BreakdownScope): Promise<MeterBreakdown> {
  const { by, window, userId, limit } = scope;

  const [groups, totals] = await Promise.all([
    prisma.$queryRaw<Array<RawTotals & { key: string | null }>>`
      WITH metered AS (
        SELECT
          c."totalCostUsd" AS cost,
          c."inputTokens" AS input,
          c."outputTokens" AS output,
          (c."totalCostUsd" = 0 AND NOT c."isLocal" AND c."inputTokens" + c."outputTokens" > 0) AS unpriced,
          CASE ${by}::text
            WHEN 'user' THEN c."userId"
            WHEN 'conversation' THEN c."conversationId"
            WHEN 'seat' THEN COALESCE(
              c.metadata->>'seat',
              CASE WHEN conv."contextType" = ${FACILITATION_SURFACE_CONTEXT_TYPE} THEN conv."contextId" END
            )
            WHEN 'model' THEN c.model
            WHEN 'day' THEN to_char(date_trunc('day', c."createdAt"), 'YYYY-MM-DD')
          END AS key
        FROM ai_cost_log c
        LEFT JOIN ai_conversation conv ON conv.id = c."conversationId"
        WHERE c."createdAt" >= ${window.from}
          AND c."createdAt" < ${window.to}
          AND (${userId}::text IS NULL OR c."userId" = ${userId}::text)
      )
      SELECT
        key,
        SUM(cost) AS cost_usd,
        SUM(input) AS input_tokens,
        SUM(output) AS output_tokens,
        COUNT(*) AS cost_rows,
        COUNT(*) FILTER (WHERE unpriced) AS unpriced_rows
      FROM metered
      GROUP BY key
      ORDER BY
        CASE WHEN ${by}::text = 'day' THEN key END DESC,
        SUM(cost) DESC,
        key ASC NULLS LAST
      LIMIT ${limit + 1}
    `,
    prisma.$queryRaw<Array<RawTotals & { platform_cost_usd: unknown }>>`
      SELECT
        SUM(c."totalCostUsd") AS cost_usd,
        SUM(c."inputTokens") AS input_tokens,
        SUM(c."outputTokens") AS output_tokens,
        COUNT(*) AS cost_rows,
        COUNT(*) FILTER (
          WHERE c."totalCostUsd" = 0 AND NOT c."isLocal" AND c."inputTokens" + c."outputTokens" > 0
        ) AS unpriced_rows,
        SUM(c."totalCostUsd") FILTER (WHERE c."userId" IS NULL) AS platform_cost_usd
      FROM ai_cost_log c
      WHERE c."createdAt" >= ${window.from}
        AND c."createdAt" < ${window.to}
        AND (${userId}::text IS NULL OR c."userId" = ${userId}::text)
    `,
  ]);

  return {
    by,
    window,
    totals: { ...toTotals(totals[0]), platformCostUsd: toNumber(totals[0]?.platform_cost_usd) },
    // By day the query keeps the NEWEST days — the cut is the oldest, which a
    // usage view needs least — and they are handed back oldest first, to chart.
    groups: (by === 'day' ? groups.slice(0, limit).reverse() : groups.slice(0, limit)).map(
      (row) => ({ key: row.key, ...toTotals(row) })
    ),
    truncated: groups.length > limit,
  };
}

/**
 * One person's own spend, grouped. Only ever their rows — the caller passes the
 * session's id, never one from the request.
 */
export function getMemberBreakdown(
  userId: string,
  query: { by: Exclude<MeterDimension, 'user'>; window: MeterWindow; limit: number }
): Promise<MeterBreakdown> {
  return breakdown({ ...query, userId });
}

/**
 * Anyone's spend, or everyone's, grouped — for an admin. Grouped by user, each
 * group names its person; the null group is platform cost.
 */
export async function getAdminBreakdown(query: {
  by: MeterDimension;
  window: MeterWindow;
  limit: number;
  userId?: string;
}): Promise<MeterBreakdown<MeterGroup | MeterUserGroup | MeterConversationGroup>> {
  const result = await breakdown({ ...query, userId: query.userId ?? null });
  if (query.by === 'user') return withPeople(result);
  if (query.by === 'conversation') return withConversations(result);
  return result;
}

/** Name each person, and give each their effective ceiling — two reads for the whole list. */
async function withPeople(result: MeterBreakdown): Promise<MeterBreakdown<MeterUserGroup>> {
  const ids = result.groups.flatMap((group) => (group.key ? [group.key] : []));
  const [users, ceilings] = await Promise.all([
    ids.length
      ? prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true, email: true },
        })
      : Promise.resolve([]),
    getEffectiveMonthlyCeilings(ids),
  ]);
  const byId = new Map(users.map((user) => [user.id, user]));

  return {
    ...result,
    groups: result.groups.map((group) => {
      const user = group.key ? byId.get(group.key) : undefined;
      return {
        ...group,
        user: user ? { name: user.name, email: user.email } : null,
        ceiling: group.key ? (ceilings.get(group.key) ?? null) : null,
      };
    }),
  };
}

/** Title and owner for each conversation — two reads for the whole list. */
async function withConversations(
  result: MeterBreakdown
): Promise<MeterBreakdown<MeterConversationGroup>> {
  const ids = result.groups.flatMap((group) => (group.key ? [group.key] : []));
  const conversations = ids.length
    ? await prisma.aiConversation.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, userId: true },
      })
    : [];
  const ownerIds = [...new Set(conversations.flatMap((row) => (row.userId ? [row.userId] : [])))];
  const owners = ownerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const byId = new Map(conversations.map((row) => [row.id, row]));
  const ownerById = new Map(owners.map((user) => [user.id, user]));

  return {
    ...result,
    groups: result.groups.map((group) => {
      const row = group.key ? byId.get(group.key) : undefined;
      if (!row) return { ...group, conversation: null };
      const owner = row.userId ? ownerById.get(row.userId) : undefined;
      return {
        ...group,
        conversation: {
          title: row.title,
          userId: row.userId,
          user: owner ? { name: owner.name, email: owner.email } : null,
        },
      };
    }),
  };
}

// ─── Month to date ───────────────────────────────────────────────────────────

export interface MonthToDate extends MeterTotals {
  userId: string;
  window: MeterWindow;
  ceiling: EffectiveCeiling;
  /** What is left before the ceiling; never negative. */
  remainingUsd: number;
  /** Spend over ceiling; null when the ceiling is zero. Above 1 means over. */
  fractionUsed: number | null;
}

/**
 * One person's spend this UTC month against their effective ceiling. Reports;
 * does not enforce — that is f-safety's.
 */
export async function getMonthToDate(userId: string, now: Date = new Date()): Promise<MonthToDate> {
  const window = monthToDateWindow(now);
  const [rows, ceiling] = await Promise.all([
    prisma.$queryRaw<RawTotals[]>`
      SELECT
        SUM(c."totalCostUsd") AS cost_usd,
        SUM(c."inputTokens") AS input_tokens,
        SUM(c."outputTokens") AS output_tokens,
        COUNT(*) AS cost_rows,
        COUNT(*) FILTER (
          WHERE c."totalCostUsd" = 0 AND NOT c."isLocal" AND c."inputTokens" + c."outputTokens" > 0
        ) AS unpriced_rows
      FROM ai_cost_log c
      WHERE c."userId" = ${userId}
        AND c."createdAt" >= ${window.from}
        AND c."createdAt" < ${window.to}
    `,
    getEffectiveMonthlyCeiling(userId),
  ]);

  const totals = toTotals(rows[0]);
  return {
    userId,
    window,
    ...totals,
    ceiling,
    remainingUsd: Math.max(0, ceiling.ceilingUsd - totals.costUsd),
    fractionUsed: ceiling.ceilingUsd > 0 ? totals.costUsd / ceiling.ceilingUsd : null,
  };
}

// ─── One turn ────────────────────────────────────────────────────────────────

/**
 * What a cost row was for, within a turn.
 *
 * `reply` is her answer (every tool-loop pass); the rest are side costs the turn
 * caused. Read from the row's own `operation` and the `kind` / `slug` the
 * platform stamps last, which a caller cannot overwrite.
 */
export type TurnCostPart =
  'reply' | 'summary' | 'tool' | 'knowledge_search' | 'reply_embedding' | 'attachment' | 'other';

export function classifyCostRow(row: { operation: string; kind: string | null }): TurnCostPart {
  if (row.kind === 'conversation_summary') return 'summary';
  if (row.kind === 'knowledge_search') return 'knowledge_search';
  if (row.kind === 'message_embedding') return 'reply_embedding';
  if (row.operation === 'tool_call') return 'tool';
  if (row.operation === 'vision') return 'attachment';
  if (row.operation === 'chat') return 'reply';
  return 'other';
}

export interface TurnCostRow {
  id: string;
  part: TurnCostPart;
  operation: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  unpriced: boolean;
  createdAt: Date;
}

export interface TurnMeter extends MeterTotals {
  turnId: string;
  seat: string;
  agentSlug: string;
  status: AppTurnStatus;
  attempts: number;
  errorCode: string | null;
  fingerprintVersion: string | null;
  model: string | null;
  provider: string | null;
  pricing: AppTurnPricing | null;
  conversationId: string | null;
  startedAt: Date;
  completedAt: Date | null;
  /** Her answer's own cost — the `reply` rows. */
  replyCostUsd: number;
  /** Everything else the turn caused: summary, tools, searches, embedding. */
  sideCostUsd: number;
  /** Every cost row, oldest first. `costRows` (inherited) is how many. */
  rows: TurnCostRow[];
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!isRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

/**
 * The cost rows one turn caused: those tagged with its id, and the embedding of
 * its reply, which the platform writes without the tag and joins by message id.
 *
 * Every attempt's rows are included — a failed first attempt was spent too.
 * Scoped to the turn's person: turn ids are unique per person, not globally.
 */
async function turnCostRows(
  turn: Pick<AppTurn, 'userId' | 'turnId' | 'assistantMessageId'>
): Promise<TurnCostRow[]> {
  const rows = await prisma.aiCostLog.findMany({
    where: {
      userId: turn.userId,
      OR: [
        { metadata: { path: ['turnId'], equals: turn.turnId } },
        ...(turn.assistantMessageId
          ? [
              {
                AND: [
                  { metadata: { path: ['kind'], equals: 'message_embedding' } },
                  { metadata: { path: ['messageId'], equals: turn.assistantMessageId } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      operation: true,
      model: true,
      provider: true,
      inputTokens: true,
      outputTokens: true,
      totalCostUsd: true,
      isLocal: true,
      metadata: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    part: classifyCostRow({ operation: row.operation, kind: metadataString(row.metadata, 'kind') }),
    operation: row.operation,
    model: row.model,
    provider: row.provider,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.totalCostUsd,
    unpriced: row.totalCostUsd === 0 && !row.isLocal && row.inputTokens + row.outputTokens > 0,
    createdAt: row.createdAt,
  }));
}

/**
 * One turn's full record: what produced it (model, provider, fingerprint
 * version, seat) from the turn row, and what it cost — reply and side costs —
 * from the cost log. Null when this person has no such turn.
 */
export async function getTurnMeter(userId: string, turnId: string): Promise<TurnMeter | null> {
  const turn = await prisma.appTurn.findUnique({
    where: { userId_turnId: { userId, turnId } },
  });
  if (!turn) return null;

  const rows = await turnCostRows(turn);
  const sum = (subset: TurnCostRow[]) => subset.reduce((total, row) => total + row.costUsd, 0);
  const costUsd = sum(rows);
  const replyCostUsd = sum(rows.filter((row) => row.part === 'reply'));

  return {
    turnId: turn.turnId,
    seat: turn.seat,
    agentSlug: turn.agentSlug,
    status: turn.status,
    attempts: turn.attempts,
    errorCode: turn.errorCode,
    fingerprintVersion: turn.fingerprintVersion,
    model: turn.modelId,
    provider: turn.providerSlug,
    pricing: turn.pricing,
    conversationId: turn.conversationId,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    costUsd,
    inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
    costRows: rows.length,
    unpricedRows: rows.filter((row) => row.unpriced).length,
    replyCostUsd,
    sideCostUsd: costUsd - replyCostUsd,
    rows,
  };
}

// ─── One conversation's turns ────────────────────────────────────────────────

/** One turn in a conversation, with what it cost — the row the drill-down opens. */
export interface ConversationTurnCost {
  turnId: string;
  /** The turn's person — the other half of the key the turn route needs. */
  userId: string;
  seat: string;
  status: AppTurnStatus;
  attempts: number;
  errorCode: string | null;
  model: string | null;
  startedAt: Date;
  completedAt: Date | null;
  costUsd: number;
  costRows: number;
  unpricedRows: number;
}

export interface ConversationTurns {
  conversationId: string;
  window: MeterWindow;
  /** Costliest first, so the turn that made it costly is the first row. */
  turns: ConversationTurnCost[];
  /** More turns started in the window than `limit`; the cheapest were left out. */
  truncated: boolean;
}

/**
 * The turns of one conversation that started in a window, each with its whole
 * cost — for an admin drilling from a costly conversation to the turn that made
 * it costly (f-budget t-97).
 *
 * **The same rows as {@link getTurnMeter}**, found the same way: tagged with the
 * turn's id, plus the embedding of its reply, and every attempt's. So a turn's
 * figure here is the figure its detail page shows. That is a turn's WHOLE cost,
 * not its cost inside the window, which is why a conversation whose turns
 * straddle the 1st can list a little more than its month's group.
 *
 * Two reads whatever the length: the turns (by the `conversationId` index), and
 * every cost row any of them caused. Sorted and cut here, after the sums.
 */
export async function getConversationTurns(query: {
  conversationId: string;
  window: MeterWindow;
  limit: number;
}): Promise<ConversationTurns> {
  const turns = await prisma.appTurn.findMany({
    where: {
      conversationId: query.conversationId,
      startedAt: { gte: query.window.from, lt: query.window.to },
    },
    select: {
      turnId: true,
      userId: true,
      seat: true,
      status: true,
      attempts: true,
      errorCode: true,
      modelId: true,
      startedAt: true,
      completedAt: true,
      assistantMessageId: true,
    },
  });
  if (turns.length === 0) {
    return {
      conversationId: query.conversationId,
      window: query.window,
      turns: [],
      truncated: false,
    };
  }

  const userIds = [...new Set(turns.map((turn) => turn.userId))];
  const messageIds = turns.flatMap((turn) =>
    turn.assistantMessageId ? [turn.assistantMessageId] : []
  );
  const rows = await prisma.aiCostLog.findMany({
    where: {
      userId: { in: userIds },
      OR: [
        ...turns.map((turn) => ({ metadata: { path: ['turnId'], equals: turn.turnId } })),
        ...messageIds.map((messageId) => ({
          AND: [
            { metadata: { path: ['kind'], equals: 'message_embedding' } },
            { metadata: { path: ['messageId'], equals: messageId } },
          ],
        })),
      ],
    },
    select: {
      userId: true,
      totalCostUsd: true,
      isLocal: true,
      inputTokens: true,
      outputTokens: true,
      metadata: true,
    },
  });

  // A row belongs to a turn by (person, turn id), or by its reply's message id.
  const turnKey = (userId: string | null, turnId: string) => `${userId ?? ''}\u0000${turnId}`;
  const byTurnKey = new Map(turns.map((turn) => [turnKey(turn.userId, turn.turnId), turn]));
  const byMessage = new Map(
    turns.flatMap((turn) => (turn.assistantMessageId ? [[turn.assistantMessageId, turn]] : []))
  );
  const sums = new Map(turns.map((turn) => [turn, { costUsd: 0, costRows: 0, unpricedRows: 0 }]));

  for (const row of rows) {
    const tagged = metadataString(row.metadata, 'turnId');
    const turn =
      (tagged ? byTurnKey.get(turnKey(row.userId, tagged)) : undefined) ??
      (metadataString(row.metadata, 'kind') === 'message_embedding'
        ? byMessage.get(metadataString(row.metadata, 'messageId') ?? '')
        : undefined);
    const sum = turn ? sums.get(turn) : undefined;
    if (!sum) continue;
    sum.costUsd += row.totalCostUsd;
    sum.costRows += 1;
    if (row.totalCostUsd === 0 && !row.isLocal && row.inputTokens + row.outputTokens > 0) {
      sum.unpricedRows += 1;
    }
  }

  const costed = turns
    .map((turn) => ({
      turnId: turn.turnId,
      userId: turn.userId,
      seat: turn.seat,
      status: turn.status,
      attempts: turn.attempts,
      errorCode: turn.errorCode,
      model: turn.modelId,
      startedAt: turn.startedAt,
      completedAt: turn.completedAt,
      ...(sums.get(turn) ?? { costUsd: 0, costRows: 0, unpricedRows: 0 }),
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.startedAt.getTime() - b.startedAt.getTime());

  return {
    conversationId: query.conversationId,
    window: query.window,
    turns: costed.slice(0, query.limit),
    truncated: costed.length > query.limit,
  };
}
