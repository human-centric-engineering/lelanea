/**
 * Zod schemas for Lelañea's authored content.
 *
 * The six files under `content/` are Lelañea Fulton's own words, transcribed and
 * corrected only for typography. They are **not** a draft for the build to
 * improve on, so nothing here coerces, defaults or repairs — every schema is a
 * `strictObject`, and an unknown key fails validation rather than being dropped.
 * That strictness is the point: it turns a silent edit to an authored file into
 * a red CI run (`tests/unit/lib/app/content/schemas.test.ts` parses all six real
 * files), which is the only cheap way to notice that content drifted away from
 * what the renderers and the API contract expect.
 *
 * Strict on structure, permissive on prose. Free-text values (`surface`,
 * `textFormat`, headings, notes) are `z.string()`, because new authored copy
 * legitimately introduces new strings. Closed sets that a renderer or a client
 * switches on — block `type`, document `category`, tier ids — are enums, because
 * a new member there is a code change, not a copy change.
 *
 * The three released files (foundational documents, module structure, discovery
 * questions) are modelled precisely — blocks are a discriminated union, because
 * `components/app/content` renders off the discriminant. The three release-2
 * files (Values module, reference framework, value explorations) are validated
 * but not served, and are modelled as strict objects with optional members
 * rather than unions: nothing consumes their shape yet, so precision there would
 * be over-fitting, while `strictObject` still fails loudly on drift.
 *
 * @see lib/app/content/index.ts — the loader that parses these, once, on demand
 * @see .context/app/planning/README.md — what each file is and where it came from
 */

import { z } from 'zod';

// ============================================================================
// Foundational documents — content/lelanea_foundational_documents.json
// ============================================================================

/** A heading. `number` is present on the numbered clauses of the Terms of Use. */
export const headingBlockSchema = z.strictObject({
  type: z.literal('heading'),
  text: z.string(),
  level: z.number().int().positive(),
  number: z.number().int().positive().optional(),
});

/** A paragraph. In `the_initiation` each is a single sentence, deliberately. */
export const paragraphBlockSchema = z.strictObject({
  type: z.literal('paragraph'),
  text: z.string(),
});

/** A bulleted list. */
export const listBlockSchema = z.strictObject({
  type: z.literal('list'),
  style: z.literal('unordered'),
  items: z.array(z.string()).min(1),
});

/**
 * One renderable block of an authored document.
 *
 * `text` and `items` may carry `**bold**` inline markdown (the Disclaimer and
 * the Terms of Use use it); no other inline syntax appears in the source.
 */
export const documentBlockSchema = z.discriminatedUnion('type', [
  headingBlockSchema,
  paragraphBlockSchema,
  listBlockSchema,
]);

export const foundationalDocumentSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Present on every document; `null` where the source had no subtitle. */
  subtitle: z.string().nullable(),
  category: z.enum(['onboarding', 'about', 'legal']),
  /** Which app surface shows this document, e.g. `first_run_welcome`. */
  surface: z.string().min(1),
  sourceFile: z.string().min(1),
  blocks: z.array(documentBlockSchema).min(1),
  /** `'cadence'` on `the_initiation` — see `renderNote`. */
  renderStyle: z.string().min(1).optional(),
  renderNote: z.string().min(1).optional(),
  /** Merge fields left in the copy, e.g. `{{first_name}}`, `[Support Email]`. */
  placeholders: z.array(z.string().min(1)).min(1).optional(),
  /** The Disclaimer and the Terms of Use must be acknowledged, not just shown. */
  requiresAcknowledgement: z.boolean().optional(),
});

