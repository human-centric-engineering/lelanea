/**
 * Zod schemas for Lelañea's authored content.
 *
 * Six of the seven files under `content/` are Lelañea Fulton's own words,
 * transcribed and corrected only for typography. They are **not** a draft for
 * the build to improve on, so nothing here coerces, defaults or repairs — every
 * schema is a `strictObject`, and an unknown key fails validation rather than
 * being dropped. That strictness is the point: it turns a silent edit to an
 * authored file into a red CI run, which is the only cheap way to notice that
 * content drifted away from what the renderers and the API contract expect.
 *
 * The seventh — the voice fingerprint's always-on core, at the bottom of this
 * file — is the exception that proves the rule: it WAS drafted, from the other
 * six, and carries a required `provenance` block saying so. Its schema is no
 * looser for it.
 *
 * Every real file is parsed by a test: `schemas.test.ts` for the three served
 * collections, `values.test.ts` for the Release-2 files, and
 * `voice-fingerprint.test.ts` for the core.
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
// Voice fingerprint — the always-on core
// ============================================================================
//
// The seventh file, and the only one that is NOT a transcription. The six
// beside it are Lelañea's own documents, corrected for typography and nothing
// else. This one was DRAFTED from them, in her register, and carries its own
// provenance saying so — `awaitingSignOffFrom` is a required field precisely so
// the file cannot quietly pretend to be the other kind.
//
// It lives here rather than as a TypeScript constant because it is her authored
// words: `.context/app/planning/README.md` says the content files govern
// "anything authored by Lelanea, which is never paraphrased in the build", and a
// parallel authoring path for her voice is exactly what that rule exists to
// prevent.

/**
 * One beat of the core. Its own line in the composed prompt, never joined.
 *
 * `.trim()` before `.min(1)` because the projection filters beats on
 * `line.trim().length > 0`: without it a line of `" "` parsed clean and then
 * silently vanished from the prompt, so the schema and the projection disagreed
 * about what counts as a beat. The schema is the half that should be strict.
 * Caught by /code-review.
 */
const voiceLinesSchema = z.array(z.string().trim().min(1)).min(1);

/**
 * `major.minor`, optionally `.patch`.
 *
 * Constrained rather than free text because an evaluation attributes an output
 * to a fingerprint version by reading this string back out of the composed
 * prompt. A version that cannot be ordered cannot be compared, and "v2 draft"
 * is not a version.
 */
const fingerprintVersionSchema = z.string().regex(/^\d+\.\d+(\.\d+)?$/, {
  message: 'version must be major.minor or major.minor.patch, e.g. "1.0" or "1.0.1"',
});

export const voiceFingerprintFileSchema = z.strictObject({
  fingerprint: z.strictObject({
    /**
     * No whitespace, because the id goes into the prompt's version marker and
     * `readFingerprintVersion()` matches it as `\S+`. An id with a space in it
     * composed a marker that looked right and read back as `null` — attribution
     * silently lost rather than failing. Constraining the id makes the round
     * trip structural instead of something a test has to remember to cover.
     * Caught by /code-review.
     */
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, {
        message: 'id must be a lowercase slug with no whitespace — it goes into the prompt',
      }),
    title: z.string().min(1),
    /** Which layer of the fingerprint this file is. Only the core exists today. */
    layer: z.literal('core'),
    version: fingerprintVersionSchema,
    locale: z.string().min(1),
    textFormat: z.string().min(1),
    provenance: z.strictObject({
      status: z.literal('drafted_from_corpus'),
      awaitingSignOffFrom: z.string().min(1),
      note: z.string().min(1),
    }),
    sourceFiles: z.array(z.string().min(1)),
    notes: z.array(z.string().min(1)),
  }),
  identity: z.strictObject({
    heading: z.string().min(1),
    lines: voiceLinesSchema,
  }),
  cadence: z.strictObject({
    heading: z.string().min(1),
    lines: voiceLinesSchema,
    /**
     * The words she reaches for, and — just as tellingly — the ones she avoids.
     *
     * Each list carries its own label for the same reason every block carries
     * its own heading: the label is copy the model reads. As TypeScript string
     * literals they were a second authoring path for her words, and a core
     * authored in another `locale` would have emitted two English labels into an
     * otherwise translated section with no way to change them.
     */
    reachesForLabel: z.string().min(1),
    reachesFor: z.array(z.string().trim().min(1)).min(1),
    avoidsLabel: z.string().min(1),
    avoids: z.array(z.string().trim().min(1)).min(1),
  }),
  grounding: z.strictObject({
    heading: z.string().min(1),
    lines: voiceLinesSchema,
  }),
  boundaries: z.strictObject({
    heading: z.string().min(1),
    lines: voiceLinesSchema,
    /**
     * What she declines is one thing; HOW she declines it is the other half, and
     * it carries its own heading for the same reason every other block does —
     * the heading is copy the model reads, so it is authored here rather than
     * written into the projection. A string literal in TypeScript would be a
     * second authoring path for her words, which is what the content seam and
     * its ESLint rule exist to prevent. Caught by /code-review.
     */
    howYouDeclineHeading: z.string().min(1),
    howYouDecline: voiceLinesSchema,
  }),
  reviewNotes: z.array(
    z.strictObject({
      scope: z.string().min(1),
      note: z.string().min(1),
    })
  ),
});

