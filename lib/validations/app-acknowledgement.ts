/**
 * Acknowledgement validation — the write route's contract.
 *
 * One field. The kind is the only thing a caller may say; the version it is
 * recorded against is decided server-side from what is currently served (see
 * `recordAcknowledgement` in `lib/app/gateway/acknowledgements.ts`), so there
 * is deliberately no `documentVersion` here for a client to backdate.
 *
 * @see app/api/v1/app/acknowledgements/route.ts
 */

import { z } from 'zod';
import { ACKNOWLEDGEMENT_KINDS } from '@/lib/app/gateway/acknowledgements';

export const acknowledgeSchema = z.strictObject({
  kind: z.enum(ACKNOWLEDGEMENT_KINDS),
});

export type AcknowledgeInput = z.infer<typeof acknowledgeSchema>;
