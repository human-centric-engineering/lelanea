/**
 * What a document she uploads is FOR — and the one rule that keeps voice-only
 * material out of anything the agent can quote.
 *
 * Her corpus is two different kinds of thing wearing the same file extension.
 * Some of it is what she *knows* — a method note, a framework, a reference she
 * would happily have read back to a user verbatim. Some of it only shows how she
 * *sounds* — a Substack post, a talk transcript, a voice note. Retrieval cannot
 * tell them apart, so without a recorded designation the first exemplar lookup
 * pastes her Substack paragraphs into a reply as if they were an answer.
 *
 * This module is the vocabulary that records the difference, and the rule that
 * acts on it. Both live here rather than being spread across the seed, the admin
 * surface and the contributor, so "which documents may the tool path see?" has
 * exactly one answer in the tree.
 *
 * ## The three designations
 *
 * | Family        | Values                              | Stored as                     |
 * | ------------- | ----------------------------------- | ----------------------------- |
 * | `purpose`     | `knowledge` · `voice` · `both`      | a managed `KnowledgeTag`      |
 * | `sensitivity` | `public` · `private` · `client`     | a managed `KnowledgeTag`      |
 * | `licensing`   | free text                           | `AppKnowledgeDesignation`     |
 *
 * **Licensing is not a tag, and that is a reconciliation finding rather than a
 * preference.** `KnowledgeTag` has `slug` / `name` / `description` and no
 * per-document value column, so a free-text note per document cannot be one
 * without minting a tag per note. `AiKnowledgeDocument.metadata` is not a home
 * for it either: `lib/orchestration/knowledge/document-manager.ts` REPLACES that
 * column wholesale on ingest, retry and re-chunk, so a note an admin typed would
 * vanish the first time a document was re-processed, silently. Hence the leaf's
 * own table.
 *
 * **Slugs carry a hyphen, not a colon.** `knowledgeTagSlugSchema` in
 * `lib/validations/orchestration.ts` is `^[a-z0-9-]+$`, so the `purpose:voice`
 * form the plan used is not a slug this platform will accept.
 *
 * ## The grant rule (`toolPathDocumentFilter`)
 *
 * A document may reach `search_knowledge_base` — the path that can quote it —
 * only when BOTH hold:
 *
 *   - its purpose is `knowledge` or `both`; and
 *   - its sensitivity is not `client`.
 *
 * Everything else reaches the prompt, if at all, through the context
 * contributor in `lib/app/voice/context-contributor.ts`: read directly, labelled
 * by origin, never presented as a retrieved answer.
 *
 * ### Why this is a document-level rule and not a tag grant
 *
 * The obvious implementation is to grant her agent the `purpose-knowledge` tag
 * through Sunrise's agent form and be done. It does not work, and the way it
 * fails is quiet. `resolveAgentDocumentAccess` expands every granted tag to its
 * documents and UNIONs the results, so tag grants can only ever say OR. There is
 * no tag expression for *knowledge AND NOT client*: a document tagged
 * `purpose-knowledge` and `sensitivity-client` is admitted by the first tag
 * whatever the second says. A tag grant would therefore look exactly like this
 * rule while quietly admitting the material the owner deferred (`B31` — the
 * dishonest fourth option).
 *
 * So her agents carry NO purpose or sensitivity tag grants, and the set is
 * composed live by the access contributor in
 * `lib/app/knowledge-access-contributors.ts`. That is also what the platform
 * recommends: `resolveAgentDocumentAccess`'s own docblock warns that
 * materialising derived grants onto the per-agent pivot is "clobber-or-leak"
 * because the pivot has no provenance column.
 *
 * ## `client` is vocabulary, deliberately without a mechanism behind it
 *
 * Client transcripts are DEFERRED, not excluded (owner ruling, applied at
 * planning). `sensitivity-client` exists from day one so a document can be
 * marked honestly at the moment it is uploaded; nothing is seeded from that
 * source, and the rule above admits it nowhere. Recording the deferral in the
 * vocabulary is what stops it being rediscovered later as an undesignated pile
 * of transcripts nobody dares touch.
 *
 * @see .context/app/voice.md
 * @see lib/app/knowledge-access-contributors.ts — where the rule is applied
 * @see prisma/seeds/app-lelanea/002-knowledge-designation.ts — where the tags come from
 */

