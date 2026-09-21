/**
 * The app's own capabilities, paired with their seeds, for Sunrise's
 * class↔seed parity test (f-resources t-77).
 *
 * `tests/unit/prisma/seeds/capability-class-seed-parity.test.ts` scans every
 * `AiCapability` upsert under `prisma/seeds/` — a fork's directories included,
 * on purpose — and asserts each seeded name is in its `PAIRS` list, pinning
 * the class's `functionDefinition` to the seed's. That is the right invariant
 * for a fork's capability too, and the list has no seam for a fork to add one:
 * the test is Sunrise's, byte-identical across all three tiers. So the test
 * carries a two-line divergence — one import and one spread of this list —
 * ledgered in `.context/app/divergences.md` and filed with Sunrise. Every
 * capability this app seeds a row for goes here, nowhere else.
 */

import { SuggestResourceCapability } from '@/lib/app/resources/suggest';
import type { BaseCapability } from '@/lib/orchestration/capabilities/base-capability';
import { SUGGEST_RESOURCE_IMPL } from '@/prisma/seeds/app-lelanea/014-suggest-resource';

export const APP_CAPABILITY_PAIRS: {
  slug: string;
  seeded: { functionDefinition: unknown };
  instance: BaseCapability;
}[] = [
  {
    slug: 'suggest_resource',
    seeded: SUGGEST_RESOURCE_IMPL,
    instance: new SuggestResourceCapability(),
  },
];
