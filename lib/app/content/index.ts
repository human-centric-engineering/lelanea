/**
 * The one way in to Lelañea's authored content.
 *
 * Six JSON files under `content/` hold Lelañea Fulton's own words. Nothing
 * outside this folder reads them: an ESLint rule in `lib/app/eslint.config.mjs`
 * fails any import of `@/content/*.json` from elsewhere, so a page that wants
 * the mission statement asks for it here instead of pasting it. That is the
 * whole point of the seam — the platform strategy is that authored content is
 * *served*, not compiled into the web build, so a native client later renders
 * the same copy through the same API rather than growing a second pipeline.
 *
 * **Static imports, not `fs`.** `lib/app/**` is the portable extension surface
 * and may not touch Node built-ins (see the ESLint block in the root config), so
 * the files are imported as modules and bundled. They are authored artefacts
 * that change at deploy time; when that stops being true — the first time copy
 * must change without a deploy — the decision on file is to move this behind a
 * database, keeping these function signatures.
 *
 * **Parsed once, on demand.** Each accessor validates its file the first time it
 * is called and memoises the result for the life of the process. A malformed
 * file therefore throws from the accessor rather than at import time, which
 * keeps an unrelated route from failing to load; CI catches it first either way
 * (`tests/unit/lib/app/content/schemas.test.ts` parses all six real files).
 *
 * **What is deliberately not exposed.** `reviewNotes` (editorial notes to the
 * humans maintaining the copy, e.g. "the effective date is still unfilled") and
 * `sourceFile` provenance are validated but never returned — they are working
 * notes about the words, not the words.
 *
 * Release-2 content (Values module, reference framework, value explorations)
 * lives in `@/lib/app/content/values`, kept out of this module so its 300KB
 * stays out of the bundles that only need a document.
 *
 * @see lib/app/content/schemas.ts — the shapes, and why they are strict
 * @see app/api/v1/app/content — the HTTP surface over these accessors
 */

import rawFoundationalDocuments from '@/content/lelanea_foundational_documents.json';
import rawJourneyStructure from '@/content/lelanea_module_structure.json';
import rawDiscoveryQuestions from '@/content/onboarding_discovery_questions.json';
import {
  foundationalDocumentsFileSchema,
  journeyStructureFileSchema,
  discoveryQuestionsFileSchema,
  type DocumentBlock,
  type DiscoveryQuestion,
  type FoundationalDocumentsFile,
  type JourneyModule,
  type JourneyStructureFile,
  type DiscoveryQuestionsFile,
} from '@/lib/app/content/schemas';

// ============================================================================
// Served shapes
// ============================================================================

/** Identity and version of one authored collection, for clients and ETags. */
export interface ContentCollectionMeta {
  id: string;
  title: string;
  /** The collection's own version string, authored in the file. */
  version: string;
  /** BCP 47 tag as authored, e.g. `en-GB`. */
  locale: string;
}

/**
 * A foundational document without its blocks — enough to list, route to, and
 * decide whether an acknowledgement is required, without shipping the prose.
 *
 * The optional members of the authored file are normalised here (`placeholders`
 * to `[]`, `requiresAcknowledgement` to `false`, `renderStyle`/`renderNote` to
 * `null`) so every client sees one predictable shape. The words themselves are
 * never touched.
 */
export interface FoundationalDocumentSummary {
  id: string;
  title: string;
  subtitle: string | null;
  category: 'onboarding' | 'about' | 'legal';
  /** Which app surface shows this document, e.g. `first_run_welcome`. */
  surface: string;
  requiresAcknowledgement: boolean;
  /** Merge fields present in the copy, e.g. `{{first_name}}`. */
  placeholders: string[];
  /** `'cadence'` on the welcome statement — render each beat on its own line. */
  renderStyle: string | null;
  renderNote: string | null;
  blockCount: number;
}

/** A foundational document with its blocks, in authored order. */
export interface FoundationalDocumentDetail extends FoundationalDocumentSummary {
  blocks: DocumentBlock[];
}

/** The document index, in the collection's own `suggestedOrder`. */
export interface FoundationalDocumentIndex {
  collection: ContentCollectionMeta;
  documents: FoundationalDocumentSummary[];
}

/** The seventeen-module journey: its tiers, its modules, and their phases. */
export interface JourneyStructure {
  collection: ContentCollectionMeta & { subtitle: string };
  tiers: JourneyStructureFile['tiers'];
  modules: JourneyModule[];
}

/** The onboarding module's thirty discovery questions, with pacing guidance. */
export interface DiscoveryQuestionSet {
  collection: ContentCollectionMeta & { chartTitle: string; module: string; phase: number };
  preamble: DiscoveryQuestionsFile['preamble'];
  pacing: DiscoveryQuestionsFile['pacing'];
  questions: DiscoveryQuestion[];
}

// ============================================================================
// Parse-once caches
// ============================================================================

let foundationalDocumentsCache: FoundationalDocumentsFile | null = null;
let journeyStructureCache: JourneyStructureFile | null = null;
let discoveryQuestionsCache: DiscoveryQuestionsFile | null = null;

function foundationalDocumentsFile(): FoundationalDocumentsFile {
  foundationalDocumentsCache ??= foundationalDocumentsFileSchema.parse(rawFoundationalDocuments);
  return foundationalDocumentsCache;
}

function journeyStructureFile(): JourneyStructureFile {
  journeyStructureCache ??= journeyStructureFileSchema.parse(rawJourneyStructure);
  return journeyStructureCache;
}