const foundationalDocumentsFileBase = z.strictObject({
  collection: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    version: z.string().min(1),
    app: z.strictObject({
      name: z.string().min(1),
      trademarkedName: z.string().min(1),
      url: z.string().min(1),
      nameNote: z.string().min(1),
    }),
    creator: z.strictObject({
      name: z.string().min(1),
      titles: z.array(z.string().min(1)),
    }),
    textFormat: z.string().min(1),
    formatNotes: z.array(z.string().min(1)),
    /** Document ids in reading order. Validated against `documents` on load. */
    suggestedOrder: z.array(z.string().min(1)).min(1),
    sourceFiles: z.array(z.string().min(1)),
    locale: z.string().min(1),
  }),
  documents: z.array(foundationalDocumentSchema).min(1),
  /**
   * Editorial notes for the humans maintaining the copy ("the effective date is
   * still an unfilled placeholder"). Validated so drift fails, deliberately not
   * served — see the route handlers.
   */
  reviewNotes: z.array(
    z.strictObject({
      document: z.string().min(1),
      note: z.string().min(1),
    })
  ),
});

// ============================================================================
// Journey structure — content/lelanea_module_structure.json
// ============================================================================

/** The five tiers the seventeen modules are grouped into. */
export const moduleTierSchema = z.enum([
  'onboarding',
  'foundations',
  'inner_authority',
  'embodied_relationship',
  'integration_and_expansion',
]);

/** Within Module 01, phases are additionally grouped into three phase tiers. */
export const phaseTierSchema = z.enum(['orientation', 'discernment', 'integration']);

export const producesSchema = z.strictObject({
  artifact: z.string().min(1),
  revisitable: z.boolean(),
  contents: z.array(z.string().min(1)).optional(),
});

export const modulePhaseSchema = z.strictObject({
  number: z.number().int().positive(),
  displayNumber: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  /** Points at a content file's id, or `null` where nothing is authored yet. */
  contentRef: z.string().min(1).nullable().optional(),
  contentFile: z.string().min(1).optional(),
  contentNote: z.string().min(1).optional(),
  contentSteps: z.array(z.string().min(1)).optional(),
  contentQuestions: z.array(z.string().min(1)).optional(),
  questionCount: z.number().int().nonnegative().optional(),
  personalized: z.boolean().optional(),
  requiresAcknowledgement: z.boolean().optional(),
  /** `true` where the phase is a proposal rather than authored material. */
  proposed: z.boolean().optional(),
  phaseTier: phaseTierSchema.optional(),
  produces: producesSchema.optional(),
});

export const journeyModuleSchema = z.strictObject({
  id: z.string().min(1),
  number: z.number().int().nonnegative(),
  displayNumber: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().min(1).optional(),
  chartTitle: z.string().min(1).optional(),
  tier: moduleTierSchema,
  /**
   * The content file(s) this module's interior is authored in. A string where
   * there is one (Module 01), an array where there are several (onboarding).
   */
  contentRef: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
  phases: z.array(modulePhaseSchema).optional(),
  phaseTiers: z
    .array(
      z.strictObject({
        id: phaseTierSchema,
        label: z.string().min(1),
        order: z.number().int().positive(),
        phases: z.array(z.number().int().positive()).min(1),
      })
    )
    .optional(),
  appBehavior: z.string().min(1).optional(),
  produces: producesSchema.optional(),
  notes: z.array(z.string().min(1)).optional(),
});

const journeyStructureFileBase = z.strictObject({
  app: z.strictObject({
    name: z.string().min(1),
    url: z.string().min(1),
    journeyTitle: z.string().min(1),
    journeySubtitle: z.string().min(1),
    version: z.string().min(1),
    sources: z.array(z.string().min(1)),
    structureNotes: z.array(z.string().min(1)),
    locale: z.string().min(1),
  }),
  tiers: z
    .array(
      z.strictObject({
        id: moduleTierSchema,
        label: z.string().min(1),
        /** Zero-based: onboarding is tier 0, the four journey tiers follow. */
        order: z.number().int().nonnegative(),
        /** Module ids in this tier. Validated against `modules` on load. */
        modules: z.array(z.string().min(1)).min(1),
        intent: z.string().min(1),
      })
    )
    .min(1),
  modules: z.array(journeyModuleSchema).min(1),
  reviewNotes: z.array(
    z.strictObject({
      scope: z.string().min(1),
      note: z.string().min(1),
    })
  ),
});

