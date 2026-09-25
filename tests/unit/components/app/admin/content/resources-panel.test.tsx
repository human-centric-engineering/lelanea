// @vitest-environment happy-dom

/**
 * The resource library editor (f-content-seeds t-91): the library's own
 * fields and sign-off, every video and article (live and retired), reordering,
 * adding, and her words per key.
 *
 * What is proved here is what the admin sees and what the browser sends —
 * never what the route decides (that is the route's test) nor what the store
 * writes (the store's).
 *
 * @see components/app/admin/content/resources-panel.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ResourcesPanel } from '@/components/app/admin/content/resources-panel';
import {
  contentEntityEndpoint,
  contentItemEndpoint,
  contentOrderEndpoint,
  contentRetiredEndpoint,
} from '@/lib/app/content/admin/endpoint';
import { createMockRouter } from '@/tests/types/mocks';
import type { ResourceAdminRow, ResourcesAdminView } from '@/lib/app/content/admin/resources';

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

function sent(index = 0) {
  const call = fetchMock.mock.calls[index] as [string, RequestInit & { body?: string }];
  return {
    url: call[0],
    method: call[1].method,
    body: call[1].body === undefined ? undefined : (JSON.parse(call[1].body) as unknown),
  };
}

const READERS = ['the resource drawer (/api/v1/app/content/resources)'];

const VIDEO1: ResourceAdminRow = {
  id: 'the_call',
  kind: 'video',
  position: 1,
  title: 'The Call',
  subtitle: 'A short video on beginnings.',
  relatesTo: null,
  duration: '6:12',
  readingTime: null,
  href: 'https://example.com/the-call',
  documentId: null,
  retired: false,
  revision: 2,
};

const VIDEO2: ResourceAdminRow = {
  id: 'second_wind',
  kind: 'video',
  position: 2,
  title: 'Second Wind',
  subtitle: 'For when it gets hard.',
  relatesTo: 'module_01_a',
  duration: '4:45',
  readingTime: null,
  href: 'https://example.com/second-wind',
  documentId: null,
  retired: false,
  revision: 1,
};

const OLD_VIDEO: ResourceAdminRow = {
  id: 'old_video',
  kind: 'video',
  position: -1,
  title: 'Old Video',
  subtitle: 'Retired now.',
  relatesTo: 'module_01_a',
  duration: '3:00',
  readingTime: null,
  href: 'https://example.com/old',
  documentId: null,
  retired: true,
  revision: 4,
};

const ARTICLE1: ResourceAdminRow = {
  id: 'her_words',
  kind: 'article',
  position: 1,
  title: 'Her Words',
  subtitle: 'A short read.',
  relatesTo: null,
  duration: null,
  readingTime: '8 min',
  href: null,
  documentId: 'the_initiation',
  retired: false,
  revision: 1,
};

const WORDS_DEFAULT = {
  key: 'default',
  quote: 'Begin where you are.',
  paragraphs: ['Para one.', 'Para two.'],
  sourceCollection: 'foundational_documents' as const,
  sourceId: 'the_initiation',
  revision: 1,
};

const WORDS_MODULE = {
  key: 'module_01_a',
  quote: 'Specific words for this module.',
  paragraphs: ['Only paragraph.'],
  sourceCollection: 'values_module' as const,
  sourceId: 'step_1',
  revision: 2,
};

const COLLECTION = {
  id: 'lelanea_resources',
  title: 'Resource Library',
  version: '1.0',
  locale: 'en-US',
  provenance: {
    status: 'draft' as const,
    awaitingSignOffFrom: 'Her',
    note: 'Still a draft list.',
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const VIEW: ResourcesAdminView = {
  seeded: true,
  collection: COLLECTION,
  resources: [VIDEO1, VIDEO2, OLD_VIDEO, ARTICLE1],
  words: [WORDS_DEFAULT, WORDS_MODULE],
  relatesToOptions: ['module_01_a', 'journey', 'situations'],
  wordsKeyOptions: ['default', 'module_01_a', 'module_02_b', 'journey', 'situations'],
  documentIds: ['the_initiation', 'the_mission'],
  readers: READERS,
};

beforeEach(() => {
  fetchMock.mockReset();
  mockRouter.refresh.mockClear();
});

/** The edit modal for one item, found by the title it is named for. */
function editor(title: string): ReturnType<typeof within> {
  return within(screen.getByRole('dialog', { name: title }));
}

