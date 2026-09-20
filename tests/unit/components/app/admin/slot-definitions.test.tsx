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

describe('uploading a taxonomy file', () => {
  const FILE = '{"taxonomy":{},"groups":[],"slots":[]}';

  async function openUpload(user: ReturnType<typeof userEvent.setup>) {
    render(<SlotDefinitionsPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Upload a taxonomy file' }));
    return screen.getByLabelText('Taxonomy file');
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
    expect(summary).toHaveTextContent(/cannot say whether a slot is retired/);
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