// ============================================================================
// Discovery questions — content/onboarding_discovery_questions.json
// ============================================================================

export const discoveryQuestionSchema = z.strictObject({
  id: z.string().min(1),
  number: z.number().int().positive(),
  text: z.string().min(1),
  inputType: z.literal('long_text'),
  hint: z.string().min(1).optional(),
  /** A branch the facilitator takes depending on the answer. */
  conditionalFollowUp: z
    .strictObject({
      ifYes: z.string().min(1),
      ifNo: z.string().min(1),
    })
    .optional(),
});

const discoveryQuestionsFileBase = z.strictObject({
  content: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    chartTitle: z.string().min(1),
    module: z.string().min(1),
    phase: z.number().int().positive(),
    sourceFile: z.string().min(1),
    version: z.string().min(1),
    textFormat: z.string().min(1),
    questionCount: z.number().int().positive(),
    notes: z.array(z.string().min(1)),
    locale: z.string().min(1),
  }),
  preamble: z.strictObject({
    style: z.string().min(1),
    text: z.string().min(1),
  }),
  pacing: z.strictObject({
    rushDiscouraged: z.boolean(),
    allowPartialCompletion: z.boolean(),
    note: z.string().min(1),
  }),
  questions: z.array(discoveryQuestionSchema).min(1),
  reviewNotes: z.array(
    z.strictObject({
      scope: z.string().min(1),
      note: z.string().min(1),
    })
  ),
});

// ============================================================================
// Referential integrity
// ============================================================================
//
// Structure alone does not catch the drift that actually happens to authored
// files: a document renamed but left out of `suggestedOrder`, a module moved
// between tiers on one side only, a question deleted while `questionCount` still
// says thirty. Each of those parses cleanly and then fails somewhere far away —
// a missing document in a list, a tier that renders empty. These checks turn all
// three into a validation error at the file, naming the id that broke.

/** Foundational documents, plus: `suggestedOrder` is exactly the document set —
 * every id resolves, every document appears, and none appears twice. */
export const foundationalDocumentsFileSchema = foundationalDocumentsFileBase.superRefine(
  (file, ctx) => {
    const ids = new Set(file.documents.map((document) => document.id));
    if (ids.size !== file.documents.length) {
      ctx.addIssue({ code: 'custom', path: ['documents'], message: 'Duplicate document id' });
    }
    if (new Set(file.collection.suggestedOrder).size !== file.collection.suggestedOrder.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['collection', 'suggestedOrder'],
        message: 'suggestedOrder repeats a document id, so the index would list it twice',
      });
    }
    for (const [index, id] of file.collection.suggestedOrder.entries()) {
      if (!ids.has(id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['collection', 'suggestedOrder', index],
          message: `suggestedOrder names "${id}", which is not a document in this collection`,
        });
      }
    }
    for (const document of file.documents) {
      if (!file.collection.suggestedOrder.includes(document.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['collection', 'suggestedOrder'],
          message: `Document "${document.id}" is missing from suggestedOrder, so nothing would list it`,
        });
      }
    }
  }
);