describe('before the seed has run', () => {
  it('says so, and offers nothing to edit', () => {
    render(
      <ResourcesPanel
        initialView={{
          seeded: false,
          collection: null,
          resources: [],
          words: [],
          relatesToOptions: [],
          wordsKeyOptions: [],
          documentIds: [],
          readers: [],
        }}
      />
    );

    expect(screen.getByText(/has not been seeded yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a video/ })).toBeNull();
  });
});

describe('the library', () => {
  it('saves title, version, locale and provenance in one PUT', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'] }));
    render(<ResourcesPanel initialView={VIEW} />);

    const title = screen.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'The Lelañea Library');

    const version = screen.getByLabelText('Version');
    await user.clear(version);
    await user.type(version, '1.1');

    const locale = screen.getByLabelText('Locale');
    await user.clear(locale);
    await user.type(locale, 'en-GB');

    await user.selectOptions(screen.getByLabelText('Sign-off'), 'signed_off');

    const awaiting = screen.getByLabelText('Awaiting sign-off from');
    await user.clear(awaiting);
    await user.type(awaiting, 'Nobody now');

    const note = screen.getByLabelText('Provenance note');
    await user.clear(note);
    await user.type(note, 'Signed off at last.');

    await user.click(screen.getByRole('button', { name: 'Save library' }));

    expect(sent().url).toBe(contentItemEndpoint('resources', 'collection', 'lelanea_resources'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      title: 'The Lelañea Library',
      version: '1.1',
      locale: 'en-GB',
      provenance: {
        status: 'signed_off',
        awaitingSignOffFrom: 'Nobody now',
        note: 'Signed off at last.',
      },
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await screen.findByText('Saved the library.')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('refills from a newer library after a refresh, so a save cannot put old values back', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['locale'] }));
    const { rerender } = render(<ResourcesPanel initialView={VIEW} />);

    // An import retitled the library; the refresh brings the new row and lock.
    const imported = {
      ...VIEW,
      collection: {
        ...COLLECTION,
        title: 'Imported title',
        updatedAt: '2026-02-02T00:00:00.000Z',
      },
    };
    rerender(<ResourcesPanel initialView={imported} />);
    expect(screen.getByLabelText('Title')).toHaveValue('Imported title');

    const locale = screen.getByLabelText('Locale');
    await user.clear(locale);
    await user.type(locale, 'en-GB');
    await user.click(screen.getByRole('button', { name: 'Save library' }));

    expect(sent().body).toMatchObject({
      title: 'Imported title',
      locale: 'en-GB',
      updatedAt: '2026-02-02T00:00:00.000Z',
    });
  });

  it('says plainly when nothing changed', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<ResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save library' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s refusal', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'Someone else changed the library.'));
    render(<ResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Save library' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed the library.');
  });
});

