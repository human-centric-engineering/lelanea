/**
 * Her notes, as the person they are about reads them — and corrects one
 * (f-slots t-73; product description §3.3, §3.12, §3.19, §12).
 *
 * t-72 made her write what she learns. Until this module there was nowhere to
 * read it: `HB9`'s exact shape — a write surface shipped ahead of its read
 * surface is indistinguishable from a write that is not happening, including to
 * the person it is about. The only proof was a smoke script.
 *
 * ## Three things it must get right, and one of them is a guardrail
 *
 * **Hidden slots never leave the server.** §12: *"Development is a tuning
 * signal, never a grade. It must never rank, score, or display that as a
 * level."* `visibility: hidden` is that mechanism on the read side, the way the
 * exposure allowlist is on hers (`lib/app/agent/pins.ts`). It is applied here as
 * a **withholding of values**, not as a filter on definitions — a value is
 * dropped before anything about it is shaped, so no later branch can put one
 * back.
 *
 * **And it fails closed across both tiers.** A slug counts as hidden if it is
 * hidden in Daybreak's `framework_slot_definition` — the row `fill_slot` itself
 * consults — *or* in our own `app_slot_definition`. The two can disagree:
 * `loadGlobalSlotDefinitions()` withholds a row whose free-form classifier it
 * does not recognise, so a slot marked hidden by an admin can have a stale
 * projection or none at all. Reading either table alone leaves a case where a
 * development-stage reading reaches a member; reading both leaves none.
 *
 * **A retired slot still has answers, and they still belong to the person.**
 * Retirement deactivates the projection; it deletes nothing, at either tier. So
 * a note under a retired slug is shown, labelled, and not correctable — she is
 * no longer asking, and letting someone file a fresh reading against a question
 * nobody will ask again is a write nothing will ever read.
 *
 * ## Why a withheld note cannot be corrected
 *
 * Nine slots in the taxonomy are `special_category` — physical, emotional and
 * spiritual health, GDPR Art. 9. For those, masking-before-storage replaces the
 * reading with a sentinel *at capture*
 * (`lib/framework/data-slots/capabilities/masking.ts`). That is the point of the
 * classification, and it is why the panel shows a sentence rather than
 * `<redacted: special_category>`.
 *
 * **The reading, and only the reading.** Masking covers `value` and nothing
 * else: the reasoning note is stored as she wrote it, a paraphrase of what the
 * person said (`voice.md`). So what the app keeps is a summary, not "nothing",
 * and it is shown — owner ruling, t-80: the gist is the compromise that keeps
 * the note worth having. Nothing here may say the words were never kept.
 * Whether to mask the reasoning at capture as well is Daybreak's question
 * ([`daybreak#269`](https://github.com/human-centric-engineering/daybreak/issues/269)).
 *
 * A correction would run through {@link appendSlotValue}, which is the raw
 * engine and masks nothing. So the obvious "let them fix it" puts raw health and
 * belief prose at rest through the one door built to keep it out — and the
 * alternative, masking the correction, stores a sentinel over a sentinel and
 * tells the person their words were kept when they were discarded. Neither is
 * honest, so the correction is refused and the remedy shipped beside it
 * (`HB10`): *ask her about it*, which routes the words back through the capture
 * path where the masking applies.
 *
 * ## The history read is a stopgap, and is commented upstream
 *
 * `getSlotHeads()` returns current values only, and Daybreak has no history
 * read — `daybreak#156` / `daybreak#162`. §3.12 needs exactly one row more than
 * the head: the version before it, so a contradiction can be shown as a door
 * rather than an error. That is read straight off `framework_slot_value` here,
 * in **one** query for the whole page.
 * Delete {@link readPreviousVersions} and call the framework's reader when one
 * lands.
 *
 * Our case is on both issues as of 21 September 2026: we have no runs, so none
 * of `runId` applies to us, and we still land in the same missing cell from the
 * other side — many slugs, one user, one version back.
 *
 * Per-answer deletion has no path at all — erasure takes the account or nothing
 * (gap 5). Filed as **t-78 on `f-memory`**, which owns deletion propagation,
 * with the framework half raised as a paragraph on `daybreak#156`.
 *
 * @see lib/app/slots/notes-view.ts — the wire shape
 * @see .context/app/slots.md — "Her notes"
 */