/** Journey structure, plus: every tier's module list agrees with the modules. */
export const journeyStructureFileSchema = journeyStructureFileBase.superRefine((file, ctx) => {
  const modulesById = new Map(file.modules.map((entry) => [entry.id, entry]));
  for (const [tierIndex, tier] of file.tiers.entries()) {
    for (const [moduleIndex, moduleId] of tier.modules.entries()) {
      const journeyModule = modulesById.get(moduleId);
      if (!journeyModule) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers', tierIndex, 'modules', moduleIndex],
          message: `Tier "${tier.id}" names module "${moduleId}", which does not exist`,
        });
      } else if (journeyModule.tier !== tier.id) {
        ctx.addIssue({
          code: 'custom',
          path: ['tiers', tierIndex, 'modules', moduleIndex],
          message: `Module "${moduleId}" is listed under tier "${tier.id}" but declares tier "${journeyModule.tier}"`,
        });
      }
    }
  }
  // Cross-tier duplication is caught above (the second tier disagrees with the
  // module's declared `tier`), but a tier listing the same id twice satisfies
  // both loops and renders that module twice within the tier.
  const allListed = file.tiers.flatMap((tier) => tier.modules);
  const listed = new Set(allListed);
  if (listed.size !== allListed.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['tiers'],
      message: 'A module id is listed more than once, so the journey would show it twice',
    });
  }
  for (const [index, entry] of file.modules.entries()) {
    if (!listed.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['modules', index],
        message: `Module "${entry.id}" belongs to no tier, so the journey would not show it`,
      });
    }

    // The same drift one level down. A module's phases are its running order,
    // and its `phaseTiers` group them — two phases sharing a number, or a
    // grouping naming a phase the module does not have, renders as a duplicate
    // step or an empty group rather than as an error.
    const phaseNumbers = (entry.phases ?? []).map((phase) => phase.number);
    if (new Set(phaseNumbers).size !== phaseNumbers.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['modules', index, 'phases'],
        message: `Module "${entry.id}" repeats a phase number, so the journey would show it twice`,
      });
    }
    const known = new Set(phaseNumbers);
    for (const [tierIndex, phaseTier] of (entry.phaseTiers ?? []).entries()) {
      for (const number of phaseTier.phases) {
        if (!known.has(number)) {
          ctx.addIssue({
            code: 'custom',
            path: ['modules', index, 'phaseTiers', tierIndex, 'phases'],
            message: `Phase tier "${phaseTier.id}" names phase ${number}, which module "${entry.id}" does not have`,
          });
        }
      }
    }
  }
});

/** Discovery questions, plus: `questionCount` and the numbering match reality. */
export const discoveryQuestionsFileSchema = discoveryQuestionsFileBase.superRefine((file, ctx) => {
  if (file.content.questionCount !== file.questions.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['content', 'questionCount'],
      message: `questionCount says ${file.content.questionCount} but there are ${file.questions.length} questions`,
    });
  }
  file.questions.forEach((question, index) => {
    if (question.number !== index + 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['questions', index, 'number'],
        message: `Question ${question.id} is numbered ${question.number} but sits at position ${index + 1}`,
      });
    }
  });
});

// ============================================================================
// Release 2 — validated here, not served. See the file header.
// ============================================================================