describe('the videos and articles lists', () => {
  it('shows each live one under its heading, and retired ones tucked away, separately', () => {
    render(<ResourcesPanel initialView={VIEW} />);

    expect(screen.getByText('Videos (2)')).toBeInTheDocument();
    expect(screen.getByText('Articles (1)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'The Call' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Second Wind' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Her Words' })).toBeInTheDocument();

    // Retired ones are inside a details/summary, counted on their own.
    expect(screen.getByText('Retired videos (1)')).toBeInTheDocument();
  });
});

describe('editing a resource', () => {
  async function openTheCall(user: ReturnType<typeof userEvent.setup>) {
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'The Call' }));
    return editor('The Call');
  }

  it('saves title, subtitle, relatesTo, length and link for a video', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['title'] }));
    const dialog = await openTheCall(user);

    const title = dialog.getByLabelText('Title');
    await user.clear(title);
    await user.type(title, 'The Call, reworded');

    const subtitle = dialog.getByLabelText('What it is for');
    await user.clear(subtitle);
    await user.type(subtitle, 'A new one-liner.');

    await user.selectOptions(dialog.getByLabelText('Belongs to'), 'module_01_a');

    const length = dialog.getByLabelText('Length (m:ss)');
    await user.clear(length);
    await user.type(length, '7:00');

    const href = dialog.getByLabelText('Link');
    await user.clear(href);
    await user.type(href, 'https://example.com/the-call-2');

    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(sent().url).toBe(contentItemEndpoint('resources', 'resource', 'the_call'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      revision: 2,
      kind: 'video',
      title: 'The Call, reworded',
      subtitle: 'A new one-liner.',
      relatesTo: 'module_01_a',
      duration: '7:00',
      href: 'https://example.com/the-call-2',
    });
    expect(await screen.findByText('Saved "The Call, reworded".')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('sends null relatesTo when "everything" is chosen', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Second Wind' }));
    const dialog = editor('Second Wind');

    await user.selectOptions(dialog.getByLabelText('Belongs to'), '');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(sent().body).toMatchObject({ relatesTo: null });
  });

  it('says plainly when a resource save changed nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    const dialog = await openTheCall(user);

    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s refusal for a resource save', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'The resource moved under you.'));
    const dialog = await openTheCall(user);

    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The resource moved under you.');
  });

  it('saves an article that opens one of her documents, with no link field shown', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['readingTime'] }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Her Words' }));
    const dialog = editor('Her Words');

    expect(dialog.queryByLabelText('Link')).toBeNull();
    expect(dialog.getByLabelText('Opens a document')).toHaveValue('the_initiation');

    const length = dialog.getByLabelText('Reading time');
    await user.clear(length);
    await user.type(length, '9 min');
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(sent().body).toEqual({
      revision: 1,
      kind: 'article',
      title: 'Her Words',
      subtitle: 'A short read.',
      relatesTo: null,
      readingTime: '9 min',
      documentId: 'the_initiation',
    });
  });

  it('switching an article to "none: a link" reveals the link field and saves by href', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['href'] }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Her Words' }));
    const dialog = editor('Her Words');

    await user.selectOptions(dialog.getByLabelText('Opens a document'), '');
    const href = dialog.getByLabelText('Link');
    await user.type(href, 'https://example.com/her-words');

    await user.click(dialog.getByRole('button', { name: 'Save' }));

    expect(sent().body).toEqual({
      revision: 1,
      kind: 'article',
      title: 'Her Words',
      subtitle: 'A short read.',
      relatesTo: null,
      readingTime: '8 min',
      href: 'https://example.com/her-words',
    });
  });
});

describe('retiring and bringing back a resource', () => {
  it('retires a live resource against its own revision, and says what that does and does not do', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'The Call' }));

    await user.click(screen.getByRole('button', { name: 'Retire' }));

    expect(sent().url).toBe(contentRetiredEndpoint('resources', 'resource', 'the_call'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({ retired: true, revision: 2 });
    expect(
      await screen.findByText(/Retired "The Call"\. It is no longer offered or suggested/)
    ).toBeInTheDocument();
  });

  it('brings a retired resource back, at the end of its kind', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<ResourcesPanel initialView={VIEW} />);

    const summary = screen.getByText('Retired videos (1)');
    await user.click(summary);
    await user.click(screen.getByRole('button', { name: 'Old Video' }));
    await user.click(screen.getByRole('button', { name: 'Bring back' }));

    expect(sent().url).toBe(contentRetiredEndpoint('resources', 'resource', 'old_video'));
    expect(sent().body).toEqual({ retired: false, revision: 4 });
    expect(
      await screen.findByText(/Brought back "Old Video", at the end of the videos\./)
    ).toBeInTheDocument();
  });

  it('reports an error and leaves the resource as it was', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'The resource moved under you.'));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'The Call' }));

    await user.click(screen.getByRole('button', { name: 'Retire' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The resource moved under you.');
    expect(screen.getByRole('button', { name: 'Retire' })).toBeInTheDocument();
  });
});

describe('reordering', () => {
  it('moving the second video up sends the swapped order, kind included', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ moved: 2 }));
    render(<ResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Move Second Wind up' }));

    expect(sent().url).toBe(contentOrderEndpoint('resources'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      kind: 'video',
      order: [
        { id: 'second_wind', revision: 1 },
        { id: 'the_call', revision: 2 },
      ],
    });
    expect(await screen.findByText('Saved the new order of videos.')).toBeInTheDocument();
  });

  it('does not offer reorder arrows on a retired resource', async () => {
    const user = userEvent.setup();
    render(<ResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByText('Retired videos (1)'));

    expect(screen.queryByRole('button', { name: 'Move Old Video up' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move Old Video down' })).toBeNull();
  });

  it('reports an error from a failed reorder', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(500, 'The order could not be saved.'));
    render(<ResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Move Second Wind up' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The order could not be saved.');
  });
});