import { z } from 'zod';

import { prisma } from '@/lib/db/client';
import { ConflictError, NotFoundError } from '@/lib/api/errors';
import {
  appendSlotValue,
  getSlotHeads,
  listSlotDefinitions,
  SLOT_SENSITIVITY,
  SLOT_SOURCE_TYPE,
  SLOT_VISIBILITY,
} from '@/lib/framework/data-slots';
import { getSlotDefinition } from '@/lib/framework/data-slots/queries';
import { redactedString } from '@/lib/security/redact';
import type { Note, NoteHistory, NotesView } from '@/lib/app/slots/notes-view';
import { queryNotes, type NotesQuery } from '@/lib/app/slots/notes-query';

/** What masking leaves behind for an Art. 9 slot. Compared, never constructed twice. */
const WITHHELD = redactedString('special_category');

/**
 * The one line stored against a correction, so a later reader of the row knows
 * it was not her reading. `sourceType` already says so; this says it in the
 * place the panel actually prints.
 */
export const CORRECTION_NOTE = 'The person corrected this themselves, in Lelañea’s notes.';

/**
 * A correction is stored at full confidence. `confidence` is "how sure the
 * reading is", and a person stating something about themselves is the most
 * certain source the scale has — it is the same judgement `user_confirmed`
 * encodes, in the column that is read numerically.
 */
export const CORRECTION_CONFIDENCE = 10;

/** `provenance.conversationId`, read leniently — a row that lacks one is not a broken row. */
const provenanceSchema = z.object({ conversationId: z.string().min(1).optional() });

function conversationOf(provenance: unknown): string | null {
  const parsed = provenanceSchema.safeParse(provenance);
  return parsed.success ? (parsed.data.conversationId ?? null) : null;
}

/**
 * What our own taxonomy says about the slugs where the answer matters: which are
 * hidden, and which are special-category.
 *
 * ## Both halves of the union, from one read
 *
 * See the header: the two tiers can disagree, and only their **union** is
 * fail-closed. `framework_slot_definition` is the row the write path judged the
 * slot by; `app_slot_definition` is the taxonomy an admin actually edits. This
 * started as a hidden-set only, and the correction route then learned to read
 * both tiers for sensitivity too (`/security-review`) — while this read went on
 * reading only the projection. So a slot our taxonomy marked special-category
 * was offered for correction here and refused on save there: a button that
 * could never work, on the one kind of note where a dead end is least
 * forgivable. Found by `/code-review`. The read and the write now take the same
 * stricter-of-both answer, from the same query shape.
 *
 * Narrowed to the rows that can change an answer — a slug our taxonomy calls
 * open and standard adds nothing to the projection's verdict.
 */
async function ourVerdicts(): Promise<{
  hidden: Set<string>;
  specialCategory: Set<string>;
}> {
  const rows = await prisma.appSlotDefinition.findMany({
    where: {
      OR: [
        { visibility: SLOT_VISIBILITY.hidden },
        { sensitivity: SLOT_SENSITIVITY.special_category },
      ],
    },
    select: { slug: true, visibility: true, sensitivity: true },
  });
  return {
    hidden: new Set(rows.filter((r) => r.visibility === SLOT_VISIBILITY.hidden).map((r) => r.slug)),
    specialCategory: new Set(
      rows.filter((r) => r.sensitivity === SLOT_SENSITIVITY.special_category).map((r) => r.slug)
    ),
  };
}

/**
 * The version immediately before each head, in one query.
 *
 * `version - 1` rather than "the newest superseded row": versions are monotonic
 * per `(userId, slotSlug)` from 1 and the engine never deletes, so the
 * predecessor is arithmetic rather than a second ordering. A head at version 1
 * has none and is not asked about.
 *
 * The empty case short-circuits deliberately — Prisma reads `OR: []` as "match
 * nothing", which is right here but only by luck, and a round trip to prove a
 * list is empty is a round trip.
 */