/** Values module — content/values_module.json */
export const valuesModuleFileSchema = z.strictObject({
  module: z.strictObject({
    id: z.string().min(1),
    slug: z.string().min(1),
    title: z.string().min(1),
    shortTitle: z.string().min(1),
    version: z.string().min(1),
    locale: z.string().min(1),
    author: z.strictObject({
      name: z.string().min(1),
      titles: z.array(z.string().min(1)),
    }),
    stepOrder: z.array(z.string().min(1)).min(1),
    editorialNotes: z.array(z.string().min(1)),
  }),
  valueStates: z.strictObject({
    instruction: z.string().min(1),
    states: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          label: z.string().min(1),
          hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
          meaning: z.string().min(1),
        })
      )
      .min(1),
  }),
  values: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        label: z.string().min(1),
        aliases: z.array(z.string().min(1)).optional(),
      })
    )
    .min(1),
  steps: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        order: z.number().int().positive(),
        type: z.enum(['lesson', 'value_selection', 'reflection', 'closing']),
        title: z.string().min(1),
        icon: z.string().min(1).optional(),
        lens: z.string().min(1).optional(),
        sourceAsset: z.string().min(1).optional(),
        sourceAssets: z.array(z.string().min(1)).optional(),
        definition: z
          .strictObject({
            question: z.string().min(1),
            body: z.string().min(1),
            emphasis: z.array(z.string().min(1)),
            example: z.string().min(1).optional(),
          })
          .optional(),
        howTheyShapeOurLives: z
          .strictObject({
            heading: z.string().min(1),
            points: z.array(z.string().min(1)),
          })
          .optional(),
        ifNotSculptedConsciously: z
          .strictObject({
            heading: z.string().min(1),
            intro: z.string().min(1).optional(),
            /**
             * Either an attributed pair ("From family systems" / "Success means
             * stability.") or a bare sentence — the source material uses both.
             */
            points: z.array(
              z.union([
                z.string().min(1),
                z.strictObject({
                  source: z.string().min(1),
                  example: z.string().min(1),
                }),
              ])
            ),
            closing: z.string().min(1).optional(),
          })
          .optional(),
        blocks: z
          .array(
            z.strictObject({
              id: z.string().min(1),
              type: z.string().min(1).optional(),
              icon: z.string().min(1).optional(),
              title: z.string().min(1).optional(),
              intro: z.string().min(1).optional(),
              emphasis: z.array(z.string().min(1)).optional(),
              listHeading: z.string().min(1).optional(),
              points: z.array(z.string().min(1)).optional(),
              closing: z.string().min(1).optional(),
              attribution: z.string().min(1).optional(),
              paragraphs: z.array(z.string().min(1)).optional(),
              questions: z
                .array(
                  z.strictObject({
                    id: z.string().min(1),
                    number: z.number().int().positive(),
                    text: z.string().min(1),
                    inputType: z.string().min(1),
                  })
                )
                .optional(),
              durationMinutes: z.number().positive().optional(),
              guidance: z
                .strictObject({
                  breaths: z.number().int().positive(),
                  breathInstruction: z.string().min(1),
                  gazePoint: z.string().min(1),
                  somaticPrompts: z.array(z.string().min(1)),
                })
                .optional(),
              script: z.array(z.string().min(1)).optional(),
            })
          )
          .optional(),
        config: z
          .strictObject({
            requiresAllFourStates: z.boolean(),
            allowCustomValues: z.boolean(),
            customValuePrompt: z.string().min(1),
            minimumSelections: z.number().int().nonnegative().nullable(),
            maximumSelections: z.number().int().nonnegative().nullable(),
          })
          .optional(),
        context: z.string().min(1).optional(),
        intro: z.string().min(1).optional(),
        prompt: z.string().min(1).optional(),
        instruction: z.string().min(1).optional(),
        facilitationNote: z.string().min(1).optional(),
        implementationNotes: z.array(z.string().min(1)).optional(),
        /** One value state, or several, that this reflection focuses on. */
        focusState: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
        repeatPerValue: z.boolean().optional(),
        valueStatesRef: z.string().min(1).optional(),
        valuesRef: z.string().min(1).optional(),
        questions: z
          .array(
            z.strictObject({
              id: z.string().min(1),
              number: z.number().int().positive(),
              text: z.string().min(1),
              inputType: z.string().min(1),
              /** Which earlier answer(s) the picker draws its options from. */
              pickerSource: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
              expectedItems: z.number().int().positive().optional(),
              autoCalculable: z.boolean().optional(),
              subQuestions: z
                .array(
                  z.strictObject({
                    id: z.string().min(1),
                    text: z.string().min(1),
                  })
                )
                .optional(),
            })
          )
          .optional(),
      })
    )
    .min(1),
});

