/**
 * Keeping a synopsis, and what it does to the notes it lists
 * (f-journey-record t-147; owner rulings 2 and 3, and the ruling at t-147).
 *
 * The notes store runs for real against the shared fake
 * (`tests/unit/lib/app/slots/notes-fake.ts`): `getNotes` decides what may be
 * touched and `correctNote` writes, through Daybreak's value engine, so a
 * hidden or special-category note is refused by the same code the panel uses.
 * Only the model is mocked: the seat's gate and the re-read's verdicts.
 *
 * @see lib/app/journey-record/keep.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  definition,
  ME,
  resetWorld,
  synopsisEntry,
  THEM,
  value,
  world,
  type EntryRow,
} from '@/tests/unit/lib/app/slots/notes-fake';

const { seat, reread, queueNoteIndex, notesFailure } = vi.hoisted(() => ({
  /** Set to make the notes read fail once, as a database blip would. */
  notesFailure: { next: null as Error | null },
  seat: { openSeat: vi.fn() },
  reread: { rereadNotes: vi.fn() },
  queueNoteIndex: vi.fn(),
}));

vi.mock('@/lib/db/client', async () => ({
  prisma: (await import('@/tests/unit/lib/app/slots/notes-fake')).prismaFake,
}));
vi.mock('@/lib/db/utils', async () => {
  const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
  return {
    executeTransaction: (work: (tx: typeof prismaFake) => Promise<unknown>) => work(prismaFake),
  };
});
vi.mock('@/lib/app/memory/memory-index', () => ({ queueNoteIndex, forgetWipedNotes: vi.fn() }));
vi.mock('@/lib/app/journey-record/synopsis/seat', () => seat);
vi.mock('@/lib/app/journey-record/synopsis/reread', () => reread);
vi.mock('@/lib/app/slots/notes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app/slots/notes')>();
  return {
    ...actual,
    getNotes: async (...args: Parameters<typeof actual.getNotes>) => {
      const failure = notesFailure.next;
      notesFailure.next = null;
      if (failure) throw failure;
      return actual.getNotes(...args);
    },
  };
});

const {
  keepSynopsis: keepWithSeen,
  KEPT_CONFIRMATION_NOTE,
  KEPT_CORRECTION_NOTE,
} = await import('@/lib/app/journey-record/keep');

type KeepInput = Omit<Parameters<typeof keepWithSeen>[2], 'seen'> & { seen?: Date };

/**
 * Keep as a page showing the entry as it stands would: `seen` is the row's
 * `updatedAt` at the moment of the call, unless a test says otherwise.
 */
function keepSynopsis(userId: string, id: string, input: KeepInput, now: Date) {
  const seen = input.seen ?? world.entries.find((row) => row.id === id)?.updatedAt ?? new Date(0);
  return keepWithSeen(userId, id, { ...input, seen }, now);
}
const { removeJourneyEntry } = await import('@/lib/app/journey-record/record');
const { NotFoundError, ConflictError } = await import('@/lib/api/errors');
const { redactedString } = await import('@/lib/security/redact');

const NOW = new Date('2026-10-06T12:00:00.000Z');
const AGENT = { id: 'agent-synopsis' };

/** Every version of one of a person's notes, oldest first. */
function versions(userId: string, slotSlug: string) {
  return world.values
    .filter((row) => row.userId === userId && row.slotSlug === slotSlug)
    .sort((a, b) => a.version - b.version);
}

function entry(id: string): EntryRow {
  const row = world.entries.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`no entry ${id}`);
  return row;
}

/** One of each kind of note a synopsis could find listed beside it. */
const LISTED = [
  { slotSlug: 'life_work', version: 1 },
  { slotSlug: 'life_rhythm', version: 1 },
  { slotSlug: 'money_story', version: 1 },
  // Never listed by drafting, but a slot can be reclassified after it.
  { slotSlug: 'dev_stage', version: 1 },
  { slotSlug: 'faith', version: 1 },
  { slotSlug: 'old_health', version: 1 },
];

let draft: EntryRow;

