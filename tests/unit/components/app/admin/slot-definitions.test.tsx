// @vitest-environment happy-dom

/**
 * The slot taxonomy editor (f-slots t-71).
 *
 * What is proved here is what the admin sees and what the browser sends — not
 * what the routes decide, which is the routes' test, nor what the store writes,
 * which is the store's.
 *
 * Two of these are the load-bearing ones:
 *
 * - **The version sent is the loaded row's**, not anything held in form state.
 *   That is what makes the stale-form refusal reachable at all; sending a
 *   version the form had just been re-rendered with would make every save look
 *   current and the 409 unreachable.
 * - **Apply is disabled until a preview has been read**, and a change to the
 *   file or the mode takes the plan back down. An apply button live against a
 *   plan made from different text is the silent retirement this whole flow
 *   exists to prevent.
 *
 * @see components/app/admin/slot-definitions.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SlotDefinitionsPanel } from '@/components/app/admin/slot-definitions';
import {
  SLOT_DEFINITIONS_ENDPOINT,
  SLOT_TAXONOMY_EXPORT_ENDPOINT,
  SLOT_TAXONOMY_UPLOAD_ENDPOINT,
  SLOT_TAXONOMY_UPLOAD_PREVIEW_ENDPOINT,
  slotDefinitionActiveEndpoint,
  slotDefinitionEndpoint,
  slotDefinitionHistoryEndpoint,
} from '@/lib/app/slots/endpoint';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const WORK = {
  slug: 'life_work',
  group: 'life_areas',
  description: 'How their working life stands right now.',
  visibility: 'open',
  mode: 'targeted',
  dataType: 'text',
  sensitivity: 'sensitive',
  priorityWeight: 70,
  isActive: true,
  version: 3,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const RETIRED = {
  ...WORK,
  slug: 'life_old',
  description: 'No longer asked.',
  isActive: false,
  version: 5,
};

const VIEW = { seeded: true, groups: ['life_areas'], definitions: [WORK] };

const SYNCED = { status: 'synced', provided: 1, created: 0, updated: 1, deactivated: 0 };

const EMPTY_PLAN = {
  mode: 'merge',
  creates: [],
  updates: [],
  retirements: [],
  unchanged: [],
  skippedRetired: [],
  absentFromFile: [],
};

function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function refused(status: number, message: string, details?: unknown) {
  return new Response(
    JSON.stringify({ success: false, error: { code: 'CONFLICT', message, details } }),
    {
      status,
      headers: { 'content-type': 'application/json' },
    }
  );
}

/**
 * Put text in a field without `user.type` reading it as keystrokes: `{` and `[`
 * are keyboard descriptors to user-event, and a JSON file is mostly those.
 */