/**
 * A situation key, as a chat request's `contextId` carries it.
 *
 * The same character class the platform already uses for a slug
 * (`slugSchema` in `lib/validations/common.ts`), because a situation is
 * addressed over the wire: a route pins `contextType: 'voice'` /
 * `contextId: '<situation>'`, and the selector matches on this string. An
 * authored key with a space or a capital in it would be a key nothing could
 * ever send, and the failure would be a silent fall back to core-only rather
 * than an error.
 */
const voiceSituationSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
  message: 'situation must be a lowercase hyphenated key — it arrives as a request contextId',
});

/**
 * The context-selected overlays — content/lelanea_voice_overlays.json
 *
 * The fingerprint's second layer. Same authored-file discipline as the core
 * beside it: every heading, label and line the model reads is authored here,
 * never a string literal in the loader, because they are her words (or words
 * about her words) and the content seam exists so there is exactly one path for
 * those.
 *
 * `layer` is a literal, as the core's is, so the two files can never be handed
 * to the wrong reader. `exemplarQuery` is authored rather than derived from the
 * situation key so retrieval for one moment is deterministic and reviewable —
 * she can read what her material is being searched for, which is the half of
 * retrieval nobody usually gets to see.
 */
export const voiceOverlaysFileSchema = z
  .strictObject({
    fingerprint: z.strictObject({
      id: z
        .string()
        .min(1)
        .regex(/^[a-z0-9][a-z0-9_-]*$/, {
          message: 'id must be a lowercase slug with no whitespace',
        }),
      title: z.string().min(1),
      layer: z.literal('overlays'),
      version: fingerprintVersionSchema,
      locale: z.string().min(1),
      textFormat: z.string().min(1),
      provenance: z.strictObject({
        status: z.literal('drafted_from_corpus'),
        awaitingSignOffFrom: z.string().min(1),
        note: z.string().min(1),
      }),
      sourceFiles: z.array(z.string().min(1)),
      notes: z.array(z.string().min(1)),
    }),
    overlays: z
      .array(
        z.strictObject({
          situation: voiceSituationSchema,
          label: z.string().min(1),
          /** A note to whoever reviews these. Validated, never sent to the model. */
          when: z.string().min(1),
          heading: z.string().min(1),
          lines: voiceLinesSchema,
          exemplarQuery: z.string().trim().min(1),
        })
      )
      .min(1),
    exemplars: z.strictObject({
      heading: z.string().min(1),
      /**
       * The origin label carried by EVERY emitted passage.
       *
       * The one string in this file that is a safety property rather than copy:
       * it is what tells the model her writing from the person's. It is
       * authored here for the same reason as everything else, and pinned by a
       * test on the emitted block rather than on the loader's return value.
       */
      originLabel: z.string().min(1),
      lines: voiceLinesSchema,
      noneFoundNote: z.string().min(1),
    }),
    /** The body emitted when no overlay matches — never empty, by construction. */
    coreOnly: z.strictObject({
      heading: z.string().min(1),
      lines: voiceLinesSchema,
    }),
    reviewNotes: z.array(
      z.strictObject({
        scope: z.string().min(1),
        note: z.string().min(1),
      })
    ),
  })
  .superRefine((file, ctx) => {
    // Two overlays on one situation is not a validation nicety: selection is a
    // lookup, so the second would be unreachable and whoever authored it would
    // have no way to tell from the file that their lines never ship.
    const seen = new Set<string>();
    for (const [index, overlay] of file.overlays.entries()) {
      if (seen.has(overlay.situation)) {
        ctx.addIssue({
          code: 'custom',
          path: ['overlays', index, 'situation'],
          message: `duplicate situation "${overlay.situation}" — only the first would ever be selected`,
        });
      }
      seen.add(overlay.situation);
    }
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
export type VoiceFingerprintFile = z.infer<typeof voiceFingerprintFileSchema>;
export type VoiceOverlaysFile = z.infer<typeof voiceOverlaysFileSchema>;