beforeEach(() => {
  vi.clearAllMocks();
  resetWorld();
  notesFailure.next = null;
  seat.openSeat.mockResolvedValue({ agent: AGENT });
  reread.rereadNotes.mockResolvedValue(new Map());

  world.projections.push(
    definition('life_work'),
    definition('life_rhythm'),
    definition('money_story'),
    definition('dev_stage', { visibility: 'hidden' }),
    definition('faith'),
    definition('old_health')
  );
  // Ours says special-category where the projection does not: the stricter wins.
  world.ours.push({ slug: 'faith', visibility: 'open', sensitivity: 'special_category' });
  for (const slug of ['life_work', 'life_rhythm', 'money_story', 'dev_stage', 'faith']) {
    world.values.push(value(ME, slug));
  }
  // Blanked out at capture, before its slot moved: withheld, whatever it is now.
  world.values.push(value(ME, 'old_health', { value: redactedString('special_category') }));
  // The other person's reading under the same heading, which no keep of mine may touch.
  world.values.push(value(THEM, 'life_work', { value: 'their own work' }));

  draft = synopsisEntry({ notes: LISTED });
  world.entries.push(draft);
});

describe('approving a draft', () => {
  it('keeps it as written and confirms only the ticked, visible notes', async () => {
    expect(versions(ME, 'life_work')).toHaveLength(1);

    const kept = await keepSynopsis(
      ME,
      draft.id,
      { confirm: [LISTED[0], LISTED[1], LISTED[3], LISTED[4], LISTED[5]] },
      NOW
    );

    expect(kept.entry).toMatchObject({ state: 'kept', body: 'You talked about the shop.' });
    expect(entry(draft.id)).toMatchObject({ state: 'kept', keptAt: NOW });
    for (const slug of ['life_work', 'life_rhythm']) {
      const [before, after] = versions(ME, slug);
      expect(after).toMatchObject({
        version: 2,
        value: before.value,
        sourceType: 'user_confirmed',
        confidence: 10,
        reasoningNote: KEPT_CONFIRMATION_NOTE,
      });
    }
    expect(kept.notes).toEqual([
      { slotSlug: 'life_work', outcome: 'confirmed' },
      { slotSlug: 'life_rhythm', outcome: 'confirmed' },
      { slotSlug: 'money_story', outcome: 'unticked' },
      { slotSlug: 'dev_stage', outcome: 'not_confirmable' },
      { slotSlug: 'faith', outcome: 'not_confirmable' },
      { slotSlug: 'old_health', outcome: 'not_confirmable' },
    ]);
    // It now lists what it confirmed, at the versions keeping left them.
    expect(entry(draft.id).notes).toEqual([
      { slotSlug: 'life_work', version: 2 },
      { slotSlug: 'life_rhythm', version: 2 },
    ]);
    // Approving never asks a model.
    expect(seat.openSeat).not.toHaveBeenCalled();
    expect(reread.rereadNotes).not.toHaveBeenCalled();
  });

  it('leaves an unticked note exactly as it was', async () => {
    const before = versions(ME, 'money_story').map((row) => ({ ...row }));

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(versions(ME, 'money_story')).toEqual(before);
    expect(kept.notes).toContainEqual({ slotSlug: 'money_story', outcome: 'unticked' });
  });

  it('confirms nothing when nothing is ticked, and still keeps it', async () => {
    const before = world.values.length;

    const kept = await keepSynopsis(ME, draft.id, { confirm: [] }, NOW);

    expect(world.values).toHaveLength(before);
    expect(kept.entry.state).toBe('kept');
    expect(kept.notes.every((note) => note.outcome === 'unticked')).toBe(true);
    expect(entry(draft.id).notes).toEqual([]);
  });

  it('never touches a hidden, special-category or withheld note, ticked or not', async () => {
    const untouchable = ['dev_stage', 'faith', 'old_health'];
    const before = untouchable.map((slug) => versions(ME, slug).map((row) => ({ ...row })));

    await keepSynopsis(ME, draft.id, { confirm: LISTED }, NOW);

    expect(untouchable.map((slug) => versions(ME, slug))).toEqual(before);
  });

  it('leaves a note that has moved on since the session alone', async () => {
    // A later session read it again: the head is not the version listed.
    const head = versions(ME, 'life_work')[0];
    head.supersededAt = NOW;
    world.values.push(value(ME, 'life_work', { version: 2, value: 'later reading' }));

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(versions(ME, 'life_work')).toHaveLength(2);
    expect(kept.notes).toContainEqual({ slotSlug: 'life_work', outcome: 'moved_on' });
  });

  it('ignores a ticked note the synopsis does not list', async () => {
    const before = world.values.length;

    await keepSynopsis(ME, draft.id, { confirm: [{ slotSlug: 'life_work', version: 7 }] }, NOW);

    expect(world.values).toHaveLength(before);
  });

  it('never touches the other person’s note under the same heading', async () => {
    const theirs = versions(THEM, 'life_work').map((row) => ({ ...row }));

    await keepSynopsis(ME, draft.id, { confirm: LISTED }, NOW);

    expect(versions(THEM, 'life_work')).toEqual(theirs);
  });

  it('does not write a confirmation over one the person already made', async () => {
    const head = versions(ME, 'life_work')[0];
    Object.assign(head, { sourceType: 'user_confirmed', confidence: 10 });

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(versions(ME, 'life_work')).toHaveLength(1);
    expect(kept.notes).toContainEqual({ slotSlug: 'life_work', outcome: 'already_confirmed' });
    expect(entry(draft.id).notes).toEqual([{ slotSlug: 'life_work', version: 1 }]);
  });
});

