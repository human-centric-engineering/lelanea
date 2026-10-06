/**
 * The journey record: a person's session synopses and their own entries, in
 * one stream, newest first (f-journey-record t-145; product description §3.16).
 *
 * ## Ours, not Daybreak's event stream
 *
 * Owner ruling, 6 Oct 2026, at planning. Sessions live in Daybreak's
 * `framework_journey_event`, but that stream is insert-only by contract, and
 * this record is not: a draft is replaced, a kept entry is edited, and §12
 * says anything in it can be removed, which has to take the words with it. So
 * the record is `app_journey_entry`, and a synopsis points at its session's
 * `session.started` row. It is ledgered in `.context/app/divergences.md` (Row
 * 29), with daybreak#293 proposing the element it stands in for.
 *
 * **This module is the only code that reads or writes the table.**
 *
 * ## The record is the person's
 *
 * Every read and write here is keyed on the caller's own id, so another
 * person's entry id matches nothing and answers 404, the same as an id that
 * never existed.
 *
 * This file writes only **own** entries, and removes any entry. Drafting a
 * synopsis is t-146 and keeping one is t-147. A synopsis is never edited here,
 * because what keeping it does to the person's notes (owner rulings 2 and 3)
 * belongs to keeping, not to a text edit beside it.
 *
 * @see lib/app/journey-record/query.ts — search and filters
 * @see .context/app/journey-record.md
 */

import type { AppJourneyEntry } from '@prisma/client';

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { prisma } from '@/lib/db/client';
import { logger } from '@/lib/logging';
import { readSessionsById, type Session } from '@/lib/app/sessions/store';
import {
  journeyOutcomesSchema,
  type JourneyEntry,
  type JourneyOutcome,
} from '@/lib/app/journey-record/entry';
import {
  queryJourneyRecord,
  type JourneyRecordQuery,
  type JourneyRecordView,
} from '@/lib/app/journey-record/query';
import type { OwnEntryCreate, OwnEntryEdit } from '@/lib/app/journey-record/validation';

/**
 * The stored outcomes, read defensively. Only this feature writes them, so an
 * unreadable value is a bug. It costs that entry its outcomes and is logged,
 * rather than failing the person's whole record.
 */
function readOutcomes(row: AppJourneyEntry): JourneyOutcome[] {
  const parsed = journeyOutcomesSchema.safeParse(row.outcomes);
  if (parsed.success) return parsed.data;
  logger.error('Journey entry has unreadable outcomes', { entryId: row.id });
  return [];
}

function toEntry(row: AppJourneyEntry, session: Session | undefined): JourneyEntry {
  return {
    id: row.id,
    kind: row.kind,
    state: row.state,
    summary: row.summary,
    body: row.body,
    outcomes: readOutcomes(row),
    modules: row.modules,
    withheldFromAgent: row.withheldFromAgent,
    occurredAt: row.occurredAt.toISOString(),
    keptAt: row.keptAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    session: session
      ? {
          id: session.id,
          ordinal: session.ordinal,
          startedAt: session.startedAt.toISOString(),
          closedAt: session.closedAt?.toISOString() ?? null,
        }
      : null,
  };
}

