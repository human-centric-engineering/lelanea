/**
 * What each content route does, per collection and entity (f-content-seeds
 * t-91).
 *
 * The four collections share one set of routes under
 * `app/api/v1/admin/app/content/[collection]/…`, and this table is how a route
 * finds the service behind its path. Every request body is parsed here with its
 * entity's schema (`./validation.ts`), so a route is the same few lines whatever
 * it serves, and the service below it receives typed input.
 *
 * | Collection | Entities | Removal |
 * | --- | --- | --- |
 * | `documents` | `collection`, `document` | refused while a surface renders it |
 * | `journey` | `journey`, `tier`, `module` | none: the roster owns structure |
 * | `questions` | `set`, `question` | delete, re-numbering the rest |
 * | `resources` | `collection`, `resource`, `words` | a resource retires; words delete |
 *
 * @see lib/app/content/admin/endpoint.ts — the paths
 */

import { z } from 'zod';

import { NotFoundError, ValidationError } from '@/lib/api/errors';
import * as documents from '@/lib/app/content/admin/documents';
import * as journey from '@/lib/app/content/admin/journey';
import * as questions from '@/lib/app/content/admin/questions';
import * as resources from '@/lib/app/content/admin/resources';
import type { ContentImportPlan, RevisionEntry } from '@/lib/app/content/admin/shared';
import {
  documentCollectionSaveSchema,
  documentSaveSchema,
  journeySaveSchema,
  moduleSaveSchema,
  questionCreateSchema,
  questionSaveSchema,
  questionSetSaveSchema,
  reorderSchema,
  resourceCollectionSaveSchema,
  resourceCreateSchema,
  resourceRetireSchema,
  resourceSaveSchema,
  restoreSchema,
  tierSaveSchema,
  wordsCreateSchema,
  wordsSaveSchema,
} from '@/lib/app/content/admin/validation';
import { CONTENT_COLLECTIONS, type ContentCollection } from '@/lib/app/content/admin/endpoint';
import { RESOURCE_KINDS } from '@/lib/app/content/resource-view';

/** What a save, restore or removal reports back and the audit log records. */
export interface ContentWriteOutcome {
  changed: string[];
  /** Field by field, what it was and what it became; the audit log's `changes`. */
  changes?: Record<string, { from: unknown; to: unknown }>;
  /** Anything else the page should know: a minted version, a revision. */
  result?: Record<string, unknown>;
}

interface EntityHandlers {
  /** Singular, for messages and the audit entry. */
  label: string;
  save(id: string, body: unknown, editorId: string): Promise<ContentWriteOutcome>;
  history?(id: string): Promise<RevisionEntry<unknown>[]>;
  restore?(id: string, body: unknown, editorId: string): Promise<ContentWriteOutcome>;
  create?(body: unknown, editorId: string): Promise<ContentWriteOutcome & { id: string }>;
  /** `revision` is the lock the admin read, from the query string. */
  remove?(id: string, revision: number | null, editorId: string): Promise<ContentWriteOutcome>;
  retire?(id: string, body: unknown, editorId: string): Promise<ContentWriteOutcome>;
}

interface CollectionHandlers {
  view(): Promise<unknown>;
  exportFile(): Promise<{ file: unknown; filename: string }>;
  preview(raw: unknown): Promise<ContentImportPlan>;
  apply(raw: unknown, editorId: string): Promise<ContentImportPlan>;
  reorder?(body: unknown, editorId: string): Promise<{ moved: number }>;
  entities: Readonly<Record<string, EntityHandlers>>;
}