async function fill(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
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

beforeEach(() => {
  fetchMock.mockReset();
});

describe('before the seed has run', () => {
  it('says so, and offers nothing to edit', () => {
    render(<SlotDefinitionsPanel initialView={{ seeded: false, groups: [], definitions: [] }} />);

    expect(screen.getByRole('alert')).toHaveTextContent(/db:seed/);
    expect(screen.queryByRole('button', { name: 'Add a slot' })).toBeNull();
  });
});

describe('the list', () => {
  it('shows each slot under its group, with its version', () => {
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    const section = screen.getByRole('region', { name: 'life areas' });
    expect(within(section).getByText('life_work')).toBeInTheDocument();
    expect(within(section).getByText('v3')).toBeInTheDocument();
  });

  it('keeps a retired slot on the page, marked, with Restore offered', () => {
    // A retirement is not a deletion, and a list that hid them would say it was.
    render(<SlotDefinitionsPanel initialView={{ ...VIEW, definitions: [WORK, RETIRED] }} />);

    expect(screen.getByText('life_old')).toBeInTheDocument();
    expect(screen.getByText('Retired')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.getByText(/1 being asked about, 1 retired/)).toBeInTheDocument();
  });
});

describe('rewording a slot', () => {
  it('sends the version of the row it loaded, not one from the form', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({
        definition: { ...WORK, description: 'Reworded.', version: 4 },
        changed: ['description'],
        sync: SYNCED,
      })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit life_work' });
    const description = within(form).getByLabelText('What it means');
    await user.clear(description);
    await user.type(description, 'Reworded.');
    await user.click(within(form).getByRole('button', { name: 'Save v3' }));

    expect(sent().url).toBe(slotDefinitionEndpoint('life_work'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      group: 'life_areas',
      description: 'Reworded.',
      visibility: 'open',
      dataType: 'text',
      sensitivity: 'sensitive',
      priorityWeight: 70,
      version: 3,
    });
  });

  it('never sends the slug, because a slug is not editable', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({ definition: WORK, changed: [], sync: { status: 'not_needed' } })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit life_work' });
    expect(within(form).getByLabelText('Slug')).toBeDisabled();

    await user.click(within(form).getByRole('button', { name: 'Save v3' }));
    expect(sent().body).not.toHaveProperty('slug');
  });

  it('shows the route’s stale-form refusal verbatim', async () => {
    // It names both versions, which is the only thing that tells the admin what
    // happened. Paraphrasing it here would lose that.
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      refused(
        409,
        '"life_work" was changed by someone else since you opened it (version 3, now 5). Reload and read it again before saving.',
        {
          reason: 'version_moved',
          currentVersion: 5,
        }
      )
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save v3' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/version 3, now 5/);
  });

  it('says plainly when a save changed nothing, rather than implying a new version', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({ definition: WORK, changed: [], sync: { status: 'not_needed' } })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save v3' }));

    expect(
      await screen.findByText(/Nothing had changed, so nothing was written/)
    ).toBeInTheDocument();
  });

  it('warns that the agent is behind when the projection did not update', async () => {
    // The edit IS saved. An error would be wrong; silence would be worse.
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({
        definition: { ...WORK, version: 4 },
        changed: ['description'],
        sync: { status: 'failed', message: 'the provider blew up' },
      })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save v3' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/still reading the previous wording/);
    expect(alert).toHaveTextContent(/Save again/);
  });
});

describe('retiring and restoring', () => {
  it('sends the loaded version, and says what a retirement does and does not do', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({ definition: { ...WORK, isActive: false, version: 4 }, sync: SYNCED })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Retire' }));

    expect(sent().url).toBe(slotDefinitionActiveEndpoint('life_work'));
    expect(sent().body).toEqual({ version: 3, isActive: false });
    expect(
      await screen.findByText(/every answer already given stays readable/)
    ).toBeInTheDocument();
  });

  it('restores a retired one', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({ definition: { ...RETIRED, isActive: true, version: 6 }, sync: SYNCED })
    );
    render(<SlotDefinitionsPanel initialView={{ ...VIEW, definitions: [RETIRED] }} />);

    await user.click(screen.getByRole('button', { name: 'Restore' }));

    expect(sent().body).toEqual({ version: 5, isActive: true });
  });
});

describe('the history', () => {
  it('reads it on demand and distinguishes a seeded version from an admin edit', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({
        slug: 'life_work',
        revisions: [
          {
            ...WORK,
            id: 'r2',
            slotSlug: 'life_work',
            version: 2,
            description: 'The newer wording.',
            changedFields: ['description'],
            origin: 'admin',
            editorId: 'admin-1',
            editorEmail: 'admin@example.com',
            changedAt: '2026-09-10T00:00:00.000Z',
          },
          {
            ...WORK,
            id: 'r1',
            slotSlug: 'life_work',
            version: 1,
            description: 'The original wording.',
            changedFields: ['group'],
            origin: 'seed',
            editorId: null,
            editorEmail: null,
            changedAt: '2026-09-01T00:00:00.000Z',
          },
        ],
      })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'History of life_work' }));

    const list = await screen.findByRole('list', { name: 'History of life_work' });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(slotDefinitionHistoryEndpoint('life_work'));
    expect(within(list).getByText('admin@example.com')).toBeInTheDocument();
    expect(within(list).getByText('seeded')).toBeInTheDocument();
    // v1 reads as the creation, not as a change to the fields it lists.
    expect(within(list).getByText('Created')).toBeInTheDocument();
    expect(within(list).getByText('The original wording.')).toBeInTheDocument();
  });
});

