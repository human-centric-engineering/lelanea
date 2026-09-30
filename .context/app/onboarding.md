# Onboarding: the first-run sequence

Description §3.9: the app welcomes, orients, gates and listens, then hands the
person into the journey. §15 builds it one piece at a time, and this doc grows
with it. What exists so far:

| Piece                                 | Where                                        | Task  |
| ------------------------------------- | -------------------------------------------- | ----- |
| The discovery questions as data slots | `lib/app/onboarding/discovery-slots.ts`      | t-101 |
| The names those slots use             | `lib/app/onboarding/discovery-slot-names.ts` | t-101 |
| The Core Set switch                   | `lib/app/onboarding/discovery-config.ts`     | t-101 |
| Weights                               | the questions editor, `/admin/app/content`   | t-101 |
| The journey, started at the gate      | `lib/app/journey/start.ts`                   | t-102 |
| The Onboarding module, `active`       | migration + seed `021-activate-onboarding`   | t-102 |

## The journey starts when the gate passes

Passing the gate creates the person's journey and enters the `onboarding`
node, so its once-only beats can be recorded with `recordNodeProgress`. The
mechanics are in [`journey.md`](./journey.md#a-persons-journey-starts-at-the-gate-15-t-102).

**Onboarding is the one `active` module.** Daybreak's engine enters only a
node whose module is live, and module rows are born `draft`. Owner ruling,
30 Sept 2026: activate Onboarding only, and each other module when its
content lands (Values with t-106). The migration
`20261005100000_app_activate_onboarding_module` moves existing databases and
the seed unit `021-activate-onboarding` moves a fresh one, each only from
`draft`. From then on status is the operator's, at Framework → Modules.

## A discovery answer is a data slot

Owner ruling at claim (journalled on §15): the questions behave like data slots.
Each question is one slot, `discovery_<question id>`, in the `discovery`
group, **declared by the Onboarding module** (owner ruling, 25 Sept 2026: the
questions are Onboarding's, built from Daybreak's elements, see
[`building-with-daybreak.md`](./building-with-daybreak.md)). A person's answer is written as that slot's value, in their
own words. Everything Daybreak does for a slot value then applies with no work
of ours:

- **Subject access.** `framework_slot_value` is in Daybreak's export manifest,
  earlier versions included.
- **Erasure.** The hand-written `ON DELETE CASCADE` on its `userId` removes it.
- **Reading back.** She reads answers through `get_state`, in Onboarding and
  in every later module: `get_state` reads a person's values in every scope,
  filtered only by her allowlist, which names the `discovery` group. Seed 013 writes the allowlist on a fresh database;
  migration `20261002100000_app_discovery_question_weight` adds it to an existing
  grant.
- **The person's own panel.** The slots are `open`, so the person sees and can
  correct their answers.

### Onboarding's slots, declared through Daybreak

The slots are the `slotDefinitions` of the module the question set names
(`AppQuestionSet.moduleId`, Onboarding in her file), handed to Daybreak's
`registerModule()` by `registerJourneyModules()`
(`lib/app/onboarding/discovery-slots.ts`). Daybreak scopes them
`module:onboarding`, and its own module slot sync reconciles them. Nothing of
Daybreak's is edited: the definition is built from `app_discovery_question`,
the one place an admin edits a question's words, the way t-87 builds each
module's name from its row.

- **At boot**, `initLeafApp()` registers the modules from the roster, then
  again with their names and the questions. **Registration never throws**
  (Daybreak's boot contract). A failed read of the questions is logged, and
  the slots are declared as Daybreak last synced them: registering Onboarding
  without its slots would have the module pass retire every one of them. Only
  when that read fails too does the module register without them. A failed
  read of the names only logs, and the names already registered stand (at
  boot, the roster's).
- **After a question write**, `resyncDiscoverySlots()` registers the modules
  again and runs Daybreak's `syncRegisteredSlotDefinitions()`.
- The slots are not rows in `app_slot_definition`, which is the global
  taxonomy. A copy there would be a second editable version of the same words.
- **They are not yet visible in Onboarding's own area.** Daybreak's module
  page (Framework → Modules → Onboarding) has no tab for a module's data
  slots, so it shows only the Core Set switch. Until
  [daybreak#281](https://github.com/human-centric-engineering/daybreak/issues/281)
  ships, the slots are listed on Framework → Slots with scope
  `module:onboarding` (its search does not match on scope), and the words are
  edited in our questions editor. Do not add a tab by editing Daybreak's
  `module-detail.tsx`; take the tab when it arrives on a sync.

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
  not**. Daybreak's module slot sync deactivates its slot, which keeps the last
  wording.
- That deactivated slot is the tombstone. `nextQuestionId()` counts it, so a new
  question takes the id after the highest ever used. An import that would
  re-create it is refused, naming the id.
- Answers filed under a slug count too, with or without a slot. A question
  added while the sync was failing can be answered and then removed before any
  sync projects its slot; its answers still hold the id.

Without that, a new question under a freed id would inherit the old answers as
its own.

## Weights, core questions and the Core Set

Each question has a weight from 0 to 100. **A question weighted 100 is core:
it is always asked and cannot be skipped** (owner ruling, 25 Sept 2026).
`getDiscoverySet()` marks each question `core`. The questions surface (t-104)
offers no way past a core question.

**Core Set only** is the Onboarding module's own config, not a column of ours:
`discoveryConfigSchema` (`lib/app/onboarding/discovery-config.ts`) is the
module's `configSchema`. Daybreak renders it on the module's Config tab
(Framework → Modules → Onboarding), validates every save, and keeps each
version. When it is on, only the core questions are asked. The questions
editor reports its state and links there.

- **The weight is a slider on each question's row**, saved about half a second
  after it is let go of, so the core questions can be chosen down the whole
  list without opening each. Saves go one at a time, because each needs the
  question's current revision. A value let go of during a save is sent once the
  page has refreshed. A refused save says so on the row, shows the stored
  weight again and re-reads the page, so the next attempt carries the current
  revision. The dialog keeps its number field, for a new question. An open
  dialog saves against the revision it opened at, so a slider save landing
  meanwhile makes its save conflict rather than be silently undone.
- **Every question starts at 100 and the switch starts off.** Which questions
  are core is the owner's call, so turning the switch on changes nothing until an
  admin lowers some weights.
- **The Core Set is never empty.** If the switch is on and nothing is weighted
  100, `getDiscoverySet()` asks every question and logs an error. A module config
  that cannot be read or does not parse also asks every question, logged.
- **Numbers are the set's own.** The Core Set skips questions without
  renumbering them, so the person's "question 4" and the admin's are the same
  question.
- **The weight is not in her file.** It is an admin setting. An import of a file
  with no `weight` keeps the stored weights; a file that names a weight applies
  it. An export carries the weights. Restoring an old wording from history keeps
  the current weight, as it keeps the number.
- **The slot's `priorityWeight` stays 0.** Daybreak defines it as sequencing
  ("higher = asked sooner"), and core means something else, so borrowing the
  column would bend Daybreak's meaning.
- **Enforcing "cannot be skipped" beyond the questions surface** would be a
  facilitation-map gate on the way out of Onboarding. Daybreak's `slot`
  conditions compare typed values only and cannot yet test that a free-text
  answer exists: that is an ask of Daybreak, not something we build around it.

## Every question write re-syncs the slots

Every question save, restore, add, removal and import ends in
`resyncDiscoverySlots()` (called from `lib/app/content/admin/registry.ts`),
**including one that changed nothing**. That makes the page's remedy real: when a sync fails,
the page warns that the AI is still reading the questions as they were, and
says to open any question and save it. That save retries the sync. The pass is
idempotent, so an unneeded run writes nothing. A reorder changes no slot and
does not re-sync. **A save of the question set re-syncs too**: the set names
the module that declares the slots and holds the Core Set switch, so moving
it to another module moves both.

**Re-syncs run one at a time.** The module registry is process-global, so two
overlapping writes could each register and the older snapshot be the one
synced while the newer write reported success. `resyncDiscoverySlots()` queues
them, the way Daybreak queues its own global slot sync. A re-sync whose read
of the module names fails keeps the names already registered, so a save
never undoes the names boot read.

A failure on a save (a question's or the set's), add or removal is reported on the page, as the slot editor
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
- **Making them global slots again**, or adding a Core Set column to our
  tables. They are Onboarding's: its slots and its config.
- **Using `priorityWeight` to mean core.** It is Daybreak's sequencing field.