describe('editing before keeping', () => {
  const EDIT = {
    summary: 'Teaching, not the shop',
    body: 'You said the work you want now is teaching.',
    outcomes: [{ kind: 'insight' as const, text: 'Teaching is the work' }],
  };

  it('stores the edited text, and corrects a note the edit reads differently', async () => {
    reread.rereadNotes.mockResolvedValue(
      new Map([
        ['life_work', { verdict: 'differs', value: 'Teaching, now' }],
        ['life_rhythm', { verdict: 'agrees' }],
      ])
    );

    const kept = await keepSynopsis(
      ME,
      draft.id,
      { confirm: [LISTED[0], LISTED[1], LISTED[3]], edit: EDIT },
      NOW
    );

    expect(entry(draft.id)).toMatchObject({ state: 'kept', ...EDIT });
    expect(versions(ME, 'life_work')[1]).toMatchObject({
      value: 'Teaching, now',
      sourceType: 'user_confirmed',
      confidence: 10,
      reasoningNote: KEPT_CORRECTION_NOTE,
    });
    expect(versions(ME, 'life_rhythm')[1]).toMatchObject({
      sourceType: 'user_confirmed',
      reasoningNote: KEPT_CONFIRMATION_NOTE,
    });
    expect(kept.notes.slice(0, 2)).toEqual([
      { slotSlug: 'life_work', outcome: 'corrected' },
      { slotSlug: 'life_rhythm', outcome: 'confirmed' },
    ]);
    expect(kept.notesUnread).toBeNull();
  });

  it('re-reads only the ticked notes it may touch, against the edited text', async () => {
    await keepSynopsis(ME, draft.id, { confirm: LISTED, edit: EDIT }, NOW);

    expect(reread.rereadNotes).toHaveBeenCalledTimes(1);
    const [userId, agent, account, notes] = reread.rereadNotes.mock.calls[0];
    expect(userId).toBe(ME);
    expect(agent).toBe(AGENT);
    expect(account).toEqual(EDIT);
    expect(notes.map((note: { slotSlug: string }) => note.slotSlug)).toEqual([
      'life_work',
      'life_rhythm',
      'money_story',
    ]);
  });

  it('confirms a ticked note the edit does not speak to', async () => {
    reread.rereadNotes.mockResolvedValue(new Map([['life_work', { verdict: 'silent' }]]));

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]], edit: EDIT }, NOW);

    expect(kept.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'confirmed' });
  });

  it.each([['paused' as const], ['ceiling_reached' as const], ['no_agent' as const]])(
    'keeps the edit but leaves the notes alone when the seat is %s',
    async (refused) => {
      seat.openSeat.mockResolvedValue({ refused });
      const before = world.values.length;

      const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]], edit: EDIT }, NOW);

      expect(entry(draft.id)).toMatchObject({ state: 'kept', body: EDIT.body });
      expect(world.values).toHaveLength(before);
      expect(kept.notesUnread).toBe(refused);
      expect(kept.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'unread' });
      // Still listed, so a later change can read it.
      expect(entry(draft.id).notes).toEqual([LISTED[0]]);
    }
  );

  it('keeps the edit but leaves the notes alone when the re-read fails', async () => {
    reread.rereadNotes.mockRejectedValue(new Error('provider down'));
    const before = world.values.length;

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]], edit: EDIT }, NOW);

    expect(entry(draft.id).body).toBe(EDIT.body);
    expect(world.values).toHaveLength(before);
    expect(kept.notesUnread).toBe('failed');
  });

  it('treats an edit identical to the draft as approving it, with no re-read', async () => {
    const same = { summary: draft.summary!, body: draft.body, outcomes: [] };

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]], edit: same }, NOW);

    expect(reread.rereadNotes).not.toHaveBeenCalled();
    expect(kept.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'confirmed' });
  });
});