describe('exporting', () => {
  /**
   * Fetched, not linked. A plain `<a href download>` was the first shape and is
   * what the waitlist export still uses, but this route refuses in two cases —
   * and a link answers a refusal by saving the error envelope to disk, leaving
   * the page silent. The `unexportable` message names the rows at fault, so it
   * is the one that must reach a human.
   */
  it('fetches the file and hands it to the browser under the name the server gave it', async () => {
    const user = userEvent.setup();
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));

    fetchMock.mockResolvedValueOnce(
      new Response('{"taxonomy":{}}', {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'content-disposition': 'attachment; filename="lelanea-slot-taxonomy-2026-09-20.json"',
        },
      })
    );
    const clicked: { href: string; download: string }[] = [];
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push({ href: this.href, download: this.download });
    };
    try {
      await user.click(screen.getByRole('button', { name: /Download/ }));
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }

    expect(sent().url).toBe(SLOT_TAXONOMY_EXPORT_ENDPOINT);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe('lelanea-slot-taxonomy-2026-09-20.json');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows a refusal on the page instead of saving it to disk', async () => {
    // `unexportable`: a hand-edited classifier outside the vocabulary. The
    // message names the offending rows, which is the whole reason it has to be
    // read rather than downloaded.
    const user = userEvent.setup();
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));

    fetchMock.mockResolvedValueOnce(
      refused(
        409,
        'The stored taxonomy cannot be written as a file: slots.0.sensitivity — invalid value. Correct those definitions and export again.'
      )
    );
    await user.click(screen.getByRole('button', { name: /Download/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /slots\.0\.sensitivity — invalid value/
    );
  });

  it('says that retired data slots are left out, where the decision is made', async () => {
    // Someone exporting to take a backup needs to know before they click that
    // this is not one.
    const user = userEvent.setup();
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));

    expect(screen.getByText(/Retired ones are left out/)).toBeInTheDocument();
  });
});

