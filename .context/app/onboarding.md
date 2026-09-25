# Onboarding: the first-run sequence

Description §3.9: the app welcomes, orients, gates and listens, then hands the
person into the journey. §15 builds it one piece at a time, and this doc grows
with it. What exists so far:

| Piece                                 | Where                                        | Task  |
| ------------------------------------- | -------------------------------------------- | ----- |
| The discovery questions as data slots | `lib/app/onboarding/discovery-slots.ts`      | t-101 |
| The names those slots use             | `lib/app/onboarding/discovery-slot-names.ts` | t-101 |
| Weights, and the Core Set switch      | the questions editor, `/admin/app/content`   | t-101 |

## A discovery answer is a data slot

Owner ruling at claim (journalled on §15): the questions behave like data slots.
Each question projects to one slot, `discovery_<question id>`, in the
`discovery` group. A person's answer is written as that slot's value, in their
own words. Everything Daybreak does for a slot value then applies with no work
of ours:

- **Subject access.** `framework_slot_value` is in Daybreak's export manifest,
  earlier versions included.
- **Erasure.** The hand-written `ON DELETE CASCADE` on its `userId` removes it.
- **Reading back.** She reads answers through `get_state`, because `discovery` is
  in her read allowlist. Seed 013 writes the allowlist on a fresh database;
  migration `20261002100000_app_discovery_question_weight` adds it to an existing
  grant.
- **The person's own panel.** The slots are `open`, so the person sees and can
  correct their answers.

### The slots are a projection, not taxonomy rows

The global slot provider registered in `lib/app/leaf-bootstrap.ts` is
`loadAppGlobalSlotDefinitions()`: the authored taxonomy, then one slot per live
question. The question row is where an admin edits a question's words, with
revisions. A copy in `app_slot_definition` would be a second editable version of
the same words, and the two could disagree.

**An empty taxonomy empties the whole answer.** Daybreak's global pass reads an
empty provider as a fluke and retires nothing. If the discovery slots were still
appended when the taxonomy supplied nothing, the answer would not be empty, and
the pass would retire every taxonomy slot. See the provider's docblock.

### Always `sensitive`: the grade that keeps the words

Owner ruling, 25 Sept 2026. **`special_category` does not mask a free-text value;
it discards it.** Daybreak masks before storage, so the person's words become a
redaction sentinel as they are written
(`lib/framework/data-slots/capabilities/masking.ts`). Neither the person nor she
could read them again, and onboarding would have nothing to mirror back.

`sensitive` stores the words. The admin slot browser masks them unless an admin
reveals, and the reveal is audited. So the grade is fixed in code and is not a
per-question setting. `tests/unit/lib/app/onboarding/discovery-slots.test.ts`
runs the projected grade through the real masking policy.

### Hers to read, never hers to write

`GuardedFillSlotCapability` (`lib/app/slots/capture.ts`) refuses any
`discovery_` slug before the framework writes anything, on every path. Her
reading appended as a newer version would replace the person's words as the head
value. The slots are also absent from the capture vocabulary she is shown,
because that list reads the taxonomy alone.

The taxonomy refuses the `discovery_` slug prefix and the `discovery` group key
(`authoredSlotSlugSchema`, `authoredSlotGroupSchema`, used by the editor and the
taxonomy file). No authored slot can take an answer's identity. A person's notes
and the history routes still accept a discovery slug, because they only read it.

## A question id is never given out twice

An answer is filed under its question's id. So:

- A reworded or reordered question keeps its id.
- A removed question's row and history are deleted, but **its answers are
  not**. The global sync deactivates its slot, which keeps the last wording.
- That deactivated slot is the tombstone. `nextQuestionId()` counts it, so a new
  question takes the id after the highest ever used. An import that would
  re-create it is refused, naming the id.
- Answers filed under a slug count too, with or without a slot. A question
  added while the sync was failing can be answered and then removed before any
  sync projects its slot; its answers still hold the id.

Without that, a new question under a freed id would inherit the old answers as
its own.

## Weights and the Core Set

Each question has a weight from 0 to 100. The fully weighted ones (100) are the
Core Set. The set's **Core Set only** switch asks only those.

- **Every question starts at 100 and the switch starts off.** Which questions
  are core is the owner's call, so turning the switch on changes nothing until an
  admin lowers some weights.
- **The Core Set is never empty.** If the switch is on and nothing is weighted
  100, `getDiscoverySet()` asks every question and logs an error.
- **Numbers are the set's own.** The Core Set skips questions without
  renumbering them, so the person's "question 4" and the admin's are the same
  question.
- **Neither is in her file.** They are admin settings. An import of a file with
  no `weight` keeps the stored weights and the switch; a file that names a
  weight applies it. An export carries the weights. Restoring an old wording
  or framing from history keeps the current weight and switch, as it keeps the
  number.
- The slot's `priorityWeight` stays 0. That column sequences her targeted
  capture, and she never captures an answer.

## Every question write re-syncs the slots

Every question save, restore, add, removal and import ends in
`resyncGlobalSlots()` (`lib/app/content/admin/registry.ts`), **including one
that changed nothing**. That makes the page's remedy real: when a sync fails,
the page warns that the AI is still reading the questions as they were, and
says to open any question and save it. That save retries the sync. The pass is
idempotent, so an unneeded run writes nothing. A reorder changes no slot and
does not re-sync.

A failure on a save, add or removal is reported on the page, as the slot editor
does. An import and a history restore only log it: the import has nowhere to
carry the outcome, and the history dialog is shared by every content
collection. The next question save, import or boot repairs either.

## Anti-patterns

- **Grading a discovery question `special_category`** to protect it. That
  destroys the answer. See above.
- **Letting her `fill_slot` a discovery slug**, to "keep the baseline up to
  date". What she learns goes in the taxonomy's slots. The answer stays the
  person's.
- **Reusing a question id**, even for a question on the same theme. The old
  answers would read as answers to the new words.
- **Putting the discovery slots in `app_slot_definition`.** That gives them two
  editors and two wordings.
