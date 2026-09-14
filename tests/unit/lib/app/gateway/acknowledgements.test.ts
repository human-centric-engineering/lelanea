/**
 * The acknowledgement ledger: what is required, what one person has satisfied,
 * and how a repeat is answered.
 *
 * The content loader is REAL — the required versions come from the authored
 * collection on disk, so a version bump in the file changes what these cases
 * see. Prisma is a stub: the cases assert the queries the module issues and
 * how it reads what comes back, not what Postgres would do with them (the
 * unique index that makes a repeat idempotent is pinned by the migration and
 * exercised at the route level as a P2002).
 *
 * FORK NOTE — this reads `lib/app/content` for real, not through a mock. The
 * required versions ARE the authored collection's version, so mocking the
 * loader would turn the re-gate cases into assertions about a constant this
 * file wrote. A fork with its own content file should expect `COLLECTION_VERSION`
 * to read theirs, and the mapping case to demand a kind for every document
 * they mark `requiresAcknowledgement`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { create, findUnique, findMany, mockLogger } = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/db/client', () => ({
  prisma: { appAcknowledgement: { create, findUnique, findMany } },
}));
vi.mock('@/lib/logging', () => ({ logger: mockLogger }));

import {
  ACKNOWLEDGEMENT_KINDS,
  AGE_18_VERSION,
  DOCUMENT_FOR_KIND,
  findAcknowledgementsForSubject,
  getGateStatus,
  getRequiredVersions,
  listAcknowledgementRequiredDocumentIds,
  recordAcknowledgement,
} from '@/lib/app/gateway/acknowledgements';
import { getFoundationalCollectionMeta, listFoundationalDocuments } from '@/lib/app/content';

/** The version the two documents currently require — read, not written down. */
const COLLECTION_VERSION = getFoundationalCollectionMeta().version;

const AT = new Date('2026-09-14T10:00:00.000Z');

function row(kind: string, documentVersion: string, acknowledgedAt = AT) {
  return { kind, documentVersion, acknowledgedAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});

describe('what is required', () => {
  it('requires the collection version for both documents and the age constant', () => {
    expect(getRequiredVersions()).toEqual({
      disclaimer: COLLECTION_VERSION,
      terms: COLLECTION_VERSION,
      age_18: AGE_18_VERSION,
    });
    // Population: the version is a real authored string, not an empty default.
    expect(COLLECTION_VERSION).toMatch(/\S/);
  });

  it('has a kind for EVERY document the authored file says must be acknowledged', () => {
    // The mapping is explicit (the kind is a database enum); this is the other
    // direction. An author adding `requiresAcknowledgement: true` to a third
    // document would otherwise ship a document nobody is ever asked to agree to.
    const required = listAcknowledgementRequiredDocumentIds().sort();
    expect(required.length).toBeGreaterThan(0);
    expect(required).toEqual(Object.values(DOCUMENT_FOR_KIND).sort());
  });

  it('maps each document kind to a document that exists', () => {
    const ids = new Set(listFoundationalDocuments().documents.map((document) => document.id));
    for (const documentId of Object.values(DOCUMENT_FOR_KIND)) {
      expect(ids.has(documentId), `${documentId} is not in the collection`).toBe(true);
    }
  });

  it('presents the kinds in reading order: disclaimer, terms, then age', () => {
    expect([...ACKNOWLEDGEMENT_KINDS]).toEqual(['disclaimer', 'terms', 'age_18']);
  });
});