/**
 * The slug prefix marking an agent as one of Lelañea's own.
 *
 * Vocabulary, so it lives here beside the tag slugs rather than in
 * `corpus-access.ts` — which re-exports it, and which was its first home.
 *
 * **It is here specifically because this module imports nothing.**
 * `corpus-access.ts` imports `@/lib/db/client`, and that module builds a
 * `pg.Pool` and a `PrismaClient` at import time — so a consumer that wanted only
 * this string literal was instantiating a connection pool to get it. The prompt
 * composer in `lib/app/voice/fingerprint.ts` is exactly that consumer, and it is
 * the kind of module an effective-prompt preview or an edge route would want,
 * where a transitive `pg` import is a broken bundle rather than a slow one.
 * Caught by /code-review on the t-26 branch.
 *
 * A prefix rather than an allowlist constant because her agents did not exist
 * when the rule was written: an allowlist would have shipped empty and left the
 * mechanism dark until somebody remembered to add a string (`HB9`).
 */
export const CORPUS_AGENT_SLUG_PREFIX = 'lelanea-';

/** What a document is for. */
export const DOCUMENT_PURPOSES = ['knowledge', 'voice', 'both'] as const;
export type DocumentPurpose = (typeof DOCUMENT_PURPOSES)[number];

/** How freely a document may be used. */
export const DOCUMENT_SENSITIVITIES = ['public', 'private', 'client'] as const;
export type DocumentSensitivity = (typeof DOCUMENT_SENSITIVITIES)[number];

/** Slug prefix per family — the seed and the resolver both derive from these. */
const PURPOSE_PREFIX = 'purpose-';
const SENSITIVITY_PREFIX = 'sensitivity-';

/** `'knowledge'` → `'purpose-knowledge'`. */
export function purposeTagSlug(purpose: DocumentPurpose): string {
  return `${PURPOSE_PREFIX}${purpose}`;
}

/** `'client'` → `'sensitivity-client'`. */
export function sensitivityTagSlug(sensitivity: DocumentSensitivity): string {
  return `${SENSITIVITY_PREFIX}${sensitivity}`;
}

/** Every purpose slug, in vocabulary order. */
export const PURPOSE_TAG_SLUGS: readonly string[] = DOCUMENT_PURPOSES.map(purposeTagSlug);

/** Every sensitivity slug, in vocabulary order. */
export const SENSITIVITY_TAG_SLUGS: readonly string[] =
  DOCUMENT_SENSITIVITIES.map(sensitivityTagSlug);

/** Both families, which is the set the admin surface manages and the seed writes. */
export const DESIGNATION_TAG_SLUGS: readonly string[] = [
  ...PURPOSE_TAG_SLUGS,
  ...SENSITIVITY_TAG_SLUGS,
];

/** `'purpose-voice'` → `'voice'`; anything else → `null`. */
export function purposeFromTagSlug(slug: string): DocumentPurpose | null {
  const value = slug.startsWith(PURPOSE_PREFIX) ? slug.slice(PURPOSE_PREFIX.length) : null;
  return value !== null && (DOCUMENT_PURPOSES as readonly string[]).includes(value)
    ? (value as DocumentPurpose)
    : null;
}

/** `'sensitivity-client'` → `'client'`; anything else → `null`. */
export function sensitivityFromTagSlug(slug: string): DocumentSensitivity | null {
  const value = slug.startsWith(SENSITIVITY_PREFIX) ? slug.slice(SENSITIVITY_PREFIX.length) : null;
  return value !== null && (DOCUMENT_SENSITIVITIES as readonly string[]).includes(value)
    ? (value as DocumentSensitivity)
    : null;
}

/**
 * The purposes whose documents may reach `search_knowledge_base`.
 *
 * `voice` is absent, and its absence IS the feature. A test asserts a
 * voice-designated document is outside the resolved tool-path set; adding
 * `'voice'` to this array is the revert that must fail it (`fp6`).
 */
export const TOOL_PATH_PURPOSES: readonly DocumentPurpose[] = ['knowledge', 'both'];

/**
 * The sensitivities no grant rule admits.
 *
 * `client` only, and only until the owner's deferred decision lands. See the
 * module header.
 */
export const UNGRANTABLE_SENSITIVITIES: readonly DocumentSensitivity[] = ['client'];

/**
 * The purposes whose documents may be shown to the model as EXAMPLES OF HER
 * REGISTER — the context-contributor path, not the tool path.
 *
 * The mirror image of {@link TOOL_PATH_PURPOSES}, and the pair is the whole
 * point of the vocabulary: `voice` is here and absent there, `knowledge` is
 * there and absent here, and `both` is in both because it carries her knowledge
 * AND her register. A document is therefore never silently in neither.
 *
 * Adding `'knowledge'` here would put a reference note in front of the model as
 * an example of how she sounds, which is the harmless direction. Removing
 * `'voice'` is the one that matters: it would make this whole path dark while
 * everything still passed.
 */
export const VOICE_PATH_PURPOSES: readonly DocumentPurpose[] = ['voice', 'both'];

/**
 * Human-readable copy for the admin surface. Kept beside the vocabulary so a
 * value added to either family cannot ship without the sentence that explains
 * it — `tests/unit/lib/app/voice/designation.test.ts` pins the correspondence.
 */