describe('changing a synopsis already kept', () => {
  const EDIT = { summary: 'Teaching', body: 'It was about teaching.', outcomes: [] };

  it('stores the change, re-reads the notes it confirmed, and clears the deleted flag', async () => {
    await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);
    entry(draft.id).sourceRemovedAt = NOW;
    reread.rereadNotes.mockResolvedValue(
      new Map([['life_work', { verdict: 'differs', value: 'Teaching' }]])
    );

    const changed = await keepSynopsis(
      ME,
      draft.id,
      { confirm: [{ slotSlug: 'life_work', version: 2 }], edit: EDIT },
      NOW
    );

    expect(changed.entry).toMatchObject({ state: 'kept', body: EDIT.body, sourceRemoved: false });
    expect(versions(ME, 'life_work')).toHaveLength(3);
    expect(versions(ME, 'life_work')[2].value).toBe('Teaching');
    expect(entry(draft.id).notes).toEqual([{ slotSlug: 'life_work', version: 3 }]);
    // Keeping it again does not move when it was first kept.
    expect(entry(draft.id).keptAt).toEqual(NOW);
  });

  it('does nothing when kept again with no change', async () => {
    await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);
    const before = world.values.length;

    const again = await keepSynopsis(
      ME,
      draft.id,
      { confirm: [{ slotSlug: 'life_work', version: 2 }] },
      NOW
    );

    expect(world.values).toHaveLength(before);
    expect(again.notes).toEqual([]);
  });
});

describe('a double submit', () => {
  it('keeps once and confirms once when the same approve arrives twice at once', async () => {
    const input = { confirm: [LISTED[0]] };

    const [first, second] = await Promise.all([
      keepSynopsis(ME, draft.id, input, NOW),
      keepSynopsis(ME, draft.id, input, NOW),
    ]);

    expect(versions(ME, 'life_work')).toHaveLength(2);
    expect([first.notes.length, second.notes.length].sort()).toEqual([0, 6]);
    expect(first.entry.state).toBe('kept');
    expect(second.entry.state).toBe('kept');
  });

  it('keeps once when the same approve arrives twice in a row', async () => {
    await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);
    const again = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(versions(ME, 'life_work')).toHaveLength(2);
    expect(again.notes).toEqual([]);
  });

  it('keeps once and re-reads once when the same edit arrives twice at once', async () => {
    const input = { confirm: [LISTED[0]], edit: { summary: 'S', body: 'B', outcomes: [] } };

    await Promise.all([
      keepSynopsis(ME, draft.id, input, NOW),
      keepSynopsis(ME, draft.id, input, NOW),
    ]);

    expect(reread.rereadNotes).toHaveBeenCalledTimes(1);
    expect(versions(ME, 'life_work')).toHaveLength(2);
  });

  it('refuses the second of two different edits arriving at once', async () => {
    const one = { confirm: [], edit: { summary: 'One', body: 'One.', outcomes: [] } };
    const two = { confirm: [], edit: { summary: 'Two', body: 'Two.', outcomes: [] } };

    const results = await Promise.allSettled([
      keepSynopsis(ME, draft.id, one, NOW),
      keepSynopsis(ME, draft.id, two, NOW),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refused?.reason).toBeInstanceOf(ConflictError);
  });
});

