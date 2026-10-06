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

/**
 * A session that has closed. `closedAt` is its last activity (its last turn);
 * `nextStartedAt` is when the arrival that closed it began the next one. The
 * time between belongs to this sitting, though no turn was taken in it: a
 * module opened after the last exchange was opened in this session.
 */
export type ClosedSession = Session & { closedAt: Date; nextStartedAt: Date };

/** One message of the session, as the prompt quotes it. */
export interface SessionLine {
  role: 'user' | 'assistant';
  content: string;
}

export interface SynopsisMaterial {
  /**
   * The exchanges whose words can still be read: what the threshold is held
   * to. A turn row outlives its messages when a conversation is deleted.
   */
  readable: number;
  /** The conversation, oldest first, whole exchanges within {@link MAX_SYNOPSIS_TRANSCRIPT_CHARS}. */
  lines: SessionLine[];
  /** Module slugs touched in the window, in the order first touched. */
  modules: string[];
  /** The visible notes the session wrote. */
  notes: JourneyNoteRef[];
}

/** A turn of the session's, as far as drafting needs it. */
export interface SessionTurn {
  id: string;
  status: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
}

/**
 * Every turn of the person's stamped with the session, oldest first: one read
 * that answers the threshold, the exchanges and the notes' turns.
 */
export function readSessionTurns(userId: string, sessionId: string): Promise<SessionTurn[]> {
  return prisma.appTurn.findMany({
    where: { userId, sessionId },
    orderBy: { startedAt: 'asc' },
    select: { id: true, status: true, userMessageId: true, assistantMessageId: true },
  });
}

/**
 * The session's exchanges: completed turns that answered a message of theirs.
 * A retried turn is one row, so each thing they said is counted once.
 */
export function exchangesOf(turns: readonly SessionTurn[]): SessionTurn[] {
  return turns.filter((turn) => turn.status === 'completed' && turn.userMessageId !== null);
}

/** At most `max` characters, said to be cut where it was. */
function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()} …`;
}

/**
 * Both sides of each exchange, oldest first, read only through a conversation
 * of the person's. Kept or dropped a whole exchange at a time, so a reply never
 * stands without what it answered; when the session will not fit, the latest
 * exchanges that fit are kept, since where a session ended up is what its
 * account most needs. Ordered by the turns, not by the messages' timestamps,
 * which a message and its reply can share.
 */
async function readLines(
  userId: string,
  exchanges: readonly SessionTurn[]
): Promise<{ readable: number; lines: SessionLine[] }> {
  const ids = exchanges.flatMap((turn) =>
    [turn.userMessageId, turn.assistantMessageId].filter((id): id is string => id !== null)
  );
  if (ids.length === 0) return { readable: 0, lines: [] };
  const rows = await prisma.aiMessage.findMany({
    where: { id: { in: ids }, role: { in: ['user', 'assistant'] }, conversation: { userId } },
    select: { id: true, role: true, content: true },
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const line = (id: string | null, role: SessionLine['role']): SessionLine[] => {
    const row = id ? byId.get(id) : undefined;
    if (!row || row.role !== role) return [];
    const content = cut(row.content.trim(), MAX_SYNOPSIS_MESSAGE_CHARS);
    return content === '' ? [] : [{ role, content }];
  };

  // A message of theirs that is gone or empty leaves its reply answering
  // nothing the model can see, so the exchange goes whole.
  const readable = exchanges
    .map((turn) => ({ turn, said: line(turn.userMessageId, 'user') }))
    .filter(({ said }) => said.length > 0);

  const kept: SessionLine[][] = [];
  let total = 0;
  for (const { turn, said } of [...readable].reverse()) {
    const pair = [...said, ...line(turn.assistantMessageId, 'assistant')];
    const size = pair.reduce((sum, entry) => sum + entry.content.length, 0);
    if (total + size > MAX_SYNOPSIS_TRANSCRIPT_CHARS) break;
    total += size;
    kept.push(pair);
  }
  return { readable: readable.length, lines: kept.reverse().flat() };
}

/** The modules touched from the session's start until the next one began, from the event stream. */
async function readModules(userId: string, session: ClosedSession): Promise<string[]> {
  const events = await prisma.journeyEvent.findMany({
    where: {
      userId,
      type: { in: [...MODULE_EVENT_TYPES] },
      occurredAt: { gte: session.startedAt, lt: session.nextStartedAt },
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
 * the session wrote. `getNotes` reads all of the person's notes to decide
 * visibility the one way the panel does, rather than a second copy of its rule.
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

/**
 * Only the conversation, for another draft of a session already drafted
 * (t-147): its modules and notes were derived once, and do not change because
 * the person asked for different words.
 */
export function readSessionLines(
  userId: string,
  turns: readonly SessionTurn[]
): Promise<{ readable: number; lines: SessionLine[] }> {
  return readLines(userId, exchangesOf(turns));
}

/** Everything a closed session gives its synopsis, from the turns already read. */
export async function readSynopsisMaterial(
  userId: string,
  session: ClosedSession,
  turns: readonly SessionTurn[]
): Promise<SynopsisMaterial> {
  const [{ readable, lines }, modules, notes] = await Promise.all([
    readSessionLines(userId, turns),
    readModules(userId, session),
    // Every turn of the session, not only its exchanges: a note can be written on any.
    readNoteRefs(
      userId,
      turns.map((turn) => turn.id)
    ),
  ]);
  return { readable, lines, modules, notes };
}
