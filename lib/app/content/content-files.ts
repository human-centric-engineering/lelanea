/**
 * Her content files and the rows they seed, in both directions (f-content-seeds
 * t-91).
 *
 * **File → rows** is what the seed does with `content/*.json` and
 * `seed-data/drafted/lelanea_resources.json`, and what the admin import does with
 * an uploaded file. It lived in `./seed-input/` until t-91, but nothing a request
 * reaches may import that folder (t-89), and the admin import is reached by a
 * request. So the projection moved here, and the seed-input builders call it. One
 * projection is what makes "an export dropped into the seed-data folder is a
 * valid seed input" true by construction rather than by two functions kept in
 * step.
 *
 * **Rows → file** is the admin export. It writes the shape the seed reads, and
 * only what is stored. The working notes a file carries and a row does not
 * (`sourceFile`, `reviewNotes`, `notes`, her source metadata) are left out, and
 * the schemas in `./schemas.ts` make them optional for exactly that reason.
 * Inventing them would put a provenance claim in the download that nobody made.
 *
 * The two directions are inverses on everything stored: exporting the rows and
 * projecting the file back gives the same rows. `tests/unit/lib/app/content/
 * content-files.test.ts` pins that per collection, from the real seed.
 *
 * **Nothing here reads a file or the database.** The caller parses a file with
 * the collection's schema, or reads the rows, and hands them in.
 */

import {
  storedDocumentBlocksSchema,
  type DiscoveryQuestionsFile,
  type FileDocumentBlock,
  type FoundationalDocumentsFile,
  type JourneyModule,
  type JourneyStructureFile,
  type Produces,
  type StoredDocumentBlock,
} from '@/lib/app/content/schemas';
import type {
  ContentCollectionMeta,
  FoundationalDocumentDetail,
  FoundationalSeed,
} from '@/lib/app/content/document-view';
import {
  storedPhasesSchema,
  storedPhaseTiersSchema,
  storedProducesSchema,
  type JourneyModuleRow,
  type JourneySeed,
  type JourneyStructure,
} from '@/lib/app/content/journey-view';
import type { DiscoveryQuestionSet, QuestionSeed } from '@/lib/app/content/question-view';
import { resourceToRow, wordsToRow, type ResourcesSeed } from '@/lib/app/content/resource-view';
import type { ResourcesFile, ResourcesLibrary } from '@/lib/app/content/resources';
import { JOURNEY_MODULES, JOURNEY_TIERS } from '@/lib/app/journey/roster';

// ============================================================================
// Foundational documents
// ============================================================================

/**
 * How a file's unkeyed blocks get their section keys. The seed passes the
 * owner's `SECTION_KEYS` map for her file. The admin import passes nothing, so
 * an unkeyed file arrives unkeyed and the import refuses it for dropping the
 * sections a surface selects by.
 */
export type KeyUnkeyedBlocks = (
  documentId: string,
  blocks: readonly FileDocumentBlock[]
) => StoredDocumentBlock[];

/**
 * Whether a file carries its own section keys. Decided for the whole file, not
 * per document: an export writes a key (or `null`) on every block of every
 * document, and her file writes none, so a file that mixes the two is neither
 * and is read as carrying keys, which leaves the rest unkeyed rather than
 * guessing.
 */
function fileCarriesSections(file: FoundationalDocumentsFile): boolean {
  return file.documents.some((document) =>
    document.blocks.some((block) => block.section !== undefined)
  );
}

/**
 * The rows a documents file seeds, in `suggestedOrder`.
 *
 * Every document takes its own `version` where the file gives one, and the
 * collection's otherwise, which is what the gate enforced before t-86.
 */
export function foundationalSeedFromFile(
  file: FoundationalDocumentsFile,
  keyUnkeyed?: KeyUnkeyedBlocks
): FoundationalSeed {
  const { collection } = file;
  const byId = new Map(file.documents.map((document) => [document.id, document]));
  const keyed = fileCarriesSections(file);

  const blocksOf = (id: string, blocks: readonly FileDocumentBlock[]): StoredDocumentBlock[] =>
    keyed || !keyUnkeyed
      ? storedDocumentBlocksSchema.parse(
          blocks.map((block) => ({ ...block, section: block.section ?? null }))
        )
      : keyUnkeyed(id, blocks);

  return {
    collection: {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      locale: collection.locale,
    },
    // The schema's referential check guarantees every suggested id resolves and
    // every document is suggested exactly once.
    documents: collection.suggestedOrder.map((id, position) => {
      const document = byId.get(id)!;
      return {
        id: document.id,
        position,
        title: document.title,
        subtitle: document.subtitle,
        category: document.category,
        surface: document.surface,
        requiresAcknowledgement: document.requiresAcknowledgement ?? false,
        placeholders: [...(document.placeholders ?? [])],
        renderStyle: document.renderStyle ?? null,
        renderNote: document.renderNote ?? null,
        blocks: blocksOf(document.id, document.blocks),
        version: document.version ?? collection.version,
        locale: collection.locale,
      };
    }),
  };
}