function discoveryQuestionsFile(): DiscoveryQuestionsFile {
  discoveryQuestionsCache ??= discoveryQuestionsFileSchema.parse(rawDiscoveryQuestions);
  return discoveryQuestionsCache;
}

// ============================================================================
// Foundational documents
// ============================================================================

function toSummary(
  document: FoundationalDocumentsFile['documents'][number]
): FoundationalDocumentSummary {
  return {
    id: document.id,
    title: document.title,
    subtitle: document.subtitle,
    category: document.category,
    surface: document.surface,
    requiresAcknowledgement: document.requiresAcknowledgement ?? false,
    placeholders: document.placeholders ?? [],
    renderStyle: document.renderStyle ?? null,
    renderNote: document.renderNote ?? null,
    blockCount: document.blocks.length,
  };
}

/**
 * Every foundational document, in the collection's authored reading order.
 *
 * `suggestedOrder` is the author's sequence (the welcome statement, then the
 * three "about" pieces, then the two legal ones); it is validated against the
 * document ids by the schema, so this cannot silently drop or duplicate one.
 */
export function listFoundationalDocuments(): FoundationalDocumentIndex {
  const file = foundationalDocumentsFile();
  const byId = new Map(file.documents.map((document) => [document.id, document]));

  return {
    collection: {
      id: file.collection.id,
      title: file.collection.title,
      version: file.collection.version,
      locale: file.collection.locale,
    },
    documents: file.collection.suggestedOrder.map((id) => {
      // Non-null: the schema's referential check guarantees every id resolves.
      const document = byId.get(id)!;
      return toSummary(document);
    }),
  };
}

/**
 * One foundational document with its blocks, or `null` if the id is unknown.
 *
 * Returning `null` rather than throwing keeps the 404 decision with the caller —
 * the route turns it into a `NOT_FOUND` envelope, a server component into a
 * `notFound()`.
 */
export function getFoundationalDocument(id: string): FoundationalDocumentDetail | null {
  const document = foundationalDocumentsFile().documents.find((candidate) => candidate.id === id);
  if (!document) return null;

  return { ...toSummary(document), blocks: document.blocks };
}

// ============================================================================
// Placeholders
// ============================================================================

/**
 * Matches the two merge-field conventions the authored copy uses: `{{snake}}`
 * for a value the app substitutes (`{{first_name}}`), and `[Title Case]` for a
 * value a human still has to fill in before launch (`[Support Email]`).
 *
 * Kept as a source of truth for both the renderer and
 * `tests/unit/lib/app/content/placeholders.test.ts`, which scans the real prose
 * with it and fails if a bracket appears that the documents do not declare.
 *
 * It carries the `g` flag, so it is stateful: reach for `findPlaceholders` or
 * `String.prototype.match`, both of which reset `lastIndex`. A bare
 * `PLACEHOLDER_PATTERN.test(...)` in a loop alternates true and false.
 */
export const PLACEHOLDER_PATTERN = /\{\{[a-z0-9_]+\}\}|\[[^\]\n]+\]/g;

/** Every placeholder occurring in a string, in order, without duplicates. */
export function findPlaceholders(text: string): string[] {
  return [...new Set(text.match(PLACEHOLDER_PATTERN) ?? [])];
}

/**
 * Every placeholder the foundational documents *declare*, across all of them.
 *
 * This reads the `placeholders` arrays the author maintains, not the prose — a
 * placeholder that appears in the copy but was never declared is drift, and the
 * placeholder test is what catches it.
 */
export function listDeclaredPlaceholders(): string[] {
  const declared = foundationalDocumentsFile().documents.flatMap(
    (document) => document.placeholders ?? []
  );
  return [...new Set(declared)].sort();
}

/** Every placeholder that actually occurs in the documents' prose. */
export function listOccurringPlaceholders(): string[] {
  const found = foundationalDocumentsFile().documents.flatMap((document) =>
    document.blocks.flatMap((block) => {
      const strings = block.type === 'list' ? block.items : [block.text];
      return strings.flatMap(findPlaceholders);
    })
  );
  return [...new Set(found)].sort();
}

// ============================================================================
// Journey structure and discovery questions
// ============================================================================

/**
 * The journey: five tiers over seventeen modules, each with its phases.
 *
 * Public, because the structure of the work is part of what the product tells
 * you before you sign up. The authored copy *inside* a module is not here.
 */
export function getJourneyStructure(): JourneyStructure {
  const file = journeyStructureFile();
  return {
    collection: {
      id: file.app.name,
      title: file.app.journeyTitle,
      subtitle: file.app.journeySubtitle,
      version: file.app.version,
      locale: file.app.locale,
    },
    tiers: file.tiers,
    modules: file.modules,
  };
}

/**
 * The thirty discovery questions of the onboarding module's discovery phase,
 * with the preamble and the pacing guidance that belong with them.
 *
 * Behind auth: these are the questions a member is asked, and the pacing note
 * ("this is not a form to rush") only makes sense to someone in the journey.
 */
export function getDiscoveryQuestions(): DiscoveryQuestionSet {
  const file = discoveryQuestionsFile();
  return {
    collection: {
      id: file.content.id,
      title: file.content.title,
      chartTitle: file.content.chartTitle,
      module: file.content.module,
      phase: file.content.phase,
      version: file.content.version,
      locale: file.content.locale,
    },
    preamble: file.preamble,
    pacing: file.pacing,
    questions: file.questions,
  };
}
