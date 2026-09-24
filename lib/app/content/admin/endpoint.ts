/**
 * Where the content editor lives (f-content-seeds t-91): the admin pages and
 * the API behind them. Client-safe, so the nav seam, the pages and the editor's
 * components all name these rather than spelling a path.
 */

/** The four collections the editor manages. */
export const CONTENT_COLLECTIONS = ['documents', 'journey', 'questions', 'resources'] as const;
export type ContentCollection = (typeof CONTENT_COLLECTIONS)[number];

/** The content section's landing page, which the nav links to. */
export const CONTENT_ADMIN_PAGE = '/admin/app/content';

/** One collection's editor page. */
export function contentAdminPage(collection: ContentCollection): string {
  return `${CONTENT_ADMIN_PAGE}/${collection}`;
}

const API = '/api/v1/admin/app/content';

/** One collection as the editor reads it. `GET`. */
export function contentCollectionEndpoint(collection: ContentCollection): string {
  return `${API}/${collection}`;
}

/** The collection as a file, in the shape the seed reads. `GET`. */
export function contentExportEndpoint(collection: ContentCollection): string {
  return `${API}/${collection}/export`;
}

/** What a file would do. `POST { file }`. Writes nothing. */
export function contentImportPreviewEndpoint(collection: ContentCollection): string {
  return `${API}/${collection}/import/preview`;
}

/** Apply a file. `POST { file }`. */
export function contentImportEndpoint(collection: ContentCollection): string {
  return `${API}/${collection}/import`;
}

/** A new order. `PUT { order: [{ id, revision }] }` (resources add `kind`). */
export function contentOrderEndpoint(collection: ContentCollection): string {
  return `${API}/${collection}/order`;
}

/** Add one. `POST`. */
export function contentEntityEndpoint(collection: ContentCollection, entity: string): string {
  return `${API}/${collection}/${entity}`;
}

/** One item: `PUT` saves it, `DELETE ?revision=N` removes (or retires) it. */
export function contentItemEndpoint(
  collection: ContentCollection,
  entity: string,
  id: string
): string {
  return `${contentEntityEndpoint(collection, entity)}/${encodeURIComponent(id)}`;
}

/** Every past revision of one item, newest first. `GET`. */
export function contentHistoryEndpoint(
  collection: ContentCollection,
  entity: string,
  id: string
): string {
  return `${contentItemEndpoint(collection, entity, id)}/history`;
}

/** Put one item back to an earlier revision, as a new one. `POST { revision, revisionRead }`. */
export function contentRestoreEndpoint(
  collection: ContentCollection,
  entity: string,
  id: string
): string {
  return `${contentItemEndpoint(collection, entity, id)}/restore`;
}

/** Retire or bring back a resource. `PUT { retired, revision }`. */
export function contentRetiredEndpoint(
  collection: ContentCollection,
  entity: string,
  id: string
): string {
  return `${contentItemEndpoint(collection, entity, id)}/retired`;
}