/** Values reference framework — content/values_reference_framework.json */
export const valuesReferenceFrameworkFileSchema = z.strictObject({
  framework: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    sourceFile: z.string().min(1),
    version: z.string().min(1),
    textFormat: z.string().min(1),
    purposeSummary: z.string().min(1),
    notes: z.array(z.string().min(1)),
    locale: z.string().min(1),
  }),
  explorationChecklist: z
    .array(
      z.strictObject({
        item: z.string().min(1),
        qualifier: z.string().min(1).optional(),
      })
    )
    .min(1),
  lenses: z
    .array(
      z.strictObject({
        lens: z.string().min(1),
        question: z.string().min(1),
      })
    )
    .min(1),
  standardStructure: z
    .array(
      z.strictObject({
        number: z.number().int().positive(),
        id: z.string().min(1),
        title: z.string().min(1),
        blocks: z.array(z.string().min(1)),
      })
    )
    .min(1),
  discernmentQuestions: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        question: z.string().min(1),
      })
    )
    .min(1),
  alignmentTest: z
    .array(
      z.strictObject({
        label: z.string().min(1),
        question: z.string().min(1),
      })
    )
    .min(1),
  parts: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        title: z.string().min(1),
        blocks: z.array(z.string().min(1)),
      })
    )
    .min(1),
});

/** Value explorations — content/value_explorations.json */
export const valueExplorationsFileSchema = z.strictObject({
  collection: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    version: z.string().min(1),
    module: z.string().min(1),
    relatedContent: z.strictObject({
      framework: z.string().min(1),
      valuesLibrary: z.string().min(1),
    }),
    textFormat: z.string().min(1),
    valueCount: z.number().int().positive(),
    librarySize: z.number().int().positive(),
    notes: z.array(z.string().min(1)),
    locale: z.string().min(1),
  }),
  sectionSchema: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        order: z.number().int().positive(),
        heading: z.string().min(1),
        required: z.boolean(),
        headingIsTemplated: z.boolean(),
        frameworkSection: z.number().int().positive().nullable(),
      })
    )
    .min(1),
  values: z
    .array(
      z.strictObject({
        id: z.string().min(1),
        value: z.string().min(1),
        sourceHeading: z.string().min(1),
        sourceFile: z.string().min(1),
        inValuesLibrary: z.boolean(),
        wordCount: z.number().int().nonnegative(),
        sectionCount: z.number().int().nonnegative(),
        sections: z.array(
          z.strictObject({
            id: z.string().min(1),
            order: z.number().int().positive(),
            heading: z.string().min(1),
            paragraphs: z.array(z.string().min(1)),
          })
        ),
      })
    )
    .min(1),
  reviewNotes: z.array(
    z.strictObject({
      scope: z.string().min(1),
      note: z.string().min(1),
    })
  ),
});

// ============================================================================
// Inferred types — the app's view of authored content
// ============================================================================

export type DocumentBlock = z.infer<typeof documentBlockSchema>;
export type HeadingBlock = z.infer<typeof headingBlockSchema>;
export type ParagraphBlock = z.infer<typeof paragraphBlockSchema>;
export type ListBlock = z.infer<typeof listBlockSchema>;
export type FoundationalDocument = z.infer<typeof foundationalDocumentSchema>;
export type FoundationalDocumentsFile = z.infer<typeof foundationalDocumentsFileSchema>;
export type JourneyModule = z.infer<typeof journeyModuleSchema>;
export type ModulePhase = z.infer<typeof modulePhaseSchema>;
export type ModuleTier = z.infer<typeof moduleTierSchema>;
export type PhaseTier = z.infer<typeof phaseTierSchema>;
export type Produces = z.infer<typeof producesSchema>;
export type JourneyStructureFile = z.infer<typeof journeyStructureFileSchema>;
export type DiscoveryQuestion = z.infer<typeof discoveryQuestionSchema>;
export type DiscoveryQuestionsFile = z.infer<typeof discoveryQuestionsFileSchema>;
export type ValuesModuleFile = z.infer<typeof valuesModuleFileSchema>;
export type ValuesReferenceFrameworkFile = z.infer<typeof valuesReferenceFrameworkFileSchema>;
export type ValueExplorationsFile = z.infer<typeof valueExplorationsFileSchema>;