/** Every entry of the person's, drafts included, each with its session's window. */
async function readEntries(userId: string): Promise<JourneyEntry[]> {
  const rows = await prisma.appJourneyEntry.findMany({
    where: { userId },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
  const sessionIds = rows.flatMap((row) => (row.sessionId ? [row.sessionId] : []));
  const sessions = await readSessionsById(userId, sessionIds);
  return rows.map((row) => toEntry(row, row.sessionId ? sessions.get(row.sessionId) : undefined));
}

/** The person's record, searched and filtered as they asked, with totals over all of it. */
export async function getJourneyRecord(
  userId: string,
  query: JourneyRecordQuery = {}
): Promise<JourneyRecordView> {
  return queryJourneyRecord(await readEntries(userId), query);
}

async function readOwnEntry(userId: string, id: string): Promise<JourneyEntry> {
  const row = await prisma.appJourneyEntry.findFirst({ where: { id, userId } });
  if (!row) throw new NotFoundError('Entry not found');
  return toEntry(row, undefined);
}

/** Write something into the record. It is kept the moment it is written: the person wrote it. */
export async function createOwnEntry(userId: string, entry: OwnEntryCreate): Promise<JourneyEntry> {
  const now = new Date();
  const row = await prisma.appJourneyEntry.create({
    data: {
      userId,
      kind: 'own',
      state: 'kept',
      summary: entry.summary ?? null,
      body: entry.body,
      withheldFromAgent: entry.withheldFromAgent ?? false,
      occurredAt: now,
      keptAt: now,
    },
  });
  return toEntry(row, undefined);
}

/**
 * Change one of the person's own entries: its words, its summary, or whether
 * she may read it.
 *
 * One conditional update, so there is no window between checking the entry is
 * an own entry and writing it. Only when nothing matched does a second read
 * tell "not yours, or gone" (404) from "a synopsis" (409).
 */
export async function editOwnEntry(
  userId: string,
  id: string,
  edit: OwnEntryEdit
): Promise<JourneyEntry> {
  const { count } = await prisma.appJourneyEntry.updateMany({
    where: { id, userId, kind: 'own' },
    data: {
      ...(edit.summary !== undefined ? { summary: edit.summary } : {}),
      ...(edit.body !== undefined ? { body: edit.body } : {}),
      ...(edit.withheldFromAgent !== undefined
        ? { withheldFromAgent: edit.withheldFromAgent }
        : {}),
    },
  });
  if (count === 0) {
    const existing = await prisma.appJourneyEntry.findFirst({
      where: { id, userId },
      select: { kind: true },
    });
    if (!existing) throw new NotFoundError('Entry not found');
    throw new ConflictError('A session synopsis is changed by keeping it, not by editing it here');
  }
  return readOwnEntry(userId, id);
}

/**
 * Remove an entry from the record, whatever it is: an own entry, a kept
 * synopsis, or a draft the person does not want. The row goes, words and all
 * (§12). Removing a synopsis does not redraft it: a session is drafted once,
 * when it closes.
 */
export async function removeJourneyEntry(
  userId: string,
  id: string
): Promise<{ id: string; kind: JourneyEntry['kind'] }> {
  const existing = await prisma.appJourneyEntry.findFirst({
    where: { id, userId },
    select: { kind: true },
  });
  if (!existing) throw new NotFoundError('Entry not found');
  // Keyed on the owner again, so the delete can only ever take this person's row.
  const { count } = await prisma.appJourneyEntry.deleteMany({ where: { id, userId } });
  if (count === 0) throw new NotFoundError('Entry not found');
  return { id, kind: existing.kind };
}

const OUTCOME_HEADINGS = { action: 'Actions', insight: 'Insights', tension: 'Tensions' } as const;

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function entryToMarkdown(entry: JourneyEntry): string {
  const kindLabel = entry.kind === 'synopsis' ? 'Session' : 'Your entry';
  const title = entry.summary ? `${kindLabel}: ${entry.summary}` : kindLabel;
  const lines = [`## ${title}`, '', `_${formatDay(entry.occurredAt)}_`, '', entry.body.trim()];
  for (const kind of ['action', 'insight', 'tension'] as const) {
    const outcomes = entry.outcomes.filter((outcome) => outcome.kind === kind);
    if (outcomes.length === 0) continue;
    lines.push('', `**${OUTCOME_HEADINGS[kind]}**`, '');
    for (const outcome of outcomes) lines.push(`- ${outcome.text}`);
  }
  if (entry.modules.length > 0) lines.push('', `Modules: ${entry.modules.join(', ')}`);
  return lines.join('\n');
}

/**
 * The person's kept record as a Markdown document, oldest first so it reads
 * as an account rather than a feed. Drafts are left out: they are not in the
 * record until the person keeps them. Entries kept from her are included,
 * because this copy is the person's own.
 */
export async function exportJourneyRecordMarkdown(
  userId: string
): Promise<{ markdown: string; entries: number }> {
  const kept = (await readEntries(userId)).filter((entry) => entry.state === 'kept').reverse();
  const header = [
    '# Your journey',
    '',
    'Everything you have kept in your journey record with Lelañea.',
  ];
  if (kept.length === 0) header.push('', 'Nothing has been kept yet.');
  const markdown = [header.join('\n'), ...kept.map(entryToMarkdown)].join('\n\n') + '\n';
  return { markdown, entries: kept.length };
}

/** Subject access (Art. 15): every row, drafts included, because we hold them. */
export function findJourneyEntriesForSubject(subject: {
  userId: string;
}): Promise<AppJourneyEntry[]> {
  return prisma.appJourneyEntry.findMany({
    where: { userId: subject.userId },
    orderBy: { occurredAt: 'asc' },
  });
}

/**
 * An org's export: every member's record. Strictly by org, as the memory index
 * reads: the table was born after t-115, so no row lacks one.
 */
export function listJourneyEntriesForOrg(orgId: string): Promise<AppJourneyEntry[]> {
  return prisma.appJourneyEntry.findMany({ where: { orgId }, orderBy: { occurredAt: 'asc' } });
}
