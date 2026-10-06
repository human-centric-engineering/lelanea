/**
 * What a closed session gives its synopsis: what was said, which modules it
 * touched, and which visible notes it wrote (f-journey-record t-146).
 *
 * **Every read names the person.** A turn is read by `userId`, a message only
 * through a conversation that is theirs, an event and a note by `userId`. So
 * another person's words cannot reach the prompt even through a session id that
 * collided, and the two-user test proves it.
 *
 * **Both seats.** A sitting is the person's, not the seat's (`sessions/store.ts`):
 * onboarding and the facilitator share it, so the account covers both.
 *
 * **Derived, never guessed.** The modules come from the session's own window in
 * the event stream and the notes from what its turns wrote. The model is never
 * asked for either.
 *
 * @see lib/app/journey-record/synopsis/draft.ts — the caller
 */

import { prisma } from '@/lib/db/client';
import { ENGAGEMENT_EVENT_TYPE } from '@/lib/framework/engagement/vocabulary';
import { JOURNEY_EVENT_TYPE } from '@/lib/framework/facilitation/journey/vocabulary';
import { SLOT_SENSITIVITY } from '@/lib/framework/data-slots';
import { getNotes } from '@/lib/app/slots/notes';
import type { Session } from '@/lib/app/sessions/store';
import type { JourneyNoteRef } from '@/lib/app/journey-record/entry';

/**
 * A session is "of substance" when the person had at least this many
 * exchanges in it: a message of theirs she answered. Fewer is a look-in, and
 * an account of one would be padding. Openings and recaps are hers, not an
 * exchange, so they never count.
 */
export const MIN_SYNOPSIS_EXCHANGES = 3;

/** How much of the conversation the prompt carries: each message cut, within a total. */
export const MAX_SYNOPSIS_MESSAGE_CHARS = 2_000;
export const MAX_SYNOPSIS_TRANSCRIPT_CHARS = 24_000;

/** The event types that say a module was touched. Never the session rows. */
const MODULE_EVENT_TYPES: readonly string[] = [
  JOURNEY_EVENT_TYPE.nodeEntered,
  JOURNEY_EVENT_TYPE.nodeCompleted,
  ENGAGEMENT_EVENT_TYPE.moduleEntered,
  ENGAGEMENT_EVENT_TYPE.moduleFeedback,
  ENGAGEMENT_EVENT_TYPE.moduleCompleted,
];

/** One message of the session, as the prompt quotes it. */
export interface SessionLine {
  role: 'user' | 'assistant';
  content: string;
}

export interface SynopsisMaterial {
  /** How many exchanges the session held: the threshold is read on this. */
  exchanges: number;
  /** The conversation, oldest first, within {@link MAX_SYNOPSIS_TRANSCRIPT_CHARS}. */
  lines: SessionLine[];
  /** Module slugs touched in the window, in the order first touched. */
  modules: string[];
  /** The visible notes the session's turns wrote. */
  notes: JourneyNoteRef[];
}

interface ExchangeTurn {
  id: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
}

/**
 * The session's exchanges: completed turns of the person's, stamped with it,
 * that answered a message of theirs. A retried turn is one row, so each thing
 * they said is counted once.
 */
function readExchangeTurns(userId: string, sessionId: string): Promise<ExchangeTurn[]> {
  return prisma.appTurn.findMany({
    where: { userId, sessionId, status: 'completed', userMessageId: { not: null } },
    orderBy: { startedAt: 'asc' },
    select: { id: true, userMessageId: true, assistantMessageId: true },
  });
}

/** At most `max` characters, said to be cut where it was. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()} …`;
}

/**
 * Both sides of each exchange, oldest first, read only through a conversation
 * of the person's. When the whole will not fit, the latest that fit are kept:
 * where a session ended up is what its account most needs.
 */
