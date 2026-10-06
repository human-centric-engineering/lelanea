/**
 * Another draft of a synopsis, when the person asks (f-journey-record t-147).
 *
 * The record runs for real against the shared fake, so the cap and the
 * double-submit guard are the conditional writes the database would make. The
 * prompt is built for real too: only the seat's model call is mocked, and the
 * messages it was handed are what the steer is asserted against.
 *
 * @see lib/app/journey-record/synopsis/regenerate.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ME,
  resetWorld,
  synopsisEntry,
  THEM,
  world,
  type EntryRow,
} from '@/tests/unit/lib/app/slots/notes-fake';

const { seat, material } = vi.hoisted(() => ({
  seat: { openSeat: vi.fn(), askSeat: vi.fn() },
  material: { readSessionTurns: vi.fn(), readSessionLines: vi.fn() },
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
vi.mock('@/lib/app/journey-record/synopsis/seat', () => seat);
vi.mock('@/lib/app/journey-record/synopsis/material', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/app/journey-record/synopsis/material')>()),
  ...material,
}));

const { regenerateSynopsis } = await import('@/lib/app/journey-record/synopsis/regenerate');
const { MAX_SYNOPSIS_REGENERATIONS } = await import('@/lib/app/journey-record/entry');
const { NotFoundError } = await import('@/lib/api/errors');

const AGENT = { id: 'agent-synopsis', systemPrompt: 'You are Lelañea.' };
const LINES = [
  { role: 'user', content: 'My father ran the shop.' },
  { role: 'assistant', content: 'What did that ask of you?' },
];
const REPLY = {
  summary: 'Your father and the shop',
  body: 'You talked about your father, and what the shop asked of you.',
  outcomes: [{ kind: 'insight', text: 'The shop set the standard' }],
};

function entry(id: string): EntryRow {
  const row = world.entries.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`no entry ${id}`);
  return row;
}

/** The user message the seat was last asked with. */
function asked(): string {
  const call = seat.askSeat.mock.calls.at(-1);
  if (!call) throw new Error('the seat was never asked');
  return call[2].messages[1].content as string;
}

let draft: EntryRow;

beforeEach(() => {
  vi.clearAllMocks();
  resetWorld();
  seat.openSeat.mockResolvedValue({ agent: AGENT });
  seat.askSeat.mockResolvedValue(REPLY);
  material.readSessionTurns.mockResolvedValue([]);
  material.readSessionLines.mockResolvedValue({ readable: 3, lines: LINES });
  draft = synopsisEntry({
    modules: ['onboarding'],
    notes: [{ slotSlug: 'life_work', version: 1 }],
  });
  world.entries.push(draft);
});

describe('another draft', () => {
  it('replaces the draft, keeping its modules and notes, and carries the steer', async () => {
    const result = await regenerateSynopsis(ME, draft.id, 'You missed the part about my father');

    expect(entry(draft.id)).toMatchObject({
      state: 'draft',
      summary: REPLY.summary,
      body: REPLY.body,
      outcomes: REPLY.outcomes,
      modules: ['onboarding'],
      notes: [{ slotSlug: 'life_work', version: 1 }],
      regenerations: 1,
    });
    expect(result.regenerationsLeft).toBe(MAX_SYNOPSIS_REGENERATIONS - 1);

    const content = asked();
    // The session first, then the draft it replaces, then the steer, each fenced and quoted.
    const session = content.indexOf('[The session begins]');
    const previous = content.indexOf('[The last draft begins]');
    const steer = content.indexOf('[What they said begins]');
    expect(session).toBeGreaterThan(-1);
    expect(previous).toBeGreaterThan(session);
    expect(steer).toBeGreaterThan(previous);
    expect(content).toContain('> You talked about the shop.');
    expect(content).toContain('> You missed the part about my father');
  });

  it('reads the session it is about, as the person', async () => {
    await regenerateSynopsis(ME, draft.id, null);

    expect(material.readSessionTurns).toHaveBeenCalledWith(ME, 'ses_one');
    expect(asked()).not.toContain('[What they said begins]');
  });

  it('is charged through the seat as a draft is', async () => {
    await regenerateSynopsis(ME, draft.id, null);

    expect(seat.askSeat).toHaveBeenCalledWith(
      ME,
      AGENT,
      expect.objectContaining({ kind: 'journey_synopsis' })
    );
  });

  it('stops at the cap, without calling the model', async () => {
    draft.regenerations = MAX_SYNOPSIS_REGENERATIONS;

    await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'no_more_drafts' },
    });
    expect(seat.askSeat).not.toHaveBeenCalled();
  });

  it('reaches the cap one draft at a time', async () => {
    for (let i = 0; i < MAX_SYNOPSIS_REGENERATIONS; i += 1) {
      await regenerateSynopsis(ME, draft.id, null);
    }

    await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
      details: { reason: 'no_more_drafts' },
    });
    expect(seat.askSeat).toHaveBeenCalledTimes(MAX_SYNOPSIS_REGENERATIONS);
  });
});

