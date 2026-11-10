import { APIClientError } from '@/lib/api/client';

/**
 * An API error with its `details` removed, for `save.report()`.
 *
 * `readSaveError()` shows a VALIDATION_ERROR's `details` in place of its message, which suits a form
 * whose details are field problems. The map and proposal services work the other way round: the
 * message says what to do ("… please re-propose") and the details only back it up, and a map's can
 * run to a dozen validator lines the editor's validation panel already shows.
 *
 * `validateRequestBody`'s `{ errors: [...] }` list stays: its message is only "Invalid request
 * body", so there the details are what says what is wrong.
 */
export function headlineOnly(err: unknown): unknown {
  if (!(err instanceof APIClientError) || Array.isArray(err.details?.errors)) return err;
  return new APIClientError(err.message, err.code, err.status);
}