/** Parse a body with its schema, as the platform's `validateRequestBody` does. */
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError('Invalid request body', {
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

function requireRevision(revision: number | null): number {
  if (revision === null) {
    throw new ValidationError('Say which revision you are removing: ?revision=<the one you read>.');
  }
  return revision;
}

const now = () => new Date();

const REGISTRY: Readonly<Record<ContentCollection, CollectionHandlers>> = {
  documents: {
    view: documents.getDocumentsAdminView,
    exportFile: async () => ({
      file: await documents.exportDocumentsFile(),
      filename: documents.documentsExportFilename(now()),
    }),
    preview: documents.previewDocumentsImport,
    apply: documents.applyDocumentsImport,
    reorder: (body, editorId) =>
      documents.reorderDocuments(parse(reorderSchema, body).order, editorId),
    entities: {
      collection: {
        label: 'documents collection',
        save: (_id, body, editorId) => {
          const { updatedAt, ...edit } = parse(documentCollectionSaveSchema, body);
          return documents.updateDocumentCollection(edit, updatedAt, editorId);
        },
      },
      document: {
        label: 'document',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(documentSaveSchema, body);
          const outcome = await documents.updateDocument(id, edit, revision, editorId);
          return {
            changed: outcome.changed,
            changes: outcome.changes,
            result: { document: outcome.document, mintedVersion: outcome.mintedVersion },
          };
        },
        history: documents.listDocumentHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await documents.restoreDocumentRevision(
            id,
            revision,
            revisionRead,
            editorId
          );
          return {
            changed: outcome.changed,
            changes: outcome.changes,
            result: { document: outcome.document, mintedVersion: outcome.mintedVersion },
          };
        },
        remove: async (id, _revision, editorId) => {
          await documents.deleteDocument(id, editorId);
          return { changed: ['deleted'] };
        },
      },
    },
  },

  journey: {
    view: journey.getJourneyAdminView,
    exportFile: async () => ({
      file: await journey.exportJourneyFile(),
      filename: journey.journeyExportFilename(now()),
    }),
    preview: journey.previewJourneyImport,
    apply: journey.applyJourneyImport,
    entities: {
      journey: {
        label: 'journey',
        save: (_id, body) => {
          const { updatedAt, ...edit } = parse(journeySaveSchema, body);
          return journey.updateJourney(edit, updatedAt);
        },
      },
      tier: {
        label: 'tier',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(tierSaveSchema, body);
          const outcome = await journey.updateTier(id, edit, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
        history: journey.listTierHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await journey.restoreTierRevision(id, revision, revisionRead, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
      },
      module: {
        label: 'module',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(moduleSaveSchema, body);
          const outcome = await journey.updateModule(id, edit, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
        history: journey.listModuleHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await journey.restoreModuleRevision(id, revision, revisionRead, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
      },
    },
  },

  questions: {
    view: questions.getQuestionsAdminView,
    exportFile: async () => ({
      file: await questions.exportQuestionsFile(),
      filename: questions.questionsExportFilename(now()),
    }),
    preview: questions.previewQuestionsImport,
    apply: questions.applyQuestionsImport,
    reorder: (body, editorId) =>
      questions.reorderQuestions(parse(reorderSchema, body).order, editorId),
    entities: {
      set: {
        label: 'question set',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(questionSetSaveSchema, body);
          const outcome = await questions.updateQuestionSet(id, edit, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
        history: questions.listQuestionSetHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await questions.restoreQuestionSetRevision(
            id,
            revision,
            revisionRead,
            editorId
          );
          return { ...outcome, result: { revision: outcome.revision } };
        },
      },
      question: {
        label: 'question',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(questionSaveSchema, body);
          const outcome = await questions.updateQuestion(id, edit, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
        history: questions.listQuestionHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await questions.restoreQuestionRevision(
            id,
            revision,
            revisionRead,
            editorId
          );
          return { ...outcome, result: { revision: outcome.revision } };
        },
        create: async (body, editorId) => {
          const created = await questions.createQuestion(
            parse(questionCreateSchema, body),
            editorId
          );
          return { id: created.id, changed: ['created'], result: created };
        },
        remove: async (id, revision, editorId) => {
          const { removed, renumbered } = await questions.deleteQuestion(
            id,
            requireRevision(revision),
            editorId
          );
          return {
            changed: ['deleted'],
            changes: { question: { from: removed, to: null } },
            result: { renumbered },
          };
        },
      },
    },
  },

  resources: {
    view: resources.getResourcesAdminView,
    exportFile: async () => ({
      file: await resources.exportResourcesFile(),
      filename: resources.resourcesExportFilename(now()),
    }),
    preview: resources.previewResourcesImport,
    apply: resources.applyResourcesImport,
    reorder: (body, editorId) => {
      const { kind, order } = parse(reorderSchema.extend({ kind: z.enum(RESOURCE_KINDS) }), body);
      return resources.reorderResources(kind, order, editorId);
    },
    entities: {
      collection: {
        label: 'resource library',
        save: (_id, body) => {
          const { updatedAt, ...edit } = parse(resourceCollectionSaveSchema, body);
          return resources.updateResourceCollection(edit, updatedAt);
        },
      },
      resource: {
        label: 'resource',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(resourceSaveSchema, body);
          const outcome = await resources.updateResource(id, edit, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
        history: resources.listResourceHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await resources.restoreResourceRevision(
            id,
            revision,
            revisionRead,
            editorId
          );
          return { ...outcome, result: { revision: outcome.revision } };
        },
        create: async (body, editorId) => {
          const { id, ...edit } = parse(resourceCreateSchema, body);
          await resources.createResource(id, edit, editorId);
          return { id, changed: ['created'] };
        },
        // A resource is never deleted: removing one retires it. See resources.ts.
        remove: async (id, revision, editorId) => {
          const outcome = await resources.setResourceRetired(
            id,
            true,
            requireRevision(revision),
            editorId
          );
          return { ...outcome, result: { revision: outcome.revision, retired: true } };
        },
        retire: async (id, body, editorId) => {
          const { retired, revision } = parse(resourceRetireSchema, body);
          const outcome = await resources.setResourceRetired(id, retired, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision, retired } };
        },
      },
      words: {
        label: 'words',
        save: async (id, body, editorId) => {
          const { revision, ...edit } = parse(wordsSaveSchema, body);
          const outcome = await resources.updateWords(id, edit, revision, editorId);
          return { ...outcome, result: { revision: outcome.revision } };
        },
        history: resources.listWordsHistory,
        restore: async (id, body, editorId) => {
          const { revision, revisionRead } = parse(restoreSchema, body);
          const outcome = await resources.restoreWordsRevision(
            id,
            revision,
            revisionRead,
            editorId
          );
          return { ...outcome, result: { revision: outcome.revision } };
        },
        create: async (body, editorId) => {
          const { key, ...edit } = parse(wordsCreateSchema, body);
          await resources.createWords(key, edit, editorId);
          return { id: key, changed: ['created'] };
        },
        remove: async (id, revision) => {
          const { removed } = await resources.deleteWords(id, requireRevision(revision));
          return { changed: ['deleted'], changes: { words: { from: removed, to: null } } };
        },
      },
    },
  },
};

const collectionSchema = z.enum(CONTENT_COLLECTIONS);

/** The handlers for a collection path segment, or a 404 naming the four there are. */
export function collectionHandlers(segment: string): CollectionHandlers {
  const parsed = collectionSchema.safeParse(segment);
  if (!parsed.success) {
    throw new NotFoundError(
      `There is no content collection "${segment.slice(0, 40)}". There are: ${CONTENT_COLLECTIONS.join(', ')}.`
    );
  }
  return REGISTRY[parsed.data];
}

/** The handlers for an entity path segment within a collection. */
export function entityHandlers(collection: string, segment: string): EntityHandlers {
  const handlers = collectionHandlers(collection).entities;
  const entity = Object.hasOwn(handlers, segment) ? handlers[segment] : undefined;
  if (!entity) {
    throw new NotFoundError(
      `The ${collection} collection has no "${segment.slice(0, 40)}". It has: ${Object.keys(handlers).join(', ')}.`
    );
  }
  return entity;
}

/**
 * An id or key in a path: anything a stored one could be, and nothing else.
 * Letters are Unicode letters, because the journey row's id is the app's name,
 * `Lelañea`; an ASCII-only pattern turned every journey save into a 404.
 */
export const CONTENT_ID_PATTERN = /^[\p{L}\p{N}_-]{1,80}$/u;