async function readPreviousVersions(
  userId: string,
  heads: { slotSlug: string; version: number }[]
): Promise<Map<string, NoteHistory>> {
  const wanted = heads
    .filter((head) => head.version > 1)
    .map((head) => ({ slotSlug: head.slotSlug, version: head.version - 1 }));
  if (wanted.length === 0) return new Map();

  const rows = await prisma.slotValue.findMany({
    where: { userId, OR: wanted },
    select: {
      slotSlug: true,
      version: true,
      value: true,
      sourceType: true,
      confidence: true,
      capturedAt: true,
    },
  });

  return new Map(
    rows.map((row) => [
      row.slotSlug,
      {
        version: row.version,
        value: row.value,
        withheld: row.value === WITHHELD,
        sourceType: row.sourceType,
        confidence: row.confidence,
        capturedAt: row.capturedAt.toISOString(),
      },
    ])
  );
}

/**
 * Everything she currently holds about this person — and nothing else — as the
 * page asked to see it.
 *
 * Four queries for the whole panel, whatever the number of notes: the heads,
 * the definitions, our own verdicts on hidden and special-category slugs, and
 * one batched read for the previous versions. No per-row fetch on either side
 * of the wire.
 *
 * ## The search, the filter and the sort come last, over the cleaned list (t-79)
 *
 * `query` is applied by {@link queryNotes} to the notes this function has
 * already shaped — after the hidden slots are gone. There is no query path
 * that reaches a value before that removal, so the guardrail is still enforced
 * in exactly one place. See `notes-query.ts` for why this is not SQL.
 */
export async function getNotes(userId: string, query: NotesQuery = {}): Promise<NotesView> {
  const heads = await getSlotHeads(userId);
  if (heads.length === 0) return queryNotes([], query);

  const definitions = await listSlotDefinitions();
  const ours = await ourVerdicts();
  const hidden = new Set([
    ...definitions.filter((d) => d.visibility === SLOT_VISIBILITY.hidden).map((d) => d.slug),
    ...ours.hidden,
  ]);

  // Withheld first, and before anything is shaped: a value that must not leave
  // the server should not exist in a structure a later branch can read from.
  const shown = heads.filter((head) => !hidden.has(head.slotSlug));
  if (shown.length === 0) return queryNotes([], query);

  const previous = await readPreviousVersions(userId, shown);
  const byslug = new Map(definitions.map((definition) => [definition.slug, definition]));

  const notes: Note[] = shown.map((head) => {
    const definition = byslug.get(head.slotSlug) ?? null;
    // The stricter of the two tiers — the same answer `correctNote` reaches, so
    // what this offers and what that accepts cannot disagree. The search reads
    // it too: an Art. 9 note is matched on its wording only (`notes-query.ts`).
    const sensitivity = ours.specialCategory.has(head.slotSlug)
      ? SLOT_SENSITIVITY.special_category
      : (definition?.sensitivity ?? SLOT_SENSITIVITY.standard);
    const retired = definition ? !definition.isActive : false;
    const withheld = sensitivity === SLOT_SENSITIVITY.special_category && head.value === WITHHELD;

    return {
      slotSlug: head.slotSlug,
      asking: definition?.description ?? null,
      value: head.value,
      withheld,
      confidence: head.confidence,
      sourceType: head.sourceType,
      reasoningNote: head.reasoningNote,
      version: head.version,
      capturedAt: head.capturedAt.toISOString(),
      conversationId: conversationOf(head.provenance),
      sensitivity,
      retired,
      // Not `!withheld`: an Art. 9 slot whose head somehow holds prose is still
      // a slot whose corrections cannot be stored, and the reason is the
      // classification rather than what one row happens to contain.
      correctable: !retired && sensitivity !== SLOT_SENSITIVITY.special_category,
      previous: previous.get(head.slotSlug) ?? null,
      // An open-mode mint has no definition, and so no group.
      group: definition?.group ?? null,
    };
  });

  return queryNotes(notes, query);
}

