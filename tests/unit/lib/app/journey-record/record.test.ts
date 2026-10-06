/**
 * The journey record's store (f-journey-record t-145).
 *
 * Runs the real `record.ts`, and the real `readSessionsById` behind it,
 * against a small STATEFUL in-memory fake of the two tables they touch. Two
 * people's rows sit in the same fake throughout, so a read or write that lost
 * its owner key would reach the other person's row rather than find nothing.
 * Every "not theirs" case first establishes that the other person's row exists
 * (`fp6`).
 *
 * @see lib/app/journey-record/record.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

interface EntryRow {
  id: string;
  userId: string;
  kind: 'synopsis' | 'own';
  state: 'draft' | 'kept';
  sessionId: string | null;
  summary: string | null;
  body: string;
  outcomes: unknown;
  modules: string[];
  withheldFromAgent: boolean;
  occurredAt: Date;
  keptAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  orgId: string | null;
}
interface EventRow {
  id: string;
  userId: string;
  type: string;
  payload: unknown;
  occurredAt: Date;
}

const db = vi.hoisted(() => ({ entries: [] as EntryRow[], events: [] as EventRow[], seq: 0 }));

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db/client', () => {
  type Where = Record<string, unknown>;
  const matches = <T extends object>(row: T, where: Where): boolean =>
    Object.entries(where).every(([key, value]) => {
      const field = row[key as keyof T];
      if (value && typeof value === 'object' && 'in' in value) {
        return (value as { in: unknown[] }).in.includes(field);
      }
      return field === value;
    });
  const pick = <T extends object>(row: T, select?: Record<string, boolean>) =>
    select
      ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key as keyof T]]))
      : { ...row };

  return {
    prisma: {
      appJourneyEntry: {
        findMany: vi.fn(async ({ where }: { where: Where }) =>
          db.entries
            .filter((row) => matches(row, where))
            .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
            .map((row) => ({ ...row }))
        ),
        findFirst: vi.fn(
          async ({ where, select }: { where: Where; select?: Record<string, boolean> }) => {
            const row = db.entries.find((r) => matches(r, where));
            return row ? pick(row, select) : null;
          }
        ),
        create: vi.fn(async ({ data }: { data: Partial<EntryRow> }) => {
          const now = new Date();
          const row: EntryRow = {
            id: `cmentry${String(++db.seq).padStart(18, '0')}`,
            sessionId: null,
            summary: null,
            outcomes: [],
            modules: [],
            withheldFromAgent: false,
            keptAt: null,
            createdAt: now,
            updatedAt: now,
            orgId: 'install',
            ...(data as Omit<EntryRow, 'id'>),
          };
          db.entries.push(row);
          return { ...row };
        }),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: Partial<EntryRow> }) => {
          const rows = db.entries.filter((row) => matches(row, where));
          for (const row of rows) Object.assign(row, data, { updatedAt: new Date() });
          return { count: rows.length };
        }),
        deleteMany: vi.fn(async ({ where }: { where: Where }) => {
          const before = db.entries.length;
          db.entries = db.entries.filter((row) => !matches(row, where));
          return { count: before - db.entries.length };
        }),
      },
      journeyEvent: {
        findMany: vi.fn(
          async ({ where, select }: { where: Where; select?: Record<string, boolean> }) =>
            db.events.filter((row) => matches(row, where)).map((row) => pick(row, select))
        ),
      },
    },
  };
});

import { ConflictError, NotFoundError } from '@/lib/api/errors';
import {
  createOwnEntry,
  editOwnEntry,
  exportJourneyRecordMarkdown,
  findJourneyEntriesForSubject,
  getJourneyRecord,
  removeJourneyEntry,
} from '@/lib/app/journey-record/record';
import { sessionEventId } from '@/lib/app/sessions/store';

const ME = 'cmjbv4i3x00003wsloputgwul';
const THEM = 'cmu7other0000000000000000';

function row(overrides: Partial<EntryRow> & Pick<EntryRow, 'id' | 'userId'>): EntryRow {
  const at = overrides.occurredAt ?? new Date('2026-10-01T09:00:00Z');
  return {
    kind: 'own',
    state: 'kept',
    sessionId: null,
    summary: null,
    body: 'Words.',
    outcomes: [],
    modules: [],
    withheldFromAgent: false,
    occurredAt: at,
    keptAt: at,
    createdAt: at,
    updatedAt: at,
    orgId: 'install',
    ...overrides,
  };
}

/** A session of `userId`'s, as `store.ts` writes it: started, and closed when `closedAt` is given. */
async function session(userId: string, ordinal: number, startedAt: Date, closedAt?: Date) {
  const id = await sessionEventId(userId, ordinal, 'started');
  db.events.push({
    id,
    userId,
    type: 'session.started',
    payload: { ordinal },
    occurredAt: startedAt,
  });
  if (closedAt) {
    db.events.push({
      id: await sessionEventId(userId, ordinal, 'closed'),
      userId,
      type: 'session.closed',
      payload: { sessionId: id, ordinal },
      occurredAt: closedAt,
    });
  }
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  db.entries = [];
  db.events = [];
  db.seq = 0;
});