describe('when it cannot', () => {
  it('refuses a synopsis already kept', async () => {
    Object.assign(draft, { state: 'kept', keptAt: new Date() });

    await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
      details: { reason: 'not_a_draft' },
    });
    expect(seat.askSeat).not.toHaveBeenCalled();
  });

  it.each([['paused'], ['ceiling_reached'], ['no_agent']])(
    'refuses when the seat is %s, and takes no try',
    async (refused) => {
      seat.openSeat.mockResolvedValue({ refused });

      await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
        status: 409,
        details: { reason: refused },
      });
      expect(entry(draft.id).regenerations).toBe(0);
    }
  );

  it('gives the try back and leaves the draft when the call fails', async () => {
    seat.askSeat.mockRejectedValue(new Error('provider down'));

    await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
      status: 503,
      details: { reason: 'failed' },
    });
    expect(entry(draft.id)).toMatchObject({
      regenerations: 0,
      body: 'You talked about the shop.',
    });
  });

  it('gives the try back when too little of the session is left', async () => {
    material.readSessionLines.mockResolvedValue({ readable: 1, lines: LINES.slice(0, 1) });

    await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
      details: { reason: 'not_substantial' },
    });
    expect(seat.askSeat).not.toHaveBeenCalled();
    expect(entry(draft.id).regenerations).toBe(0);
  });

  it('does not overwrite a draft the person kept while it was being written', async () => {
    seat.askSeat.mockImplementation(async () => {
      Object.assign(entry(draft.id), { state: 'kept', keptAt: new Date() });
      return REPLY;
    });

    await expect(regenerateSynopsis(ME, draft.id, null)).rejects.toMatchObject({
      details: { reason: 'changed_meanwhile' },
    });
    expect(entry(draft.id).body).toBe('You talked about the shop.');
  });
});

describe('a double submit', () => {
  it('writes one draft and refuses the second while the first is being written', async () => {
    const results = await Promise.allSettled([
      regenerateSynopsis(ME, draft.id, 'shorter'),
      regenerateSynopsis(ME, draft.id, 'shorter'),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refused = results.find((result) => result.status === 'rejected');
    expect(refused?.reason).toMatchObject({ details: { reason: 'regenerating' } });
    expect(seat.askSeat).toHaveBeenCalledTimes(1);
    expect(entry(draft.id).regenerations).toBe(1);
  });
});

describe('whose synopsis it is', () => {
  it('cannot regenerate another person’s draft, or learn that it exists', async () => {
    const theirs = synopsisEntry({ userId: THEM, sessionId: 'ses_theirs' });
    world.entries.push(theirs);

    await expect(regenerateSynopsis(ME, theirs.id, 'mine now')).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(seat.askSeat).not.toHaveBeenCalled();
    expect(entry(theirs.id)).toMatchObject({
      regenerations: 0,
      body: 'You talked about the shop.',
    });
  });
});