describe('a keep that fails half way', () => {
  it('keeps an edit whose re-read could not even ask, and says the notes were not read', async () => {
    seat.openSeat.mockRejectedValue(new Error('database blip'));
    const before = world.values.length;

    const kept = await keepSynopsis(
      ME,
      draft.id,
      { confirm: [LISTED[0]], edit: { summary: 'S', body: 'B.', outcomes: [] } },
      NOW
    );

    expect(entry(draft.id)).toMatchObject({ state: 'kept', body: 'B.', notesPending: 'reread' });
    expect(kept.notesUnread).toBe('failed');
    expect(world.values).toHaveLength(before);
  });

  it('is finished by the next keep when settling the notes failed after the claim', async () => {
    notesFailure.next = new Error('database blip');

    await expect(keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW)).rejects.toThrow(
      'database blip'
    );
    // Kept, still owing its notes, and the lease given back.
    expect(entry(draft.id)).toMatchObject({
      state: 'kept',
      notesPending: 'confirm',
      workingSince: null,
    });
    expect(versions(ME, 'life_work')).toHaveLength(1);

    const retried = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(retried.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'confirmed' });
    expect(versions(ME, 'life_work')).toHaveLength(2);
    expect(entry(draft.id).notesPending).toBeNull();
  });

  it('reads an edit it could not read before on the next keep, even one changing nothing', async () => {
    const edit = { summary: 'Teaching', body: 'It was about teaching.', outcomes: [] };
    seat.openSeat.mockResolvedValueOnce({ refused: 'ceiling_reached' });
    await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]], edit }, NOW);
    expect(entry(draft.id).notesPending).toBe('reread');
    reread.rereadNotes.mockResolvedValue(
      new Map([['life_work', { verdict: 'differs', value: 'Teaching' }]])
    );

    const again = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(reread.rereadNotes).toHaveBeenCalledWith(
      ME,
      AGENT,
      edit,
      expect.arrayContaining([expect.objectContaining({ slotSlug: 'life_work' })])
    );
    expect(again.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'corrected' });
    expect(versions(ME, 'life_work')[1].value).toBe('Teaching');
    expect(entry(draft.id).notesPending).toBeNull();
  });

  it('takes over a lease left by a keep that never finished', async () => {
    entry(draft.id).workingSince = new Date(NOW.getTime() - 10 * 60_000);

    const kept = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);

    expect(kept.entry.state).toBe('kept');
    expect(entry(draft.id).workingSince).toBeNull();
  });

  it('waits for a keep still under way rather than racing it', async () => {
    entry(draft.id).workingSince = new Date(NOW.getTime() - 1_000);

    await expect(
      keepSynopsis(
        ME,
        draft.id,
        { confirm: [], edit: { summary: 'S', body: 'B.', outcomes: [] } },
        NOW
      )
    ).rejects.toMatchObject({ details: { reason: 'busy' } });
    expect(entry(draft.id).state).toBe('draft');
  });
});

describe('what the person was shown', () => {
  it('keeps nothing from a page showing an older draft than the one stored', async () => {
    // Shown the first draft; another tab has since redrafted it.
    const shown = draft.updatedAt;
    Object.assign(draft, {
      body: 'A redraft they never read.',
      updatedAt: new Date(NOW.getTime() - 1),
    });
    const before = world.values.length;

    await expect(
      keepSynopsis(ME, draft.id, { seen: shown, confirm: [LISTED[0]] }, NOW)
    ).rejects.toMatchObject({ details: { reason: 'changed_meanwhile' } });
    expect(entry(draft.id).state).toBe('draft');
    expect(world.values).toHaveLength(before);
  });
});