describe('importing a taxonomy file', () => {
  const FILE = '{"taxonomy":{},"groups":[],"slots":[]}';

  async function openUpload(user: ReturnType<typeof userEvent.setup>) {
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    return screen.getByLabelText('Import a taxonomy file');
  }

  it('cannot apply until a preview has been read', async () => {
    const user = userEvent.setup();
    const textarea = await openUpload(user);

    expect(screen.getByRole('button', { name: 'Apply this file' })).toBeDisabled();

    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(sent().url).toBe(SLOT_TAXONOMY_UPLOAD_PREVIEW_ENDPOINT);
    expect(await screen.findByLabelText('What this file would do')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply this file' })).toBeEnabled();
  });

  it('takes the plan back down when the file changes, so apply cannot run against stale text', async () => {
    const user = userEvent.setup();
    const textarea = await openUpload(user);
    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByLabelText('What this file would do')).toBeInTheDocument();

    await user.type(textarea, ' ');

    expect(screen.queryByLabelText('What this file would do')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply this file' })).toBeDisabled();
  });

  it('names what a replace would retire before anything is applied', async () => {
    const user = userEvent.setup();
    const textarea = await openUpload(user);
    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(
      ok({
        plan: {
          ...EMPTY_PLAN,
          mode: 'replace',
          retirements: [{ slug: 'life_money' }],
          skippedRetired: ['life_old'],
        },
      })
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    const summary = await screen.findByLabelText('What this file would do');
    expect(summary).toHaveTextContent(/Would retire:\s*life_money/);
    expect(summary).toHaveTextContent(/Retired here, left alone:\s*life_old/);
    expect(summary).toHaveTextContent(/cannot say whether a data slot is retired/);
  });

  it('applies, then shows the plan that actually ran', async () => {
    const user = userEvent.setup();
    const textarea = await openUpload(user);
    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByLabelText('What this file would do');

    // Someone saved in between, so the applied plan is not the previewed one.
    const ran = { ...EMPTY_PLAN, creates: [{ slug: 'life_new' }] };
    fetchMock.mockResolvedValueOnce(ok({ plan: ran, sync: SYNCED }));
    fetchMock.mockResolvedValueOnce(ok(VIEW));
    await user.click(screen.getByRole('button', { name: 'Apply this file' }));

    expect(sent(1).url).toBe(SLOT_TAXONOMY_UPLOAD_ENDPOINT);
    expect(sent(1).body).toEqual({ mode: 'merge', file: JSON.parse(FILE) as unknown });
    expect(await screen.findByText(/1 added, 0 reworded, 0 retired/)).toBeInTheDocument();
    expect(await screen.findByText(/Would add:/)).toBeInTheDocument();
  });

  it('refuses text that is not JSON without troubling the server', async () => {
    const user = userEvent.setup();
    const textarea = await openUpload(user);
    await fill(user, textarea, 'not json');
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid JSON/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('adding a data slot', () => {
  async function openAdd(user: ReturnType<typeof userEvent.setup>) {
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add a data slot' }));
    return screen.getByRole('form', { name: 'Add a data slot' });
  }

  it('opens with sensible defaults: the first group, open, text, standard, 50', async () => {
    const user = userEvent.setup();
    const form = await openAdd(user);

    expect(within(form).getByRole('combobox', { name: 'Group' })).toHaveTextContent('life areas');
    expect(within(form).getByRole('combobox', { name: 'Visibility' })).toHaveTextContent(/Open/);
    expect(within(form).getByRole('combobox', { name: 'Answer type' })).toHaveTextContent('Text');
    expect(within(form).getByRole('combobox', { name: 'Sensitivity' })).toHaveTextContent(
      'Standard'
    );
    expect(within(form).getByLabelText('Asked how early')).toHaveValue(50);
  });

  it('trims the slug and sends priorityWeight as a number, not a string', async () => {
    const user = userEvent.setup();
    const form = await openAdd(user);
    fetchMock.mockResolvedValueOnce(
      ok({
        definition: { ...WORK, slug: 'life_new', description: 'New one.' },
        sync: SYNCED,
      })
    );

    await fill(user, within(form).getByLabelText('Slug'), '  life_new  ');
    await fill(user, within(form).getByLabelText('What it means'), 'New one.');
    await user.click(within(form).getByRole('button', { name: 'Add this data slot' }));

    expect(sent().url).toBe(SLOT_DEFINITIONS_ENDPOINT);
    expect(sent().method).toBe('POST');
    expect(sent().body).toEqual({
      slug: 'life_new',
      group: 'life_areas',
      description: 'New one.',
      visibility: 'open',
      dataType: 'text',
      sensitivity: 'standard',
      priorityWeight: 50,
    });
  });

  it('on success adds the slot to the list, closes the form, and names it in the notice', async () => {
    const user = userEvent.setup();
    const form = await openAdd(user);
    fetchMock.mockResolvedValueOnce(
      ok({
        definition: { ...WORK, slug: 'life_new', description: 'New one.', version: 1 },
        sync: SYNCED,
      })
    );

    await fill(user, within(form).getByLabelText('Slug'), 'life_new');
    await fill(user, within(form).getByLabelText('What it means'), 'New one.');
    await user.click(within(form).getByRole('button', { name: 'Add this data slot' }));

    expect(await screen.findByText('life_new')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Add a data slot' })).toBeNull();
    expect(await screen.findByText(/“life_new” added\./)).toBeInTheDocument();
  });

  it('shows the route’s retired-slug refusal verbatim and keeps the form open', async () => {
    // The route's own message names the remedy (restore, don't re-add) — a
    // generic "already exists" would send the admin to invent a slug variant.
    const user = userEvent.setup();
    const form = await openAdd(user);
    fetchMock.mockResolvedValueOnce(
      refused(
        409,
        'The slug "life_old" belongs to a retired definition. Restore it instead of adding it again — the answers already captured under it are still resolved through its history.'
      )
    );

    await fill(user, within(form).getByLabelText('Slug'), 'life_old');
    await fill(user, within(form).getByLabelText('What it means'), 'x');
    await user.click(within(form).getByRole('button', { name: 'Add this data slot' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Restore it instead of adding/);
    expect(screen.getByRole('form', { name: 'Add a data slot' })).toBeInTheDocument();
  });

  it('opens a new group section when the added slot belongs to a group not yet known', async () => {
    const user = userEvent.setup();
    const form = await openAdd(user);
    fetchMock.mockResolvedValueOnce(
      ok({
        definition: { ...WORK, slug: 'life_new', group: 'wellbeing', description: 'x' },
        sync: SYNCED,
      })
    );

    await fill(user, within(form).getByLabelText('Slug'), 'life_new');
    await fill(user, within(form).getByLabelText('What it means'), 'x');
    await user.click(within(form).getByRole('button', { name: 'Add this data slot' }));

    expect(await screen.findByRole('region', { name: 'wellbeing' })).toBeInTheDocument();
  });
});

describe('editing the classifier fields', () => {
  it('sends group, visibility, answer type, sensitivity and priority as edited — priority as a number', async () => {
    const user = userEvent.setup();
    const view = { seeded: true, groups: ['life_areas', 'wellbeing'], definitions: [WORK] };
    render(<SlotDefinitionsPanel initialView={view} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit life_work' });

    await user.click(within(form).getByRole('combobox', { name: 'Group' }));
    await user.click(await screen.findByRole('option', { name: 'wellbeing' }));

    await user.click(within(form).getByRole('combobox', { name: 'Visibility' }));
    await user.click(await screen.findByRole('option', { name: /Hidden/ }));

    await user.click(within(form).getByRole('combobox', { name: 'Answer type' }));
    await user.click(await screen.findByRole('option', { name: 'Number' }));

    await user.click(within(form).getByRole('combobox', { name: 'Sensitivity' }));
    await user.click(await screen.findByRole('option', { name: 'Special category' }));

    const priority = within(form).getByLabelText('Asked how early');
    await user.clear(priority);
    await user.type(priority, '85');

    fetchMock.mockResolvedValueOnce(
      ok({
        definition: { ...WORK, version: 4 },
        changed: ['group', 'visibility', 'dataType', 'sensitivity', 'priorityWeight'],
        sync: SYNCED,
      })
    );
    await user.click(within(form).getByRole('button', { name: 'Save v3' }));

    expect(sent().body).toEqual({
      group: 'wellbeing',
      description: WORK.description,
      visibility: 'hidden',
      dataType: 'number',
      sensitivity: 'special_category',
      priorityWeight: 85,
      version: 3,
    });
  });
});

describe('undoing a draft', () => {
  it('reverts the description to the loaded row and sends nothing', async () => {
    const user = userEvent.setup();
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const form = screen.getByRole('form', { name: 'Edit life_work' });
    const description = within(form).getByLabelText('What it means');

    await user.clear(description);
    await fill(user, description, 'A different wording entirely.');
    expect(description).toHaveValue('A different wording entirely.');

    await user.click(within(form).getByRole('button', { name: 'Undo my changes' }));

    expect(description).toHaveValue(WORK.description);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('a field-level validation refusal', () => {
  it('shows the specific field message, named by its field, not the generic top line', async () => {
    // This is the Zod path: `details.errors[0]` is what should be shown, not
    // the envelope's own top-line `message`. `path` is an already-joined string
    // — both producers build it with `issue.path.join('.')` — and naming it is
    // what makes a bare "Must be between 0 and 100." actionable.
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      refused(400, 'Validation failed', {
        errors: [{ path: 'priorityWeight', message: 'Must be between 0 and 100.' }],
      })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save v3' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('priorityWeight — Must be between 0 and 100.');
    expect(alert).not.toHaveTextContent('Validation failed');
  });

  it('leaves a refinement with no field path exactly as written', async () => {
    // The referential errors the upload's schema raises are self-describing
    // ("every slot must name a group declared in `groups`"); prefixing those
    // with an empty path would be noise.
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      refused(400, 'That is not a slot taxonomy file', {
        errors: [{ path: '', message: 'Every slot must name a group declared in `groups`.' }],
      })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save v3' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /^Every slot must name a group declared in `groups`\.$/
    );
  });
});

describe('a network failure', () => {
  it('is reported honestly, distinct from a route refusal', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValueOnce(new Error('fetch failed'));
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByRole('button', { name: 'Save v3' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The request did not reach the server. Nothing was changed.'
    );
  });
});

describe('retiring the last active slot', () => {
  it('warns that nothing is handed to the AI, distinct from a lagging projection', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      ok({ definition: { ...WORK, isActive: false, version: 4 }, sync: { status: 'empty' } })
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Retire' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Every data slot is now retired/);
    expect(alert).toHaveTextContent(/not propagated until another change is made/);
  });
});

describe('the history, when it fails to load', () => {
  it('reports the error and renders "No versions recorded." instead of spinning forever', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(500, 'The history could not be read.'));
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'History of life_work' }));

    expect(await screen.findByText('No versions recorded.')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('The history could not be read.');
  });
});

describe('a failed preview', () => {
  it('takes an existing plan back down, so Apply cannot run against a stale one', async () => {
    const user = userEvent.setup();
    const FILE = '{"taxonomy":{},"groups":[],"slots":[]}';
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    const textarea = screen.getByLabelText('Import a taxonomy file');

    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByLabelText('What this file would do')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply this file' })).toBeEnabled();

    fetchMock.mockResolvedValueOnce(refused(400, 'That file could not be reconciled.'));
    await user.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That file could not be reconciled.'
    );
    expect(screen.queryByLabelText('What this file would do')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply this file' })).toBeDisabled();
  });
});

describe('changing the reconcile mode', () => {
  it('takes the plan back down, the same as a change to the file itself', async () => {
    // The docblock at the top of this file claims a change to the file OR the
    // mode retires the plan — this proves the mode half, which nothing else
    // here exercises. An apply live against a plan built in `merge` while the
    // select now reads `replace` is exactly the silent retirement this pair
    // exists to prevent.
    const user = userEvent.setup();
    const FILE = '{"taxonomy":{},"groups":[],"slots":[]}';
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    const textarea = screen.getByLabelText('Import a taxonomy file');

    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByLabelText('What this file would do')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'How to reconcile it' }));
    await user.click(await screen.findByRole('option', { name: /Replace/ }));

    expect(screen.queryByLabelText('What this file would do')).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply this file' })).toBeDisabled();
  });
});

describe('a failed apply', () => {
  it('reports the error and does not claim success', async () => {
    const user = userEvent.setup();
    const FILE = '{"taxonomy":{},"groups":[],"slots":[]}';
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    const textarea = screen.getByLabelText('Import a taxonomy file');
    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByLabelText('What this file would do');

    fetchMock.mockResolvedValueOnce(refused(500, 'The taxonomy could not be applied.'));
    await user.click(screen.getByRole('button', { name: 'Apply this file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The taxonomy could not be applied.'
    );
    expect(screen.queryByText(/added, .* reworded, .* retired/)).toBeNull();
  });
});

describe('the add and import panels', () => {
  it('close each other, so only one is open at a time', async () => {
    const user = userEvent.setup();
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Add a data slot' }));
    expect(screen.getByRole('form', { name: 'Add a data slot' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    expect(screen.queryByRole('form', { name: 'Add a data slot' })).toBeNull();
    expect(screen.getByLabelText('Import a taxonomy file')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add a data slot' }));
    expect(screen.queryByLabelText('Import a taxonomy file')).toBeNull();
    expect(screen.getByRole('form', { name: 'Add a data slot' })).toBeInTheDocument();
  });
});

describe('a failed retirement', () => {
  it('reports the message and leaves the row as it was', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(
      refused(409, '"life_work" was changed by someone else since you opened it.')
    );
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Retire' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/changed by someone else/);
    // Still showing "Retire" — the row was never flipped to retired.
    expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});

describe('after a successful apply', () => {
  async function previewAndApply(user: ReturnType<typeof userEvent.setup>) {
    const FILE = '{"taxonomy":{},"groups":[],"slots":[]}';
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    const textarea = screen.getByLabelText('Import a taxonomy file');
    await fill(user, textarea, FILE);
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByLabelText('What this file would do');
  }

  it('re-reads the taxonomy and reflects what the reload returned', async () => {
    const user = userEvent.setup();
    await previewAndApply(user);

    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN, sync: SYNCED }));
    const reloaded = {
      seeded: true,
      groups: ['life_areas'],
      definitions: [{ ...WORK, description: 'Reloaded from the server.' }],
    };
    fetchMock.mockResolvedValueOnce(ok(reloaded));
    await user.click(screen.getByRole('button', { name: 'Apply this file' }));

    expect(await screen.findByText('Reloaded from the server.')).toBeInTheDocument();
    expect(sent(2).url).toBe(SLOT_DEFINITIONS_ENDPOINT);
    expect(sent(2).method).toBe('GET');
  });

  it('reports the error when the reload itself fails', async () => {
    const user = userEvent.setup();
    await previewAndApply(user);

    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN, sync: SYNCED }));
    fetchMock.mockResolvedValueOnce(refused(500, 'The taxonomy could not be reloaded.'));
    await user.click(screen.getByRole('button', { name: 'Apply this file' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The taxonomy could not be reloaded.'
    );
  });
});

describe('an edit form left open while the taxonomy moves underneath it', () => {
  /**
   * The lock's one remaining hole, and the reason the version is snapshotted at
   * mount rather than read off the live row.
   *
   * Opening the import panel does not close an open edit form, so an admin can
   * have a half-typed reword on screen while an upload rewords the same slug.
   * The list then re-reads at the new version — but the form still holds the
   * draft made from the OLD wording. Sending the new version with the old draft
   * is a write the route cannot refuse: it is the lost update `versionMoved`
   * exists to prevent, arriving through the one door the lock does not watch.
   *
   * What must be sent is the version the draft was derived from, so the route
   * answers 409 and the admin is told to read it again.
   */
  it('sends the version its draft was made from, not the one the import left behind', async () => {
    const user = userEvent.setup();
    render(<SlotDefinitionsPanel initialView={VIEW} />);

    // A half-typed reword of life_work, which stands at v3.
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const description = screen.getByLabelText('What it means');
    await user.clear(description);
    await fill(user, description, 'My own wording, not yet saved.');

    // The import panel opens without closing that form.
    await user.click(screen.getByRole('button', { name: 'Import / export' }));
    await fill(
      user,
      screen.getByLabelText('Import a taxonomy file'),
      '{"taxonomy":{},"groups":[],"slots":[]}'
    );
    fetchMock.mockResolvedValueOnce(ok({ plan: EMPTY_PLAN }));
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByLabelText('What this file would do');

    // The file rewords life_work: it is v4 now, carrying the file's wording.
    const reworded = { ...WORK, description: 'The wording the file brought.', version: 4 };
    fetchMock.mockResolvedValueOnce(
      ok({
        plan: { ...EMPTY_PLAN, updates: [{ slug: 'life_work', changedFields: ['description'] }] },
        sync: SYNCED,
      })
    );
    fetchMock.mockResolvedValueOnce(ok({ ...VIEW, definitions: [reworded] }));
    await user.click(screen.getByRole('button', { name: 'Apply this file' }));
    await screen.findByText(/0 added, 1 reworded, 0 retired/);

    // The form is still open on the stale draft. Saving it must name v3.
    fetchMock.mockResolvedValueOnce(
      refused(409, '“life_work” was changed by someone else since you opened it.')
    );
    await user.click(screen.getByRole('button', { name: /^Save v/ }));

    const save = sent(3);
    expect(save.method).toBe('PUT');
    expect(save.body).toMatchObject({
      version: 3,
      description: 'My own wording, not yet saved.',
    });
    // And the admin is told, rather than silently overwriting the import.
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed by someone else/);
  });
});