describe('adding a resource', () => {
  it('adds a video, sending its id and fields', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ id: 'a_new_video' }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add a video' }));
    const form = screen.getByLabelText('Id').closest('.rounded-md.border.p-3') as HTMLElement;

    await user.type(within(form).getByLabelText('Id'), 'a_new_video');
    await user.type(within(form).getByLabelText('Title'), 'A New Video');
    await user.type(within(form).getByLabelText('What it is for'), 'A fresh one.');
    await user.selectOptions(within(form).getByLabelText('Belongs to'), 'journey');
    await user.type(within(form).getByLabelText('Length (m:ss)'), '2:30');
    await user.type(within(form).getByLabelText('Link'), 'https://example.com/new-video');

    await user.click(within(form).getByRole('button', { name: 'Add' }));

    expect(sent().url).toBe(contentEntityEndpoint('resources', 'resource'));
    expect(sent().method).toBe('POST');
    expect(sent().body).toEqual({
      id: 'a_new_video',
      kind: 'video',
      title: 'A New Video',
      subtitle: 'A fresh one.',
      relatesTo: 'journey',
      duration: '2:30',
      href: 'https://example.com/new-video',
    });
    expect(screen.queryByLabelText('Id')).toBeNull();
    expect(
      await screen.findByText('Added "A New Video" at the end of the videos.')
    ).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('adds an article by document, with no link field to fill', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ id: 'a_new_article' }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add an article' }));
    const form = screen.getByLabelText('Id').closest('.rounded-md.border.p-3') as HTMLElement;

    await user.type(within(form).getByLabelText('Id'), 'a_new_article');
    await user.type(within(form).getByLabelText('Title'), 'A New Article');
    await user.type(within(form).getByLabelText('What it is for'), 'Worth reading.');
    await user.selectOptions(within(form).getByLabelText('Opens a document'), 'the_mission');
    await user.type(within(form).getByLabelText('Reading time'), '5 min');

    expect(within(form).queryByLabelText('Link')).toBeNull();
    await user.click(within(form).getByRole('button', { name: 'Add' }));

    expect(sent().body).toEqual({
      id: 'a_new_article',
      kind: 'article',
      title: 'A New Article',
      subtitle: 'Worth reading.',
      relatesTo: null,
      readingTime: '5 min',
      documentId: 'the_mission',
    });
  });

  it('adds an article by link when no document is chosen', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ id: 'a_new_article' }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add an article' }));
    const form = screen.getByLabelText('Id').closest('.rounded-md.border.p-3') as HTMLElement;

    await user.type(within(form).getByLabelText('Id'), 'a_new_article');
    await user.type(within(form).getByLabelText('Title'), 'A New Article');
    await user.type(within(form).getByLabelText('What it is for'), 'Worth reading.');
    await user.type(within(form).getByLabelText('Reading time'), '5 min');
    await user.type(within(form).getByLabelText('Link'), 'https://example.com/new-article');

    await user.click(within(form).getByRole('button', { name: 'Add' }));

    expect(sent().body).toEqual({
      id: 'a_new_article',
      kind: 'article',
      title: 'A New Article',
      subtitle: 'Worth reading.',
      relatesTo: null,
      readingTime: '5 min',
      href: 'https://example.com/new-article',
    });
  });

  it('cancel closes the form without sending anything', async () => {
    const user = userEvent.setup();
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add a video' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Id')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the form open and reports the route’s refusal on failure', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(400, 'That id is already taken.'));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Add a video' }));
    const form = screen.getByLabelText('Id').closest('.rounded-md.border.p-3') as HTMLElement;
    await user.type(within(form).getByLabelText('Id'), 'the_call');

    await user.click(within(form).getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('That id is already taken.');
    expect(screen.getByLabelText('Id')).toBeInTheDocument();
  });
});