/**
 * The stored documents as a documents file, in reading order.
 *
 * Every block carries its section key, `null` included, so the file says it is
 * keyed. Every document carries its own version. An optional field the row holds
 * no value for is left out rather than written empty, because the file schema
 * refuses an empty `placeholders` or `renderStyle`.
 *
 * `locale` is the collection's: the file has one locale, and a document's own
 * is always the collection's (the seed writes it so, and the editor does not
 * offer it separately).
 */
export function foundationalFileFromRows(
  collection: ContentCollectionMeta,
  documents: readonly FoundationalDocumentDetail[]
): FoundationalDocumentsFile {
  return {
    collection: {
      id: collection.id,
      title: collection.title,
      version: collection.version,
      suggestedOrder: documents.map((document) => document.id),
      locale: collection.locale,
    },
    documents: documents.map((document) => ({
      id: document.id,
      title: document.title,
      subtitle: document.subtitle,
      category: document.category,
      surface: document.surface,
      version: document.version,
      blocks: document.blocks.map((block) => ({ ...block })),
      ...(document.renderStyle !== null && { renderStyle: document.renderStyle }),
      ...(document.renderNote !== null && { renderNote: document.renderNote }),
      ...(document.placeholders.length > 0 && { placeholders: [...document.placeholders] }),
      ...(document.requiresAcknowledgement && { requiresAcknowledgement: true }),
    })),
    reviewNotes: [],
  };
}

// ============================================================================
// Journey
// ============================================================================

/**
 * Throw unless the file's tiers and modules are exactly the roster's: the same
 * ids, the same numbers, the same tier for each module, the same tier order.
 *
 * The roster owns the journey's structure (t-87), so a file can change the text
 * and nothing else. Both the seed and the admin import go through here.
 */