describe('a note written to while keeping', () => {
  it('does not bury a reading a turn wrote while the re-read ran', async () => {
    reread.rereadNotes.mockImplementation(async () => {
      // A live turn writes a newer reading while the model reads the edit.
      const head = versions(ME, 'life_work')[0];
      head.supersededAt = NOW;
      world.values.push(value(ME, 'life_work', { version: 2, value: 'the newest reading' }));
      return new Map([['life_work', { verdict: 'differs', value: 'From the edit' }]]);
    });

    const kept = await keepSynopsis(
      ME,
      draft.id,
      { confirm: [LISTED[0]], edit: { summary: 'S', body: 'B.', outcomes: [] } },
      NOW
    );

    expect(kept.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'moved_on' });
    expect(versions(ME, 'life_work')).toHaveLength(2);
    expect(versions(ME, 'life_work')[1].value).toBe('the newest reading');
  });

  it('fails the keep, owing its notes, when a confirmation fails for a reason that is not a refusal', async () => {
    const { prismaFake } = await import('@/tests/unit/lib/app/slots/notes-fake');
    // At the supersede, before anything changed: the fake has no transaction to roll back.
    vi.mocked(prismaFake.slotValue.update).mockRejectedValueOnce(new Error('connection reset'));

    await expect(keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW)).rejects.toThrow(
      'connection reset'
    );
    expect(entry(draft.id)).toMatchObject({
      state: 'kept',
      notesPending: 'confirm',
      workingSince: null,
    });

    const retried = await keepSynopsis(ME, draft.id, { confirm: [LISTED[0]] }, NOW);
    expect(retried.notes[0]).toEqual({ slotSlug: 'life_work', outcome: 'confirmed' });
  });
});

describe('discarding a draft', () => {
  it('leaves no entry, kept or otherwise, and nothing left to keep', async () => {
    expect(world.entries).toHaveLength(1);
    const before = world.values.length;

    await removeJourneyEntry(ME, draft.id);

    expect(world.entries).toEqual([]);
    await expect(keepSynopsis(ME, draft.id, { confirm: LISTED }, NOW)).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(world.values).toHaveLength(before);
  });
});

describe('two changes to a kept synopsis at once', () => {
  it('stores one and refuses the other, rather than the later silently winning', async () => {
    await keepSynopsis(ME, draft.id, { confirm: [] }, NOW);
    const one = { confirm: [], edit: { summary: 'One', body: 'One.', outcomes: [] } };
    const two = { confirm: [], edit: { summary: 'Two', body: 'Two.', outcomes: [] } };

    const results = await Promise.allSettled([
      keepSynopsis(ME, draft.id, one, NOW),
      keepSynopsis(ME, draft.id, two, NOW),
    ]);

    const kept = results.find((result) => result.status === 'fulfilled');
    const refused = results.find((result) => result.status === 'rejected');
    // The second met the first's lease: told to try again, never racing its notes.
    expect(refused?.reason).toMatchObject({ details: { reason: 'busy' } });
    expect(kept?.status === 'fulfilled' && kept.value.entry.body).toBe(entry(draft.id).body);
  });
});

describe('whose synopsis it is', () => {
  it('cannot keep, edit or confirm through another person’s draft', async () => {
    const theirs = synopsisEntry({
      userId: THEM,
      sessionId: 'ses_theirs',
      notes: [{ slotSlug: 'life_work', version: 1 }],
    });
    world.entries.push(theirs);
    const before = world.values.length;

    await expect(
      keepSynopsis(ME, theirs.id, { confirm: theirs.notes as typeof LISTED }, NOW)
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      keepSynopsis(
        ME,
        theirs.id,
        { confirm: [], edit: { summary: 'Mine now', body: 'Mine.', outcomes: [] } },
        NOW
      )
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(entry(theirs.id)).toMatchObject({ state: 'draft', summary: 'Where the work came from' });
    expect(world.values).toHaveLength(before);
  });

  it('refuses an entry the person wrote: that is edited, not kept', async () => {
    const own = synopsisEntry({ kind: 'own', state: 'kept', sessionId: null, keptAt: NOW });
    world.entries.push(own);

    await expect(keepSynopsis(ME, own.id, { confirm: [] }, NOW)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'not_a_synopsis' },
    });
  });
});