describe('getJourneyRecord', () => {
  it('returns only the caller’s own entries', async () => {
    db.entries.push(
      row({ id: 'cmmine00000000000000000000', userId: ME, body: 'mine' }),
      row({ id: 'cmtheirs000000000000000000', userId: THEM, body: 'theirs' })
    );

    const view = await getJourneyRecord(ME);

    expect(view.entries.map((e) => e.body)).toEqual(['mine']);
    // The other person's record is there to be found, and was not.
    expect((await getJourneyRecord(THEM)).entries.map((e) => e.body)).toEqual(['theirs']);
  });

  it('gives each synopsis its session’s window', async () => {
    const started = new Date('2026-10-01T09:00:00Z');
    const closed = new Date('2026-10-01T10:30:00Z');
    const sessionId = await session(ME, 3, started, closed);
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId,
        summary: 'Boundaries',
        occurredAt: started,
        outcomes: [{ kind: 'action', text: 'Say no on Thursday' }],
        modules: ['boundaries'],
      })
    );

    const [entry] = (await getJourneyRecord(ME)).entries;

    expect(entry.session).toEqual({
      id: sessionId,
      ordinal: 3,
      startedAt: started.toISOString(),
      closedAt: closed.toISOString(),
    });
    expect(entry.outcomes).toEqual([{ kind: 'action', text: 'Say no on Thursday' }]);
  });

  it('never resolves a session that is not the caller’s', async () => {
    // Their session exists in the stream; a row of mine naming it must not reach it.
    const theirSession = await session(THEM, 1, new Date('2026-10-01T09:00:00Z'));
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: theirSession,
        summary: 'x',
      })
    );

    const [entry] = (await getJourneyRecord(ME)).entries;

    expect(entry.session).toBeNull();
  });

  it('costs an entry with unreadable outcomes only its outcomes, and says so', async () => {
    db.entries.push(
      row({ id: 'cmbad000000000000000000000', userId: ME, outcomes: [{ kind: 'decision' }] })
    );

    const [entry] = (await getJourneyRecord(ME)).entries;

    expect(entry.outcomes).toEqual([]);
    expect(entry.body).toBe('Words.');
    expect(error).toHaveBeenCalledWith('Journey entry has unreadable outcomes', {
      entryId: 'cmbad000000000000000000000',
    });
  });
});

describe('createOwnEntry', () => {
  it('keeps what the person wrote at once, under their id', async () => {
    const entry = await createOwnEntry(ME, { body: 'Woke at three.', withheldFromAgent: true });

    expect(entry).toMatchObject({
      kind: 'own',
      state: 'kept',
      body: 'Woke at three.',
      summary: null,
      withheldFromAgent: true,
      session: null,
    });
    expect(entry.keptAt).toBe(entry.occurredAt);
    expect(db.entries).toHaveLength(1);
    expect(db.entries[0].userId).toBe(ME);
  });
});

describe('editOwnEntry', () => {
  beforeEach(() => {
    db.entries.push(
      row({ id: 'cmmine00000000000000000000', userId: ME, body: 'mine' }),
      row({ id: 'cmtheirs000000000000000000', userId: THEM, body: 'theirs' }),
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_x',
        summary: 'A session',
        body: 'her account',
      })
    );
  });

  it('changes the words and whether she may read it', async () => {
    const entry = await editOwnEntry(ME, 'cmmine00000000000000000000', {
      body: 'mine, rewritten',
      withheldFromAgent: true,
    });

    expect(entry).toMatchObject({ body: 'mine, rewritten', withheldFromAgent: true });
    expect(db.entries.find((r) => r.id === 'cmmine00000000000000000000')?.body).toBe(
      'mine, rewritten'
    );
  });

  it('answers another person’s entry as not found, and leaves it alone', async () => {
    await expect(
      editOwnEntry(ME, 'cmtheirs000000000000000000', { body: 'overwritten' })
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(db.entries.find((r) => r.id === 'cmtheirs000000000000000000')?.body).toBe('theirs');
  });

  it('refuses a synopsis: it is changed by keeping it', async () => {
    await expect(
      editOwnEntry(ME, 'cmsyn000000000000000000000', { withheldFromAgent: true })
    ).rejects.toBeInstanceOf(ConflictError);

    expect(db.entries.find((r) => r.id === 'cmsyn000000000000000000000')).toMatchObject({
      body: 'her account',
      withheldFromAgent: false,
    });
  });
});