export function assertRosterMatchesFile(file: JourneyStructureFile): void {
  const problems: string[] = [];
  const fileTiers = [...file.tiers].sort((a, b) => a.order - b.order);
  const rosterTiers = JOURNEY_TIERS.map((tier) => `${tier.id}@${tier.order}`).join(',');
  if (fileTiers.map((tier) => `${tier.id}@${tier.order}`).join(',') !== rosterTiers) {
    problems.push(`tiers differ: the roster has ${rosterTiers}`);
  }
  const fileModules = [...file.modules].sort((a, b) => a.number - b.number);
  const rosterModules = JOURNEY_MODULES.map((m) => `${m.id}#${m.number}:${m.tier}`).join(',');
  if (fileModules.map((m) => `${m.id}#${m.number}:${m.tier}`).join(',') !== rosterModules) {
    problems.push(`modules differ: the roster has ${rosterModules}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `The journey roster (lib/app/journey/roster.ts) and the module structure file ` +
        `disagree: ${problems.join('; ')}`
    );
  }
}

/**
 * One module's text as the row stores it. Each phase is projected field by
 * field, exactly as the served shape has it, so a file's working notes
 * (`notes`, `contentNote`, `appBehavior`, content file names) never reach a row.
 */
function toModuleRow(entry: JourneyModule): Omit<JourneyModuleRow, 'revision'> {
  return {
    id: entry.id,
    displayNumber: entry.displayNumber,
    title: entry.title,
    subtitle: entry.subtitle ?? null,
    chartTitle: entry.chartTitle ?? null,
    phases: storedPhasesSchema.parse(
      (entry.phases ?? []).map((phase) => ({
        number: phase.number,
        displayNumber: phase.displayNumber,
        title: phase.title,
        description: phase.description,
        contentRef: phase.contentRef ?? null,
        proposed: phase.proposed ?? false,
        phaseTier: phase.phaseTier ?? null,
        questionCount: phase.questionCount ?? null,
        personalized: phase.personalized ?? false,
        requiresAcknowledgement: phase.requiresAcknowledgement ?? false,
        produces: phase.produces ?? null,
      }))
    ),
    phaseTiers: storedPhaseTiersSchema.parse(
      entry.phaseTiers?.map((tier) => ({
        id: tier.id,
        label: tier.label,
        order: tier.order,
        phases: tier.phases,
      })) ?? null
    ),
    produces: storedProducesSchema.parse(entry.produces ?? null),
  };
}

/**
 * The rows a module structure file seeds, in roster order.
 *
 * @throws when the file and the roster disagree about structure.
 */
export function journeySeedFromFile(file: JourneyStructureFile): JourneySeed {
  assertRosterMatchesFile(file);
  const tiersById = new Map(file.tiers.map((tier) => [tier.id, tier]));
  const modulesById = new Map(file.modules.map((entry) => [entry.id, entry]));

  return {
    journey: {
      id: file.app.name,
      title: file.app.journeyTitle,
      subtitle: file.app.journeySubtitle,
      version: file.app.version,
      locale: file.app.locale,
    },
    // Non-null: `assertRosterMatchesFile` has just proved every roster id is in
    // the file.
    tiers: JOURNEY_TIERS.map((rosterTier) => {
      const tier = tiersById.get(rosterTier.id)!;
      return { id: tier.id, label: tier.label, intent: tier.intent };
    }),
    modules: JOURNEY_MODULES.map((rosterModule) => toModuleRow(modulesById.get(rosterModule.id)!)),
  };
}

/** A served (read-only) `produces`, as the file's mutable shape. */
function copyProduces(produces: {
  readonly artifact: string;
  readonly revisitable: boolean;
  readonly contents?: readonly string[];
}): Produces {
  return {
    artifact: produces.artifact,
    revisitable: produces.revisitable,
    ...(produces.contents !== undefined && { contents: [...produces.contents] }),
  };
}

/**
 * The stored journey as a module structure file.
 *
 * Structure comes from the roster through the served shape; text from the rows.
 * A stored `null` is left out where the file schema has the field optional, and
 * written where it is nullable (`contentRef`), which is exactly what
 * {@link toModuleRow} reads back to the same value.
 */
export function journeyFileFromStructure(structure: JourneyStructure): JourneyStructureFile {
  return {
    app: {
      name: structure.collection.id,
      journeyTitle: structure.collection.title,
      journeySubtitle: structure.collection.subtitle,
      version: structure.collection.version,
      locale: structure.collection.locale,
    },
    tiers: structure.tiers.map((tier) => ({
      id: tier.id,
      label: tier.label,
      order: tier.order,
      modules: [...tier.modules],
      intent: tier.intent,
    })),
    modules: structure.modules.map((entry) => ({
      id: entry.id,
      number: entry.number,
      displayNumber: entry.displayNumber,
      title: entry.title,
      ...(entry.subtitle !== null && { subtitle: entry.subtitle }),
      ...(entry.chartTitle !== null && { chartTitle: entry.chartTitle }),
      tier: entry.tier,
      phases: entry.phases.map((phase) => ({
        number: phase.number,
        displayNumber: phase.displayNumber,
        title: phase.title,
        description: phase.description,
        contentRef: phase.contentRef,
        proposed: phase.proposed,
        ...(phase.phaseTier !== null && { phaseTier: phase.phaseTier }),
        ...(phase.questionCount !== null && { questionCount: phase.questionCount }),
        personalized: phase.personalized,
        requiresAcknowledgement: phase.requiresAcknowledgement,
        ...(phase.produces !== null && { produces: copyProduces(phase.produces) }),
      })),
      ...(entry.phaseTiers !== null && {
        phaseTiers: entry.phaseTiers.map((tier) => ({
          id: tier.id,
          label: tier.label,
          order: tier.order,
          phases: [...tier.phases],
        })),
      }),
      ...(entry.produces !== null && { produces: copyProduces(entry.produces) }),
    })),
    reviewNotes: [],
  };
}

// ============================================================================
// Discovery questions
// ============================================================================

/** The rows a discovery questions file seeds. */
export function questionSeedFromFile(file: DiscoveryQuestionsFile): QuestionSeed {
  return {
    set: {
      id: file.content.id,
      title: file.content.title,
      chartTitle: file.content.chartTitle,
      moduleId: file.content.module,
      phase: file.content.phase,
      preamble: { style: file.preamble.style, text: file.preamble.text },
      pacing: {
        rushDiscouraged: file.pacing.rushDiscouraged,
        allowPartialCompletion: file.pacing.allowPartialCompletion,
        note: file.pacing.note,
      },
      version: file.content.version,
      locale: file.content.locale,
    },
    questions: file.questions.map((question) => ({
      id: question.id,
      number: question.number,
      text: question.text,
      inputType: question.inputType,
      hint: question.hint ?? null,
      conditionalFollowUp: question.conditionalFollowUp
        ? { ifYes: question.conditionalFollowUp.ifYes, ifNo: question.conditionalFollowUp.ifNo }
        : null,
    })),
  };
}

/** The stored set as a discovery questions file. */
export function questionsFileFromSet(set: DiscoveryQuestionSet): DiscoveryQuestionsFile {
  return {
    content: {
      id: set.collection.id,
      title: set.collection.title,
      chartTitle: set.collection.chartTitle,
      module: set.collection.module,
      phase: set.collection.phase,
      version: set.collection.version,
      questionCount: set.questions.length,
      locale: set.collection.locale,
    },
    preamble: { ...set.preamble },
    pacing: { ...set.pacing },
    questions: set.questions.map((question) => ({
      id: question.id,
      number: question.number,
      text: question.text,
      inputType: question.inputType,
      ...(question.hint !== undefined && { hint: question.hint }),
      ...(question.conditionalFollowUp !== undefined && {
        conditionalFollowUp: { ...question.conditionalFollowUp },
      }),
    })),
    reviewNotes: [],
  };
}

// ============================================================================
// Resources
// ============================================================================

/** The rows a resources file seeds. Videos, then audio, then articles, each in authored order. */
export function resourcesSeedFromFile(file: ResourcesFile): ResourcesSeed {
  return {
    collection: {
      id: file.resources.id,
      title: file.resources.title,
      version: file.resources.version,
      locale: file.resources.locale,
      provenance: {
        status: file.resources.provenance.status,
        awaitingSignOffFrom: file.resources.provenance.awaitingSignOffFrom,
        note: file.resources.provenance.note,
      },
    },
    resources: [
      ...file.videos.map((video, position) => resourceToRow(video, 'video', position)),
      ...file.audio.map((piece, position) => resourceToRow(piece, 'audio', position)),
      ...file.articles.map((article, position) => resourceToRow(article, 'article', position)),
    ],
    words: Object.entries(file.words).map(([key, words]) => wordsToRow(key, words)),
  };
}

/**
 * The live library as a resources file.
 *
 * **Retired resources are left out.** The format cannot say "retired", so
 * writing one would bring it back on import; they stay in the database, where a
 * past suggestion still resolves them. The file's `notes` says so.
 */
export function resourcesFileFromLibrary(library: ResourcesLibrary): ResourcesFile {
  return {
    resources: {
      id: 'lelanea_resources',
      title: library.collection.title,
      version: library.collection.version,
      locale: library.collection.locale,
      provenance: { ...library.collection.provenance },
      notes: [
        'Exported from the admin. Retired resources are not in this file: the format cannot say "retired", and they stay in the database so past suggestions still resolve.',
      ],
    },
    videos: library.videos.map((video) => ({
      id: video.id,
      title: video.title,
      subtitle: video.subtitle,
      relatesTo: video.relatesTo,
      duration: video.duration,
      href: video.href,
    })),
    audio: library.audio.map((piece) => ({
      id: piece.id,
      title: piece.title,
      subtitle: piece.subtitle,
      relatesTo: piece.relatesTo,
      duration: piece.duration,
      href: piece.href,
    })),
    articles: library.articles.map((article) => {
      const base = {
        id: article.id,
        title: article.title,
        subtitle: article.subtitle,
        relatesTo: article.relatesTo,
        readingTime: article.readingTime,
      };
      return 'documentId' in article
        ? { ...base, documentId: article.documentId }
        : { ...base, href: article.href };
    }),
    words: Object.fromEntries(
      Object.entries(library.words).map(([key, words]) => [
        key,
        {
          quote: words.quote,
          paragraphs: [...words.paragraphs],
          source: { ...words.source },
        },
      ])
    ),
  };
}
