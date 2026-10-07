/**
 * The journey record's store (f-journey-record t-145).
 *
 * Runs the real `record.ts`, and the real `readSessionsById` behind it,
 * against a small STATEFUL in-memory fake of the tables they touch. Two
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
  notes: unknown;
  withheldFromAgent: boolean;
  occurredAt: Date;
  keptAt: Date | null;
  regenerations: number;
  sourceRemovedAt: Date | null;
  notesPending: 'confirm' | 'reread' | null;
  workingSince: Date | null;
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

const db = vi.hoisted(() => ({
  entries: [] as EntryRow[],
  events: [] as EventRow[],
  /** User id → `User.timezone`. */
  zones: new Map<string, string | null>(),
  seq: 0,
}));

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/lib/logging', () => ({
  logger: { error, warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

/**
 * `readListedNotes` reads through `getNotes` rather than the raw table, so a
 * note the panel no longer shows (hidden, or removed since) follows the same
 * rule here — mocked rather than run for real, because what that rule IS is
 * `tests/unit/lib/app/slots/notes.test.ts`'s job, not this file's.
 */
const { getNotes } = vi.hoisted(() => ({ getNotes: vi.fn() }));
vi.mock('@/lib/app/slots/notes', () => ({ getNotes }));

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
          const defaults = {
            sessionId: null,
            summary: null,
            outcomes: [],
            modules: [],
            notes: [],
            withheldFromAgent: false,
            keptAt: null,
            regenerations: 0,
            sourceRemovedAt: null,
            notesPending: null,
            workingSince: null,
            createdAt: now,
            updatedAt: now,
            orgId: 'install',
          };
          const row = {
            ...defaults,
            ...data,
            id: `cmentry${String(++db.seq).padStart(18, '0')}`,
          } as EntryRow;
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
      user: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          db.zones.has(where.id) ? { timezone: db.zones.get(where.id) ?? null } : null
        ),
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
  readOwnSynopsis,
  removeJourneyEntry,
  replaceSynopsisDraft,
} from '@/lib/app/journey-record/record';
import { sessionEventId } from '@/lib/app/sessions/store';
import type { Note } from '@/lib/app/slots/notes-view';

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
    notes: [],
    withheldFromAgent: false,
    occurredAt: at,
    keptAt: at,
    regenerations: 0,
    sourceRemovedAt: null,
    notesPending: null,
    workingSince: null,
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
  db.zones.clear();
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

  it('costs a synopsis whose session row is unreadable only its window, not the whole record', async () => {
    const readable = await session(ME, 2, new Date('2026-10-02T09:00:00Z'));
    db.events.push({
      id: 'ses_corrupt',
      userId: ME,
      type: 'session.started',
      payload: { ordinal: 'not a number' },
      occurredAt: new Date('2026-10-01T09:00:00Z'),
    });
    db.entries.push(
      row({
        id: 'cmgood00000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: readable,
        summary: 'Readable',
        occurredAt: new Date('2026-10-02T09:00:00Z'),
      }),
      row({
        id: 'cmbad000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_corrupt',
        summary: 'Corrupt session',
        occurredAt: new Date('2026-10-01T09:00:00Z'),
      })
    );

    const { entries } = await getJourneyRecord(ME);

    expect(entries.map((e) => [e.summary, e.session?.ordinal ?? null])).toEqual([
      ['Readable', 2],
      ['Corrupt session', null],
    ]);
    expect(error).toHaveBeenCalledWith('Session row has no readable ordinal', {
      sessionId: 'ses_corrupt',
    });
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

/**
 * `getJourneyRecord` enrichment: the notes its entries list, read as the notes
 * panel holds them now (t-148). `getNotes` is mocked here; what it decides to
 * withhold or drop is proven in `tests/unit/lib/app/slots/notes.test.ts` — this
 * file only proves `readListedNotes` follows what it is told.
 */
describe('getJourneyRecord’s notes enrichment', () => {
  function note(overrides: Partial<Note> = {}): Note {
    return {
      slotSlug: 'life_work',
      asking: 'How work stands.',
      value: 'Work is going badly.',
      withheld: false,
      removed: false,
      confidence: 6,
      sourceType: 'inferred',
      reasoningNote: 'Said in passing.',
      version: 1,
      capturedAt: '2026-10-01T09:00:00.000Z',
      conversationId: 'c1',
      sensitivity: 'standard',
      retired: false,
      correctable: true,
      removable: true,
      exchanges: [],
      previous: null,
      group: 'life_areas',
      ...overrides,
    };
  }

  it('never calls getNotes when no entry lists a note', async () => {
    db.entries.push(row({ id: 'cmmine00000000000000000000', userId: ME, notes: [] }));

    const { notes } = await getJourneyRecord(ME);

    expect(notes).toEqual([]);
    expect(getNotes).not.toHaveBeenCalled();
  });

  it('reads once, with the listed notes mapped to what the panel holds now', async () => {
    getNotes.mockResolvedValue({
      notes: [note(), note({ slotSlug: 'life_money', value: 'Tight this month.', version: 3 })],
    });
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_x',
        notes: [{ slotSlug: 'life_work', version: 1 }],
      })
    );

    const { notes } = await getJourneyRecord(ME);

    expect(getNotes).toHaveBeenCalledTimes(1);
    expect(getNotes).toHaveBeenCalledWith(ME);
    // Only the note the entry actually listed, not every note the panel holds.
    expect(notes).toEqual([
      {
        slotSlug: 'life_work',
        label: 'life work',
        reading: 'Work is going badly.',
        version: 1,
        confirmable: true,
      },
    ]);
  });

  it('omits a listed note the panel no longer shows at all (hidden, or gone)', async () => {
    getNotes.mockResolvedValue({ notes: [] });
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_x',
        notes: [{ slotSlug: 'life_work', version: 1 }],
      })
    );

    const { notes } = await getJourneyRecord(ME);

    expect(notes).toEqual([]);
  });

  it('omits a listed note the person has since removed, rather than showing it blank', async () => {
    getNotes.mockResolvedValue({ notes: [note({ removed: true })] });
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_x',
        notes: [{ slotSlug: 'life_work', version: 1 }],
      })
    );

    const { notes } = await getJourneyRecord(ME);

    expect(notes).toEqual([]);
  });

  it('gives a withheld note a null reading, never the sentinel value', async () => {
    getNotes.mockResolvedValue({
      notes: [note({ withheld: true, value: '<redacted: special_category>' })],
    });
    db.entries.push(
      row({
        id: 'cmsyn000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_x',
        notes: [{ slotSlug: 'life_work', version: 1 }],
      })
    );

    const [listed] = (await getJourneyRecord(ME)).notes;

    expect(listed).toMatchObject({ slotSlug: 'life_work', reading: null });
  });

  it('calls getNotes once for the whole page, even when several entries list notes', async () => {
    getNotes.mockResolvedValue({
      notes: [note(), note({ slotSlug: 'life_money', version: 1 })],
    });
    db.entries.push(
      row({
        id: 'cmsyn1000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_1',
        occurredAt: new Date('2026-10-01T09:00:00Z'),
        notes: [{ slotSlug: 'life_work', version: 1 }],
      }),
      row({
        id: 'cmsyn2000000000000000000000',
        userId: ME,
        kind: 'synopsis',
        sessionId: 'ses_2',
        occurredAt: new Date('2026-10-02T09:00:00Z'),
        notes: [{ slotSlug: 'life_money', version: 1 }],
      })
    );

    const { notes } = await getJourneyRecord(ME);

    expect(getNotes).toHaveBeenCalledTimes(1);
    expect(notes.map((n) => n.slotSlug).sort()).toEqual(['life_money', 'life_work']);
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

  it('dates entries, and the file, in the person’s own time zone', async () => {
    // 22:00 on 5 Oct in New York is 02:00 on 6 Oct in UTC.
    db.zones.set(ME, 'America/New_York');
    db.entries.push(
      row({
        id: 'cmlate00000000000000000000',
        userId: ME,
        occurredAt: new Date('2026-10-06T02:00:00Z'),
      })
    );

    const { markdown, day } = await exportJourneyRecordMarkdown(
      ME,
      new Date('2026-10-06T03:00:00Z')
    );

    expect(markdown).toContain('_Monday, October 5, 2026_');
    expect(day).toBe('2026-10-05');
  });

  it('falls back to UTC for a time zone it does not recognise, rather than failing', async () => {
    db.zones.set(ME, 'Not/AZone');
    db.entries.push(
      row({
        id: 'cmlate00000000000000000000',
        userId: ME,
        occurredAt: new Date('2026-10-06T02:00:00Z'),
      })
    );

    const { markdown, day } = await exportJourneyRecordMarkdown(
      ME,
      new Date('2026-10-06T03:00:00Z')
    );

    expect(markdown).toContain('_Tuesday, October 6, 2026_');
    expect(day).toBe('2026-10-06');
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

describe('one synopsis, for keeping and regenerating (t-147)', () => {
  const draft = () =>
    row({
      id: 'cmsyndraft0000000000000000',
      userId: ME,
      kind: 'synopsis',
      state: 'draft',
      sessionId: 'ses_mine',
      summary: 'The shop',
      body: 'You talked about the shop.',
      keptAt: null,
      regenerations: 1,
    });

  it('reads the caller’s own synopsis with what is left to redraft and its row’s clock', async () => {
    const mine = draft();
    db.entries.push(mine);

    const stored = await readOwnSynopsis(ME, mine.id);

    expect(stored).toMatchObject({
      sessionId: 'ses_mine',
      regenerations: 1,
      updatedAt: mine.updatedAt,
    });
    expect(stored.entry).toMatchObject({ regenerationsLeft: 2, sourceRemoved: false });
  });

  it('says a kept synopsis has no redrafts and whether it was written from something deleted', async () => {
    db.entries.push({
      ...draft(),
      state: 'kept',
      keptAt: new Date('2026-10-02T00:00:00Z'),
      sourceRemovedAt: new Date('2026-10-03T00:00:00Z'),
    });

    const { entry } = await readOwnSynopsis(ME, 'cmsyndraft0000000000000000');

    expect(entry).toMatchObject({ regenerationsLeft: null, sourceRemoved: true });
  });

  it('answers another person’s synopsis as one that never existed, and refuses an own entry', async () => {
    db.entries.push(draft(), row({ id: 'cmown00000000000000000000', userId: ME }));
    expect(db.entries).toHaveLength(2);

    await expect(readOwnSynopsis(THEM, 'cmsyndraft0000000000000000')).rejects.toBeInstanceOf(
      NotFoundError
    );
    await expect(readOwnSynopsis(ME, 'cmown00000000000000000000')).rejects.toMatchObject({
      details: { reason: 'not_a_synopsis' },
    });
  });

  it('replaces only the caller’s own draft, and never a kept one', async () => {
    // The redraft's lease, held on both: only the owner's write may land.
    const lease = new Date('2026-10-06T12:00:00.000Z');
    const mine = { ...draft(), workingSince: lease };
    const theirs = {
      ...draft(),
      id: 'cmsyntheirs000000000000000',
      userId: THEM,
      workingSince: lease,
    };
    db.entries.push(mine, theirs);
    const text = { summary: 'New', body: 'A new draft.', outcomes: [] };

    expect(await replaceSynopsisDraft(ME, theirs.id, text, lease)).toBe(false);
    expect(db.entries.find((r) => r.id === theirs.id)?.body).toBe('You talked about the shop.');

    expect(await replaceSynopsisDraft(ME, mine.id, text, lease)).toBe(true);
    expect(db.entries.find((r) => r.id === mine.id)?.body).toBe('A new draft.');

    const row = db.entries.find((r) => r.id === mine.id)!;
    Object.assign(row, { state: 'kept', workingSince: lease });
    expect(await replaceSynopsisDraft(ME, mine.id, { ...text, body: 'Again.' }, lease)).toBe(false);
    expect(db.entries.find((r) => r.id === mine.id)?.body).toBe('A new draft.');
  });
});