describe('words, by key', () => {
  it('saves a quote, paragraphs and source for a non-default key', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: ['quote'] }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'module_01_a' }));

    const quote = screen.getByLabelText('Quote');
    await user.clear(quote);
    await user.type(quote, 'A reworded quote.');

    const paragraphs = screen.getByLabelText('Paragraphs');
    await user.clear(paragraphs);
    await paragraphsType(user, paragraphs, 'First paragraph.\n\nSecond paragraph.');

    await user.selectOptions(screen.getByLabelText('Source collection'), 'foundational_documents');
    const sourceId = screen.getByLabelText('Source id');
    await user.clear(sourceId);
    await user.type(sourceId, 'the_mission');

    await user.click(screen.getByRole('button', { name: 'Save words' }));

    expect(sent().url).toBe(contentItemEndpoint('resources', 'words', 'module_01_a'));
    expect(sent().method).toBe('PUT');
    expect(sent().body).toEqual({
      revision: 2,
      quote: 'A reworded quote.',
      paragraphs: ['First paragraph.', 'Second paragraph.'],
      source: { collection: 'foundational_documents', id: 'the_mission' },
    });
    expect(await screen.findByText('Saved the words for module_01_a.')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('says plainly when a words save changed nothing', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ changed: [] }));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'module_01_a' }));

    await user.click(screen.getByRole('button', { name: 'Save words' }));

    expect(await screen.findByText('Nothing had changed.')).toBeInTheDocument();
  });

  it('shows the route’s refusal for a words save', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(400, 'The quote is required.'));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'module_01_a' }));

    await user.click(screen.getByRole('button', { name: 'Save words' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The quote is required.');
  });

  it('removes a non-default key, falling back to the default', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok(null));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'module_01_a' }));

    await user.click(screen.getByRole('button', { name: /Remove \(falls back to the default\)/ }));

    expect(sent().url).toBe(
      `${contentItemEndpoint('resources', 'words', 'module_01_a')}?revision=2`
    );
    expect(sent().method).toBe('DELETE');
    expect(
      await screen.findByText('Removed the words for module_01_a. It now shows the default words.')
    ).toBeInTheDocument();
  });

  it('does not offer to remove the default words', async () => {
    const user = userEvent.setup();
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'default' }));

    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.getByText(/The default words cannot be removed/)).toBeInTheDocument();
  });

  it('reports an error from a failed words removal', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(refused(409, 'The words moved under you.'));
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'module_01_a' }));

    await user.click(screen.getByRole('button', { name: /Remove \(falls back to the default\)/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The words moved under you.');
  });

  it('offers to give a free key words of its own, and posts them', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce(ok({ id: 'module_02_b' }));
    render(<ResourcesPanel initialView={VIEW} />);

    await user.click(screen.getByRole('button', { name: 'Give a key words of its own' }));
    const addForm = screen.getByLabelText('Key').closest('.rounded-md.border.p-3') as HTMLElement;

    await user.selectOptions(within(addForm).getByLabelText('Key'), 'module_02_b');
    await user.type(within(addForm).getByLabelText('Quote'), 'New words.');
    await paragraphsType(
      user,
      within(addForm).getByLabelText('Paragraphs'),
      'Only paragraph here.'
    );
    await user.selectOptions(within(addForm).getByLabelText('Source collection'), 'values_module');
    await user.type(within(addForm).getByLabelText('Source id'), 'step_2');

    await user.click(within(addForm).getByRole('button', { name: 'Add words' }));

    expect(sent().url).toBe(contentEntityEndpoint('resources', 'words'));
    expect(sent().method).toBe('POST');
    expect(sent().body).toEqual({
      key: 'module_02_b',
      quote: 'New words.',
      paragraphs: ['Only paragraph here.'],
      source: { collection: 'values_module', id: 'step_2' },
    });
    expect(await screen.findByText('Added words for module_02_b.')).toBeInTheDocument();
    expect(mockRouter.refresh).toHaveBeenCalled();
  });

  it('cancel closes the add-words form without sending anything', async () => {
    const user = userEvent.setup();
    render(<ResourcesPanel initialView={VIEW} />);
    await user.click(screen.getByRole('button', { name: 'Give a key words of its own' }));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText('Key')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not offer the add-words button once every key has its own words', () => {
    render(
      <ResourcesPanel
        initialView={{
          ...VIEW,
          wordsKeyOptions: ['default', 'module_01_a'],
        }}
      />
    );

    expect(screen.queryByRole('button', { name: 'Give a key words of its own' })).toBeNull();
  });
});

/** `user.type` reads a bare newline as Enter, which a real person cannot type
 * into a textarea either — paste the whole block instead. */
async function paragraphsType(
  user: ReturnType<typeof userEvent.setup>,
  field: HTMLElement,
  text: string
) {
  await user.click(field);
  await user.paste(text);
}