export const PURPOSE_COPY: Record<DocumentPurpose, { label: string; help: string }> = {
  knowledge: {
    label: 'Knowledge',
    help: 'Something she knows. The agent may retrieve this and quote it back.',
  },
  voice: {
    label: 'Voice',
    help: 'Shows how she sounds, not what she knows. Never retrieved by the agent’s search tool and never quoted — used only as an example of register.',
  },
  both: {
    label: 'Both',
    help: 'Carries her knowledge AND her register. Quotable, and also usable as a voice example.',
  },
};

export const SENSITIVITY_COPY: Record<DocumentSensitivity, { label: string; help: string }> = {
  public: { label: 'Public', help: 'Already published, or fine to publish.' },
  private: { label: 'Private', help: 'Hers and unpublished, but usable in a reply.' },
  client: {
    label: 'Client',
    help: 'Client material. Recorded so it can be marked honestly — no grant rule admits it, so it reaches nothing, pending a decision on client transcripts.',
  },
};

/**
 * A document's designation as the admin surface and the resolver both see it.
 *
 * `purpose` and `sensitivity` are nullable because a document uploaded through
 * Sunrise's own uploader has neither until somebody sets them — and an
 * undesignated document is NOT treated as knowledge. It reaches nothing until
 * the designation is made, which is the safe direction.
 */
export interface DocumentDesignation {
  purpose: DocumentPurpose | null;
  sensitivity: DocumentSensitivity | null;
  licensing: string | null;
}

/**
 * Does this designation let the document reach `search_knowledge_base`?
 *
 * The whole grant rule, as one pure function, so the contributor, the admin
 * surface's explanatory copy and the test all read the same sentence.
 */
export function isQuotable(designation: DocumentDesignation): boolean {
  if (designation.purpose === null) return false;
  if (!TOOL_PATH_PURPOSES.includes(designation.purpose)) return false;
  if (
    designation.sensitivity !== null &&
    UNGRANTABLE_SENSITIVITIES.includes(designation.sensitivity)
  ) {
    return false;
  }
  return true;
}

/**
 * May this document be shown to the model as an example of her register?
 *
 * The contributor path's rule, as one pure function, exactly as
 * {@link isQuotable} is the tool path's — so the two can be read side by side
 * and asserted against each other over the whole vocabulary rather than trusted
 * to have been written on the same afternoon.
 *
 * The sensitivity half is the SAME list, deliberately. `client` material is
 * deferred, and a rule that let it through here because it is "only" being shown
 * as a register example would be the leak the deferral exists to prevent — the
 * model sees the words either way.
 */
export function isVoiceExemplar(designation: DocumentDesignation): boolean {
  if (designation.purpose === null) return false;
  if (!VOICE_PATH_PURPOSES.includes(designation.purpose)) return false;
  if (
    designation.sensitivity !== null &&
    UNGRANTABLE_SENSITIVITIES.includes(designation.sensitivity)
  ) {
    return false;
  }
  return true;
}

/**
 * Read a designation out of a document's tag slugs plus its licensing note.
 *
 * Tolerant on purpose: a document can carry two purpose tags, because Sunrise's
 * own tag modal knows nothing about these families and will happily put both on
 * one row. The admin surface shows a single selected value rather than
 * pretending the conflict away.
 *
 * **A conflict resolves to the SAFEST reading, not to the first tag found.**
 * With both `purpose-knowledge` and `purpose-voice` present the document reads
 * as `voice`; with both `sensitivity-client` and a laxer one it reads as
 * `client`. Being wrong in that direction costs a passage that is never quoted.
 * Being wrong in the other costs her Substack pasted into a reply as an answer.
 * Vocabulary order is NOT what decides this — see the code below, which names
 * the narrow value explicitly so re-ordering `DOCUMENT_PURPOSES` cannot invert
 * the safety property.
 */
export function readDesignation(
  tagSlugs: readonly string[],
  licensing: string | null
): DocumentDesignation {
  const purposes = tagSlugs
    .map(purposeFromTagSlug)
    .filter((value): value is DocumentPurpose => value !== null);
  const sensitivities = tagSlugs
    .map(sensitivityFromTagSlug)
    .filter((value): value is DocumentSensitivity => value !== null);

  return {
    // Conflicts resolve to the SAFEST reading, not the first one found: a
    // document somehow carrying both `purpose-voice` and `purpose-knowledge` is
    // read as `voice`, because the cost of being wrong in that direction is a
    // passage that is never quoted, and in the other it is her Substack pasted
    // into a reply as an answer.
    purpose: purposes.includes('voice') ? 'voice' : (purposes[0] ?? null),
    // Same direction: any `client` tag wins over a laxer one.
    sensitivity: sensitivities.includes('client') ? 'client' : (sensitivities[0] ?? null),
    licensing,
  };
}