export interface NoteCorrection {
  userId: string;
  slotSlug: string;
  value: string;
}

/** What a correction produced. The panel re-reads the page rather than patching a row. */
export interface CorrectedNote {
  slotSlug: string;
  version: number;
}

/**
 * The person's own words, as a new version — never an overwrite.
 *
 * Three refusals, each closing a different door:
 *
 * - **No head under that slug**, or a hidden one: `404`, and the *same* 404 for
 *   both. Without it this route mints: a body naming any slug at all would
 *   write a first version of it, so a correction surface would double as an
 *   unbounded self-write. And answering differently for a hidden slug would
 *   disclose that one exists and is filled, which is the thing §12 forbids.
 * - **A retired slot**: `409`. The question is no longer asked, so a fresh
 *   reading against it is a write nothing will read.
 * - **An Art. 9 slot**: `409`, with the remedy in the message — see the header.
 *
 * `appendSlotValue` does the rest, and does it insert-only: the prior head is
 * stamped `supersededAt` and stays exactly as it was, which is what makes the
 * contradiction a door (§3.12) rather than a loss.
 */
export async function correctNote(input: NoteCorrection): Promise<CorrectedNote> {
  const definition = await getSlotDefinition(input.slotSlug);

  // Both tiers, as in the read — and before the head lookup, so a hidden slot
  // takes the same path whether or not it has ever been filled.
  const ours = await prisma.appSlotDefinition.findUnique({
    where: { slug: input.slotSlug },
    select: { visibility: true, sensitivity: true },
  });
  const isHidden =
    definition?.visibility === SLOT_VISIBILITY.hidden ||
    ours?.visibility === SLOT_VISIBILITY.hidden;

  const [head] = isHidden ? [] : await getSlotHeads(input.userId, { slotSlugs: [input.slotSlug] });
  if (!head) {
    throw new NotFoundError('There is no note under that heading to correct.');
  }

  if (definition && !definition.isActive) {
    throw new ConflictError(
      'Lelañea is no longer asking about this, so a correction to it would never be read.',
      {
        reason: 'no_longer_asked',
      }
    );
  }

  // Both tiers again, for the reason the hidden check reads both: they can
  // disagree, and only the union fails closed. `/security-review` found this
  // reading the projection alone — not exploitable, since a slot the projection
  // calls `standard` was never masked at capture either, so a correction could
  // only replace the person's own raw words with other raw words. But the rule
  // this module states is that a disagreement between the tiers resolves to the
  // stricter answer, and the one check that did not was the one guarding Art. 9
  // prose.
  const isSpecialCategory =
    definition?.sensitivity === SLOT_SENSITIVITY.special_category ||
    ours?.sensitivity === SLOT_SENSITIVITY.special_category;
  if (isSpecialCategory) {
    // Printed verbatim by the panel, so it follows the panel's register:
    // Lelañea by name, never "she" or "her" (`.context/app/slots.md`).
    throw new ConflictError(
      // Says nothing about what is stored: this refusal is by classification,
      // so it also reaches a note captured before its slot was marked, whose
      // words were kept (`/code-review`, t-80).
      'Notes on this subject can’t be corrected here. Ask Lelañea about it instead, in your own words.',
      { reason: 'kept_out_of_the_record' }
    );
  }

  const written = await appendSlotValue({
    userId: input.userId,
    slotSlug: input.slotSlug,
    value: input.value,
    confidence: CORRECTION_CONFIDENCE,
    sourceType: SLOT_SOURCE_TYPE.user_confirmed,
    reasoningNote: CORRECTION_NOTE,
    // Empty on purpose: provenance answers "which exchange did this come from",
    // and this one came from no exchange. `sourceType` is what says where it did
    // come from, and inventing a field for it would put a key in the column the
    // framework's own type does not declare.
    provenance: {},
  });

  return { slotSlug: written.slotSlug, version: written.version };
}