async function readLines(userId: string, turns: ExchangeTurn[]): Promise<SessionLine[]> {
  const ids = turns.flatMap((turn) =>
    [turn.userMessageId, turn.assistantMessageId].filter((id): id is string => id !== null)
  );
  if (ids.length === 0) return [];
  const rows = await prisma.aiMessage.findMany({
    where: { id: { in: ids }, role: { in: ['user', 'assistant'] }, conversation: { userId } },
    orderBy: { createdAt: 'desc' },
    select: { role: true, content: true },
  });
  const lines: SessionLine[] = [];
  let total = 0;
  for (const row of rows) {
    const content = cut(row.content.trim(), MAX_SYNOPSIS_MESSAGE_CHARS);
    if (content === '') continue;
    if (total + content.length > MAX_SYNOPSIS_TRANSCRIPT_CHARS) break;
    total += content.length;
    lines.push({ role: row.role === 'user' ? 'user' : 'assistant', content });
  }
  return lines.reverse();
}

/** The modules the session's window touched, from the event stream. */
async function readModules(userId: string, session: Session, closedAt: Date): Promise<string[]> {
  const events = await prisma.journeyEvent.findMany({
    where: {
      userId,
      type: { in: [...MODULE_EVENT_TYPES] },
      occurredAt: { gte: session.startedAt, lte: closedAt },
    },
    orderBy: { occurredAt: 'asc' },
    select: { moduleSlug: true },
  });
  const seen = new Set<string>();
  for (const event of events) if (event.moduleSlug) seen.add(event.moduleSlug);
  return [...seen];
}

/**
 * The notes the session's turns wrote that the person can see and confirm.
 *
 * Starts from what the turns wrote (`app_turn_slot_write`), then keeps only a
 * slug the notes panel shows (`getNotes` has already withheld hidden slots and
 * voice leanings) that is neither removed, nor withheld as special category,
 * nor in a special-category slot today. Each is listed at the latest version
 * the session wrote.
 */
async function readNoteRefs(userId: string, turnIds: string[]): Promise<JourneyNoteRef[]> {
  if (turnIds.length === 0) return [];
  const writes = await prisma.appTurnSlotWrite.findMany({
    where: { turnId: { in: turnIds }, turn: { userId } },
    orderBy: { writtenAt: 'asc' },
    select: { slotSlug: true, version: true },
  });
  if (writes.length === 0) return [];

  const { notes } = await getNotes(userId);
  const listable = new Set(
    notes
      .filter(
        (note) =>
          !note.removed && !note.withheld && note.sensitivity !== SLOT_SENSITIVITY.special_category
      )
      .map((note) => note.slotSlug)
  );

  const latest = new Map<string, number>();
  for (const write of writes) {
    if (!listable.has(write.slotSlug)) continue;
    latest.set(write.slotSlug, Math.max(latest.get(write.slotSlug) ?? 0, write.version));
  }
  return [...latest].map(([slotSlug, version]) => ({ slotSlug, version }));
}

/** How many exchanges a session held. Asked first, alone: most short sessions stop here. */
export async function countExchanges(userId: string, sessionId: string): Promise<number> {
  return prisma.appTurn.count({
    where: { userId, sessionId, status: 'completed', userMessageId: { not: null } },
  });
}

/** Everything a closed session gives its synopsis. */
export async function readSynopsisMaterial(
  userId: string,
  session: Session,
  closedAt: Date
): Promise<SynopsisMaterial> {
  const turns = await readExchangeTurns(userId, session.id);
  const [lines, modules, notes] = await Promise.all([
    readLines(userId, turns),
    readModules(userId, session, closedAt),
    // Every turn of the session, not only its exchanges: a note can be written on any.
    prisma.appTurn
      .findMany({ where: { userId, sessionId: session.id }, select: { id: true } })
      .then((rows) =>
        readNoteRefs(
          userId,
          rows.map((row) => row.id)
        )
      ),
  ]);
  return { exchanges: turns.length, lines, modules, notes };
}