describe('removeJourneyEntry', () => {
  beforeEach(() => {
    db.entries.push(
      row({ id: 'cmmine00000000000000000000', userId: ME }),
      row({ id: 'cmtheirs000000000000000000', userId: THEM }),
      row({
        id: 'cmdraft00000000000000000000',
        userId: ME,
        kind: 'synopsis',
        state: 'draft',
        keptAt: null,
        sessionId: 'ses_x',
        summary: 'Not kept',
      })
    );
  });

  it('removes the row, words and all, whatever kind it is', async () => {
    expect(await removeJourneyEntry(ME, 'cmmine00000000000000000000')).toEqual({
      id: 'cmmine00000000000000000000',
      kind: 'own',
    });
    expect(await removeJourneyEntry(ME, 'cmdraft00000000000000000000')).toMatchObject({
      kind: 'synopsis',
    });

    expect(db.entries.map((r) => r.id)).toEqual(['cmtheirs000000000000000000']);
  });

  it('answers another person’s entry as not found, and leaves it alone', async () => {
    await expect(removeJourneyEntry(ME, 'cmtheirs000000000000000000')).rejects.toBeInstanceOf(
      NotFoundError
    );

    expect(db.entries.some((r) => r.id === 'cmtheirs000000000000000000')).toBe(true);
  });
});

describe('exportJourneyRecordMarkdown', () => {
  it('writes the kept record oldest first, without drafts, with what she may not read', async () => {
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_x',
        summary: 'Where the standard came from',
        body: 'Her account.',
        occurredAt: new Date('2026-09-20T09:00:00Z'),
        outcomes: [
          { kind: 'insight', text: 'It was never mine' },
          { kind: 'tension', text: 'Rest against idleness' },
        ],
        modules: ['values'],
      }),
      row({
        id: 'cmown000000000000000000000',
        userId: ME,
        body: 'Private thought.',
        withheldFromAgent: true,
        occurredAt: new Date('2026-09-25T03:00:00Z'),
      }),
      row({
        id: 'cmdraft00000000000000000000',
        userId: ME,
        kind: 'synopsis',
        state: 'draft',
        keptAt: null,
        sessionId: 'ses_y',
        summary: 'Not kept yet',
        occurredAt: new Date('2026-10-05T09:00:00Z'),
      }),
      row({ id: 'cmtheirs000000000000000000', userId: THEM, body: 'Their words.' })
    );

    const { markdown, entries } = await exportJourneyRecordMarkdown(ME);

    expect(entries).toBe(2);
    expect(markdown.indexOf('Where the standard came from')).toBeLessThan(
      markdown.indexOf('Private thought.')
    );
    expect(markdown).toContain('**Insights**\n\n- It was never mine');
    expect(markdown).toContain('**Tensions**\n\n- Rest against idleness');
    expect(markdown).toContain('Modules: values');
    expect(markdown).not.toContain('Not kept yet');
    expect(markdown).not.toContain('Their words.');
  });

  it('says so when nothing has been kept', async () => {
    db.entries.push(row({ id: 'cmtheirs000000000000000000', userId: THEM }));

    const { markdown, entries } = await exportJourneyRecordMarkdown(ME);

    expect(entries).toBe(0);
    expect(markdown).toContain('Nothing has been kept yet.');
  });
});

describe('findJourneyEntriesForSubject', () => {
  it('returns every row of the subject’s, drafts included, and no one else’s', async () => {
    db.entries.push(
      row({ id: 'cmmine00000000000000000000', userId: ME }),
      row({
        id: 'cmdraft00000000000000000000',
        userId: ME,
        kind: 'synopsis',
        state: 'draft',
        keptAt: null,
        sessionId: 'ses_x',
        summary: 'Draft',
      }),
      row({ id: 'cmtheirs000000000000000000', userId: THEM })
    );

    const rows = await findJourneyEntriesForSubject({ userId: ME });

    expect(rows.map((r) => r.id).sort()).toEqual([
      'cmdraft00000000000000000000',
      'cmmine00000000000000000000',
    ]);
  });
});
