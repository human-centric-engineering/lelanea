// @vitest-environment happy-dom

/**
 * The journey editor (f-content-seeds t-91): the journey's own meta, each
 * tier, and each module — including its phases, field by field, and the two
 * JSON columns (`phaseTiers`, `produces`) a module and each of its phases
 * carry.
 *
 * What is proved here is what the admin sees and what the browser sends —
 * never what the route decides (that is the route's test) nor what the store
 * writes (the store's).
 *
 * @see components/app/admin/content/journey-panel.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { JourneyPanel } from '@/components/app/admin/content/journey-panel';
import { contentItemEndpoint } from '@/lib/app/content/admin/endpoint';
import { createMockRouter } from '@/tests/types/mocks';
import type { JourneyAdminView } from '@/lib/app/content/admin/journey';
import type {
  JourneyModuleView,
  JourneyStructure,
  JourneyTierView,
  StoredPhase,
} from '@/lib/app/content/journey-view';

const mockRouter = createMockRouter();
vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function ok(data: unknown) {
  return new Response(JSON.stringify({ success: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(status: number, message: string, details?: unknown) {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'ERR', message, details } }),
    { status, headers: { 'content-type': 'application/json' } }
  );
}

/** What the browser actually sent on call `index`. */
function sent(index = 0) {
  const call = fetchMock.mock.calls[index] as [string, RequestInit & { body?: string }];
  return {
    url: call[0],
    method: call[1].method,
    body: call[1].body === undefined ? undefined : (JSON.parse(call[1].body) as unknown),
  };
}

/** The `phases` array from the last request's body, however the caller wants
 * to read its entries. */
function sentPhases(): Record<string, unknown>[] {
  return (sent().body as { phases: Record<string, unknown>[] }).phases;
}

/** A field found by its own id, sidestepping the label collisions a phase's
 * "Title" and "Shown as" share with the module's own fields of the same
 * name. */
function fieldById<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`No element with id "${id}"`);
  return el as T;
}

/** Text via `user.paste`, not `user.type`: JSON is mostly `{` and `[`, which
 * `user.type` reads as keyboard descriptors. */
async function paste(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

const TIER: JourneyTierView = {
  id: 'foundations',
  label: 'Orientation',
  order: 1,
  modules: ['module_01_a'],
  intent: 'Get her bearings.',
  revision: 2,
};

const PHASE: StoredPhase = {
  number: 1,
  displayNumber: '1.1',
  title: 'Opening',
  description: 'What happens first.',
  contentRef: 'the_initiation',
  proposed: false,
  phaseTier: 'orientation',
  questionCount: 3,
  personalized: true,
  requiresAcknowledgement: false,
  produces: { artifact: 'note', revisitable: true },
};

const MODULE: JourneyModuleView = {
  id: 'module_01_a',
  number: 1,
  displayNumber: '01',
  title: 'Getting started',
  subtitle: 'A gentle beginning',
  chartTitle: 'Start',
  tier: 'foundations',
  phases: [PHASE],
  phaseTiers: [{ id: 'orientation', label: 'Orientation', order: 1, phases: [1] }],
  produces: { artifact: 'a written reflection', revisitable: false },
  revision: 5,
};

const STRUCTURE: JourneyStructure = {
  collection: {
    id: 'journey-1',
    title: 'The Journey',
    subtitle: 'Her words',
    version: '1.0',
    locale: 'en-US',
  },
  tiers: [TIER],
  modules: [MODULE],
};

const VIEW: JourneyAdminView = {
  seeded: true,
  structure: STRUCTURE,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  fetchMock.mockReset();
  mockRouter.refresh.mockClear();
});

describe('before the seed has run', () => {
  it('says so when there is no structure', () => {
    render(<JourneyPanel initialView={{ seeded: false, structure: null, updatedAt: null }} />);

    expect(screen.getByText(/has not been seeded yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).toBeNull();
  });

  it('says so when the structure exists but the row has never been written', () => {
    // The other half of `!structure || !initialView.updatedAt` — a structure
    // can only exist once the seed has run, so this is here for the branch,
    // not because it happens in practice.
    render(<JourneyPanel initialView={{ seeded: true, structure: STRUCTURE, updatedAt: null }} />);

    expect(screen.getByText(/has not been seeded yet/)).toBeInTheDocument();
  });
});

describe('the journey', () => {
  it('saves the meta fields against the row it loaded, and says what changed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'] }));
    render(<JourneyPanel initialView={VIEW} />);

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'New Title');
    const subtitle = screen.getByLabelText('Subtitle');
    await user.clear(subtitle);
    await user.type(subtitle, 'New subtitle');
    const version = screen.getByLabelText('Version');
    await user.clear(version);
    await user.type(version, '1.1');
    const locale = screen.getByLabelText('Locale');
    await user.clear(locale);
    await user.type(locale, 'en-GB');
    await user.click(screen.getByRole('button', { name: 'Save journey' }));

    expect(sent().url).toBe(contentItemEndpoint('journey', 'journey', 'journey-1'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      title: 'New Title',
      subtitle: 'New subtitle',
      version: '1.1',
      locale: 'en-GB',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await screen.findByText('Saved the journey.')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('says plainly when nothing changed, rather than implying a new version', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<JourneyPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save journey' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s refusal instead of claiming success', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'Someone else changed the journey.'));
    render(<JourneyPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save journey' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed the journey.');
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });
});

