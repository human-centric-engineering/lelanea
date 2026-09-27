/**
 * The names discovery answers are filed under (f-onboarding t-101).
 *
 * Pure, with no database import, because the slot editor's schemas import it and
 * a client component may import those. The projection that uses these names is
 * `lib/app/onboarding/discovery-slots.ts`.
 */

/** The slot group every discovery answer is filed under. */
export const DISCOVERY_SLOT_GROUP = 'discovery';

/**
 * Every discovery slot's slug starts with this. The taxonomy refuses it for a
 * slot of its own, and refuses the group key, so no authored slot can take an
 * answer's identity or sit among the answers (`lib/app/slots/validation.ts`).
 */
export const DISCOVERY_SLOT_PREFIX = 'discovery_';

/** `q07` → `discovery_q07`. The question id is the identity, and it is never reused. */
export function discoverySlotSlug(questionId: string): string {
  return `${DISCOVERY_SLOT_PREFIX}${questionId}`;
}

export function isDiscoverySlotSlug(slug: string): boolean {
  return slug.startsWith(DISCOVERY_SLOT_PREFIX);
}

/** Why the taxonomy refuses a slug, for the message the admin reads. */
export const RESERVED_SLUG_MESSAGE = `Slugs starting "${DISCOVERY_SLOT_PREFIX}" hold people's answers to the discovery questions. Choose another.`;

/** Why the taxonomy refuses the group key. */
export const RESERVED_GROUP_MESSAGE = `The "${DISCOVERY_SLOT_GROUP}" group holds people's answers to the discovery questions. Choose another group.`;