describe('getGateStatus', () => {
  it('reports every kind outstanding for someone with no rows', async () => {
    const status = await getGateStatus('user-1');

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1' } }));
    expect(status.complete).toBe(false);
    expect(status.outstanding).toEqual(['disclaimer', 'terms', 'age_18']);
    expect(status.kinds.map((kind) => kind.satisfied)).toEqual([false, false, false]);
    expect(status.kinds.map((kind) => kind.acknowledgedAt)).toEqual([null, null, null]);
  });

  it('names the document behind each document kind and none behind age', async () => {
    const status = await getGateStatus('user-1');

    expect(status.kinds.map((kind) => [kind.kind, kind.documentId])).toEqual([
      ['disclaimer', 'disclaimer'],
      ['terms', 'terms_of_use'],
      ['age_18', null],
    ]);
    expect(status.kinds.map((kind) => kind.requiredVersion)).toEqual([
      COLLECTION_VERSION,
      COLLECTION_VERSION,
      AGE_18_VERSION,
    ]);
  });

  it('is complete once every kind has a row at the CURRENT version', async () => {
    findMany.mockResolvedValue([
      row('disclaimer', COLLECTION_VERSION),
      row('terms', COLLECTION_VERSION),
      row('age_18', AGE_18_VERSION),
    ]);

    const status = await getGateStatus('user-1');

    expect(status.complete).toBe(true);
    expect(status.outstanding).toEqual([]);
    expect(status.kinds.every((kind) => kind.acknowledgedAt?.getTime() === AT.getTime())).toBe(
      true
    );
  });

  it('re-gates ONLY the document kinds when a row is against a superseded version', async () => {
    // The re-gate rule. A person who agreed to version N is asked again when
    // the collection moves to N+1 — but their age confirmation is against the
    // age constant, which did not move, so it stands.
    findMany.mockResolvedValue([
      row('disclaimer', `${COLLECTION_VERSION}-old`),
      row('terms', `${COLLECTION_VERSION}-old`),
      row('age_18', AGE_18_VERSION),
    ]);

    const status = await getGateStatus('user-1');

    expect(status.complete).toBe(false);
    expect(status.outstanding).toEqual(['disclaimer', 'terms']);
    const age = status.kinds.find((kind) => kind.kind === 'age_18');
    expect(age?.satisfied).toBe(true);
    // The superseded rows are not reported as acknowledgements of the current
    // version — `acknowledgedAt` is null, not the old date.
    const disclaimer = status.kinds.find((kind) => kind.kind === 'disclaimer');
    expect(disclaimer?.acknowledgedAt).toBeNull();
  });

  it('is satisfied by the current-version row even when older rows sit beside it', async () => {
    const earlier = new Date('2026-01-01T00:00:00.000Z');
    findMany.mockResolvedValue([
      row('disclaimer', `${COLLECTION_VERSION}-old`, earlier),
      row('disclaimer', COLLECTION_VERSION),
    ]);

    const status = await getGateStatus('user-1');
    const disclaimer = status.kinds.find((kind) => kind.kind === 'disclaimer');

    expect(disclaimer?.satisfied).toBe(true);
    expect(disclaimer?.acknowledgedAt).toEqual(AT);
  });
});

describe('recordAcknowledgement', () => {
  it('inserts against the CURRENT version, never one the caller names', async () => {
    create.mockResolvedValue({
      id: 'ack-1',
      kind: 'terms',
      documentVersion: COLLECTION_VERSION,
      acknowledgedAt: AT,
    });

    const result = await recordAcknowledgement('user-1', 'terms');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user-1', kind: 'terms', documentVersion: COLLECTION_VERSION },
      })
    );
    expect(result).toEqual({
      created: true,
      row: { id: 'ack-1', kind: 'terms', documentVersion: COLLECTION_VERSION, acknowledgedAt: AT },
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('records the age confirmation against the age constant', async () => {
    create.mockResolvedValue({
      id: 'ack-2',
      kind: 'age_18',
      documentVersion: AGE_18_VERSION,
      acknowledgedAt: AT,
    });

    await recordAcknowledgement('user-1', 'age_18');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { userId: 'user-1', kind: 'age_18', documentVersion: AGE_18_VERSION },
      })
    );
  });

  it('answers a repeat with the EXISTING row and its original timestamp', async () => {
    const first = new Date('2026-03-01T00:00:00.000Z');
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue({
      id: 'ack-1',
      kind: 'terms',
      documentVersion: COLLECTION_VERSION,
      acknowledgedAt: first,
    });

    const result = await recordAcknowledgement('user-1', 'terms');

    expect(result.created).toBe(false);
    expect(result.row.acknowledgedAt).toEqual(first);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_kind_documentVersion: {
            userId: 'user-1',
            kind: 'terms',
            documentVersion: COLLECTION_VERSION,
          },
        },
      })
    );
  });

  it('lets every other database failure through', async () => {
    create.mockRejectedValue({ code: 'P2003' });

    await expect(recordAcknowledgement('user-1', 'terms')).rejects.toEqual({ code: 'P2003' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('fails rather than inventing a row if the repeat vanished before the re-read', async () => {
    create.mockRejectedValue({ code: 'P2002' });
    findUnique.mockResolvedValue(null);

    await expect(recordAcknowledgement('user-1', 'terms')).rejects.toThrow(/vanished/);
  });
});

describe('findAcknowledgementsForSubject', () => {
  it('returns every row for the user, oldest first, with no version filter', async () => {
    const rows = [row('terms', '0.9'), row('terms', COLLECTION_VERSION)];
    findMany.mockResolvedValue(rows);

    const found = await findAcknowledgementsForSubject({ userId: 'user-1' });

    expect(found).toEqual(rows);
    const args = findMany.mock.calls[0]?.[0] as { where: unknown; orderBy: unknown };
    expect(args.where).toEqual({ userId: 'user-1' });
    expect(args.orderBy).toEqual({ acknowledgedAt: 'asc' });
    // Art. 15 is about what we HOLD: superseded versions are still held.
    expect(JSON.stringify(args.where)).not.toContain('documentVersion');
  });
});