describe('a tier', () => {
  it('saves its label and intent against its own revision', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['label'] }));
    render(<JourneyPanel initialView={VIEW} />);

    const label = screen.getByLabelText('Label');
    await user.clear(label);
    await user.type(label, 'Beginning');
    const intent = screen.getByLabelText('Intent');
    await user.clear(intent);
    await user.type(intent, 'Find her footing.');
    await user.click(screen.getByRole('button', { name: 'Save tier' }));

    expect(sent().url).toBe(contentItemEndpoint('journey', 'tier', 'foundations'));
    expect(sent().body).toEqual({
      revision: 2,
      label: 'Beginning',
      intent: 'Find her footing.',
    });
    expect(await screen.findByText('Saved the tier "Beginning".')).toBeInTheDocument();
  });

  it('reports a save error on the row itself', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(400, 'A label is required.'));
    render(<JourneyPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save tier' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('A label is required.');
  });
});

describe('a module', () => {
  async function openModule(user: ReturnType<typeof userEvent.setup>) {
    render(<JourneyPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Getting started' }));
  }

  const P = 'module-module_01_a';

  it('saves title, numbering, subtitle, chart title, the phases and both JSON fields as one PUT', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'] }));
    await openModule(user);

    const title = fieldById(`${P}-title`);
    await user.clear(title);
    await user.type(title, 'A New Beginning');
    const displayNumber = fieldById(`${P}-number`);
    await user.clear(displayNumber);
    await user.type(displayNumber, '02');
    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(sent().url).toBe(contentItemEndpoint('journey', 'module', 'module_01_a'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      revision: 5,
      displayNumber: '02',
      title: 'A New Beginning',
      subtitle: 'A gentle beginning',
      chartTitle: 'Start',
      phases: [PHASE],
      phaseTiers: MODULE.phaseTiers,
      produces: MODULE.produces,
    });
    expect(await screen.findByText('Saved "A New Beginning".')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('sends null when the subtitle and chart title are cleared', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['subtitle'] }));
    await openModule(user);

    await user.clear(fieldById(`${P}-subtitle`));
    await user.clear(fieldById(`${P}-chart`));
    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(sent().body).toMatchObject({ subtitle: null, chartTitle: null });
  });

  it('says plainly when a module save changed nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    await openModule(user);

    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s refusal for a module save', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'The module moved under you.'));
    await openModule(user);

    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The module moved under you.');
  });

  it('parses valid JSON typed into the phase groupings and produces fields', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['phaseTiers'] }));
    await openModule(user);

    const phaseTiers = fieldById(`${P}-tiers`);
    await user.clear(phaseTiers);
    await paste(user, phaseTiers, 'null');
    const produces = fieldById(`${P}-produces`);
    await user.clear(produces);
    await paste(user, produces, 'null');

    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(sent().body).toMatchObject({ phaseTiers: null, produces: null });
  });

  it('refuses to save when the phase groupings JSON is invalid, without calling the server', async () => {
    const user = userEvent.setup();
    await openModule(user);

    const phaseTiers = fieldById(`${P}-tiers`);
    await user.clear(phaseTiers);
    await paste(user, phaseTiers, '{not json');
    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Phase groupings and "produces" must be valid JSON (or null).'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses to save when the module-level produces JSON is invalid, without calling the server', async () => {
    const user = userEvent.setup();
    await openModule(user);

    const produces = fieldById(`${P}-produces`);
    await user.clear(produces);
    await paste(user, produces, 'not json at all');
    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Phase groupings and "produces" must be valid JSON (or null).'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('adds a new phase with the next number and sensible defaults', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['phases'] }));
    await openModule(user);

    await user.click(screen.getByRole('button', { name: 'Add a phase' }));
    await user.click(screen.getByRole('button', { name: 'Save module' }));

    const phases = sentPhases();
    expect(phases).toHaveLength(2);
    expect(phases[1]).toEqual({
      number: 2,
      displayNumber: '2',
      title: '',
      description: '',
      contentRef: null,
      proposed: true,
      phaseTier: null,
      questionCount: null,
      personalized: false,
      requiresAcknowledgement: false,
      produces: null,
    });
  });

  it('removes a phase from the draft before saving', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['phases'] }));
    await openModule(user);

    await user.click(screen.getByRole('button', { name: 'Remove phase' }));
    await user.click(screen.getByRole('button', { name: 'Save module' }));

    expect(sentPhases()).toEqual([]);
  });

  describe('a phase', () => {
    const PH = `${P}-phase-0`;

    it('edits number, tier, question count and title, and saves them on the phase', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(ok({ changed: ['phases'] }));
      await openModule(user);

      await user.clear(fieldById(`${PH}-number`));
      await user.type(fieldById(`${PH}-number`), '2');

      await user.selectOptions(fieldById<HTMLSelectElement>(`${PH}-tier`), 'discernment');

      await user.clear(fieldById(`${PH}-questions`));
      await user.type(fieldById(`${PH}-questions`), '5');

      const title = fieldById(`${PH}-title`);
      await user.clear(title);
      await user.type(title, 'Opening, reworded');

      const display = fieldById(`${PH}-display`);
      await user.clear(display);
      await user.type(display, '1.2');

      const description = fieldById(`${PH}-description`);
      await user.clear(description);
      await user.type(description, 'What happens now.');

      await user.click(screen.getByRole('button', { name: 'Save module' }));

      expect(sentPhases()).toEqual([
        {
          ...PHASE,
          number: 2,
          displayNumber: '1.2',
          phaseTier: 'discernment',
          questionCount: 5,
          title: 'Opening, reworded',
          description: 'What happens now.',
        },
      ]);
    });

    it('clears the phase tier to null when "none" is chosen', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
      await openModule(user);

      await user.selectOptions(fieldById<HTMLSelectElement>(`${PH}-tier`), '');
      await user.click(screen.getByRole('button', { name: 'Save module' }));

      const phases = sentPhases();
      expect(phases[0].phaseTier).toBeNull();
    });

    it('sends null questionCount when the field is cleared', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
      await openModule(user);

      await user.clear(fieldById(`${PH}-questions`));
      await user.click(screen.getByRole('button', { name: 'Save module' }));

      const phases = sentPhases();
      expect(phases[0].questionCount).toBeNull();
    });

    it('sends null contentRef when the field is cleared', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
      await openModule(user);

      await user.clear(fieldById(`${PH}-ref`));
      await user.click(screen.getByRole('button', { name: 'Save module' }));

      const phases = sentPhases();
      expect(phases[0].contentRef).toBeNull();
    });

    it('accepts valid JSON typed into the per-phase produces field on blur', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
      await openModule(user);

      const produces = fieldById(`${PH}-produces`);
      await user.clear(produces);
      await paste(user, produces, '{"artifact":"note","revisitable":false}');
      await user.tab();

      expect(screen.queryByRole('alert')).toBeNull();
      expect(produces).toHaveAttribute('aria-invalid', 'false');

      await user.click(screen.getByRole('button', { name: 'Save module' }));
      const phases = sentPhases();
      expect(phases[0].produces).toEqual({ artifact: 'note', revisitable: false });
    });

    it('flags invalid JSON in the per-phase produces field and does not change the stored value', async () => {
      const user = userEvent.setup();
      await openModule(user);

      const produces = fieldById(`${PH}-produces`);
      await user.clear(produces);
      await paste(user, produces, 'not json');
      await user.tab();

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'That is not JSON, so it was not taken. Type an object or null.'
      );
      expect(produces).toHaveAttribute('aria-invalid', 'true');

      await user.click(screen.getByRole('button', { name: 'Save module' }));
      const phases = sentPhases();
      // The bad text was never taken, so the phase still carries what it loaded with.
      expect(phases[0].produces).toEqual(PHASE.produces);
    });

    it('toggles proposed, personalized and "must be acknowledged", then saves them', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
      await openModule(user);

      await user.click(fieldById(`${PH}-proposed`));
      await user.click(fieldById(`${PH}-personalized`));
      await user.click(fieldById(`${PH}-requiresAcknowledgement`));

      await user.click(screen.getByRole('button', { name: 'Save module' }));

      const phases = sentPhases();
      expect(phases[0]).toMatchObject({
        proposed: true,
        personalized: false,
        requiresAcknowledgement: true,
      });
    });
  });
});
