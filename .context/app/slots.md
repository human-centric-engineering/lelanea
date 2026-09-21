# The slot taxonomy — what the app aims to learn, as data

What Lelañea learns about a person is a **slot value**; what she is looking for
is a **slot definition**. This document covers both: where the taxonomy lives
and how it changes, how she fills it, and — since t-73 — how the person it is
about reads it back, corrects it, or argues with it ("Her notes", below).

**Locations:** `content/lelanea_slot_taxonomy.json` (the v1 draft) ·
`lib/app/content/slot-taxonomy.ts` (schema + loader) ·
`lib/app/slots/taxonomy-store.ts` (the store, and the provider) ·
`prisma/seeds/app-lelanea/011-slot-taxonomy.ts` (the one-time load) ·
`prisma/schema/app.prisma` (`AppSlotDefinition`, `AppSlotDefinitionRevision`)

## Two tiers, and which one is authoritative

| Table                          | Tier     | Holds                                                      |
| ------------------------------ | -------- | ---------------------------------------------------------- |
| `app_slot_definition`          | ours     | the current wording of each global slot — **the taxonomy** |
| `app_slot_definition_revision` | ours     | one full snapshot per version — **the history**            |
| `framework_slot_definition`    | Daybreak | a projection of the above, stamped `scope = global`        |
| `framework_slot_value`         | Daybreak | what was actually learned about a person                   |

**The `app_` tables are the source; the framework table is downstream of them.**
Nothing writes `framework_slot_definition` directly. A provider registered from
`lib/app/leaf-bootstrap.ts` reads our active rows, and Daybreak's global pass
reconciles them (`lib/framework/data-slots/sync.ts`). That seam is carried ahead
of Daybreak — [`divergences.md`](./divergences.md) Row 22, proposed upstream as
`daybreak#266` — and this taxonomy is its first production caller.

The framework table carries **no history**, which is why ours does: the editor
is ours, so the version chain is too.

## The shape of a definition

Eight authored fields, listed once in `SLOT_DEFINITION_FIELDS`
(`lib/app/slots/taxonomy-store.ts`) so the snapshot, the change diff and the
seed all derive from one place rather than three hand-kept lists.

| Field            | Meaning                                                         |
| ---------------- | --------------------------------------------------------------- |
| `group`          | thematic cluster; must be one the file declares                 |
| `description`    | what the slot means — also the words the capture agent is given |
| `visibility`     | `open` (the person sees and corrects it) or `hidden`            |
| `mode`           | `targeted` (pre-declared) or `open` (minted at runtime)         |
| `dataType`       | `text` · `number` · `boolean` · `date` · `json`                 |
| `sensitivity`    | `standard` · `sensitive` · `special_category`                   |
| `priorityWeight` | sequencing input; higher is asked sooner                        |
| `isActive`       | false once retired — the row stays                              |

Plus `slug` (the identity) and `version` (the current one), neither of which is
an authored field: one never changes and the other is derived from the history.

**There is no `scope` column.** Every row here is global by construction — the
framework sync stamps the scope — and storing it would be a second copy that can
disagree with the only one that matters.

The classifiers are free-form `String`, mirroring `framework_slot_definition`
for the framework's own reason (convention X1: a new vocabulary value must not
be a migration). They are validated at both ends instead — at parse in
`slot-taxonomy.ts`, and again on the way out of the store.

## The six groups

Drafted from the product description §5, which carries the framework overview's
taxonomy forward as-is. **53 slots in v1, and the list itself is the owner's
decision** — the file ships `provenance.status: draft`.

| Group                 | Slots | What it holds                                                                      |
| --------------------- | ----- | ---------------------------------------------------------------------------------- |
| `life_areas`          | 21    | seven areas × how it stands, where it strains, where it is working                 |
| `the_person`          | 10    | disposition, patterns, self-story, psyche, aspirations, blind spots                |
| `external_conditions` | 6     | the situation around them and the limits it sets                                   |
| `preferences`         | 8     | how they want to be met, and how they answer different kinds of question           |
| `development`         | 3     | where they sit in examining their own conditioning — **hidden in full**            |
| `module_output`       | 5     | values, standards, boundaries, commitments, so module work travels with the person |

### `development` is hidden, and that is a guardrail rather than a default

§12: _"Development is a tuning signal, never a grade. It must never rank, score,
or display that as a level."_ `visibility: hidden` is the mechanism — the value
never leaves the server to a member. The content test asserts it **in both
directions**: a development slot that became `open` would reach her notes
(`/app/notes`), and an unrelated slot that became `hidden` would be withheld
from the person it is about for no reason.

### `sensitivity` classifies the slot, not the answer

A `sensitive` slot can still receive something that is special-category in fact
— what someone says about their relationships may disclose their health or their
orientation. Masking that is the capture capability's job (`f-slot-capture`),
which **keys on** this classification rather than being replaced by it. Do not
promote every slot to `special_category` to be safe; that empties the
distinction the masking reads.

## The change rule

**A slug is immutable.** It is what a captured `framework_slot_value.slotSlug`
points at, so renaming one would orphan every answer already given under it.

> **A rename is an add plus a retire.** (Owner ruling, 19 September 2026.)

Retiring sets `isActive = false`. The row stays, the framework sync deactivates
its projection, and every value captured under it keeps resolving. Nothing is
deleted, at either tier.

Every edit that changes a field writes **one revision** and bumps `version`. An
edit that changes nothing writes neither — `changedDefinitionFields()` returning
empty is what makes that true, and it is derived from
`SLOT_DEFINITION_FIELDS`, so a column added to the model without being added
there would let an edit to it pass unrecorded.

## Matching an answer to the wording it was captured under

This is the question the history table exists for, and it is **a read at a
timestamp, not a replay of diffs** — which is why each revision is a full
snapshot of the definition rather than a list of changes:

> the newest revision for that slug whose `changedAt` is at or before the
> value's `capturedAt`.

```sql
SELECT * FROM app_slot_definition_revision
WHERE "slotSlug" = $1 AND "changedAt" <= $2
ORDER BY "changedAt" DESC
LIMIT 1;
```

`@@index([slotSlug, changedAt])` is on the table for exactly this. Version 1's
`changedFields` lists every field, because against nothing everything is new —
so the editor's history view reads v1 as the creation rather than as a change to
eight fields at once.

**Do not read the current `app_slot_definition` row to explain an old answer.**
It is the wording as it stands today, and the whole point of the history is that
those differ.

## Seeding — operator-owned, written once (`fp4`)

`prisma/seeds/app-lelanea/011-slot-taxonomy.ts` loads the bundled file into the
tables while the table is **empty**, and never again.

**Emptiness is the marker, not the absence of a given slug.** A retired row is
still a row, so a per-slug "create if absent" would revive every slot an admin
had retired, on every seed run. That case is in the seed's test.

Consequences worth knowing:

- A slot **added to the file** after seeding does not reach a seeded database.
  Once seeded, the tables are the taxonomy and the editor is how a slot is
  added. **An edit to the JSON reaches an unseeded database, and nothing else.**
- **Safe on empty**, twice over: the unit has no removal pass at all, and
  Daybreak's global pass reads "the provider supplied nothing" as a fluke rather
  than as "retire them all".

The seed calls `syncGlobalSlotDefinitions()` itself, and that call is
load-bearing: on a fresh database `prisma/seeds/_framework/000-framework-boot.ts`
runs **before** it, so the boot-time global pass correctly finds an empty table and
writes nothing. Without the call, `framework_slot_definition` would hold no
global row until the next server boot — and `db:reset` in CI never boots a
server.

It also calls `initLeafApp()` first, because the boot unit that would otherwise
have registered the provider is skipped on an incremental `db:seed`.

If that sync does not report `synced` on a run that just wrote definitions, the
unit **throws**. The rows exist but nothing can read them, and a status that was
merely logged would let the runner stamp `SeedHistory` — after which the unit is
skipped forever and the repair never runs.

### Re-seeding does not repair a lost projection

`prisma/runner.ts` skips any unit whose source hash matches its `SeedHistory`
row, and this unit declares no `hashInputs`. So on a database it has already
applied to, **`db:seed` never enters `run()` at all** — it prints
`unchanged, skipping`.

That matters most in the case you would reach for it. If
`framework_slot_definition` loses its global rows — restored from an older dump,
say — re-seeding changes nothing. What repairs it is a **server boot**, whose
`syncRegisteredSlotDefinitions()` runs the same global pass, or `db:reset`.

**After merging a change to the taxonomy file, reseed each database** — and
reseeding only helps a database that was never seeded. See
[`sunrise.mcp-reseed`](../../CLAUDE.md) for the general shape of this trap.

## Anti-patterns

**Do not fall back to the bundled file at read time.** The crisis resource does
(`lib/app/safety/resources-store.ts`) because a crisis turn must never depend on
a database read succeeding. A slot definition is not that, and a fallback would
be actively wrong in the case that matters: on a database where an admin has
retired a slot, a boot that failed to read the table would re-supply the retired
slug and the sync would dutifully reactivate its projection.

**Do not hand the sync a `scope`.** It stamps `global` itself. Supplying one
would put a second copy of the partition key in the payload.

**Do not restate the sync's contract in prose — cite the test that states it.**
Everything this document says about what Daybreak's global pass does with what
we hand it comes from
`tests/integration/lib/framework/data-slots/global-slots.test.ts`, whose case
names are the contract:

| Case                                                                              | What it means for us                     |
| --------------------------------------------------------------------------------- | ---------------------------------------- |
| _"a slug the provider drops is deactivated"_                                      | omission **is** the retirement mechanism |
| _"an empty provider on a fluke boot leaves every global row active"_              | omitting **everything** retires nothing  |
| _"re-syncing after an edit writes the edit, and re-syncing again writes nothing"_ | the pass is idempotent                   |

This rule is written from experience rather than tidiness: three comments in
this feature described that contract in prose, each re-read from `sync.ts`
rather than from the test, and `/code-review` found all three wrong — one of
them in the round immediately after it had been "corrected". The test fails if
Daybreak changes the behaviour; prose does not. That matters more than usual
here, because the seam is carried ahead of Daybreak
([`divergences.md`](./divergences.md) Row 22) and the upstream version may not
behave identically.

**So: "row withheld" does not mean "slot retired" — it depends what survived.**
A stored row whose classifier the framework does not recognise is dropped rather
than passed on. With other rows surviving, row one of the table applies and the
slot stops being asked: fail-closed, which is what we want. With **every** row
withheld, row two applies — nothing is retired and the stale projections stay
live, so the slots keep being asked under their old wording. That is the
fail-**open** case, and `loadGlobalSlotDefinitions()` gives it its own log line
for exactly that reason.

**Do not hand the sync retired rows.** Withholding them _is_ the retirement
mechanism. `loadGlobalSlotDefinitions()` filters on `isActive: true`, and that
filter is pinned in two tests — the store's own, and the `leaf-bootstrap.ts` row
in `defaults.test.ts`, which sees it from the seam.

**Do not add a `mode: open` definition.** A definition row _is_ the
pre-declaration; open-mode capture mints a slug with no backing row, which is
why `framework_slot_value.slotSlug` is not an FK. The taxonomy is the targeted
set, not the whole vocabulary.

**Do not export the definition tables as subject data.** They hold the
questions, not the answers; what the app learned about a person is a
`framework_slot_value`, declared by the framework tier. Both are excluded in
`lib/app/leaf-data-export.ts` with reasons written for a data subject —
including an administrator, whose account id `editorId` retains.

**Do not make `editorId` cascade.** The history is about the taxonomy, not the
editor. Erasing one admin's account must remove their identity from the record;
under `CASCADE` it would also delete the wording history that _other_ people's
answers resolve through. `ON DELETE SET NULL`, hand-written in the migration and
pinned by a drift probe in `lib/app/leaf-db-drift.ts`. `origin` survives the
null, so a row left by an erased admin still reads as an admin edit rather than
as the seed.

## The editor — `/admin/app/slots` (t-71)

**Locations:** `lib/app/slots/definitions-admin.ts` (the store) ·
`lib/app/slots/validation.ts` (the schemas) · `lib/app/slots/endpoint.ts` (the
paths) · `app/api/v1/admin/app/slots/**` (eight handlers in seven files) ·
`app/admin/app/slots/page.tsx` + `components/app/admin/slot-definitions.tsx`

**This table is the roster.** Count the surface from here, not from the ordinal
in the line above — and if you add a route, add its row.

| Route                           | Does                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/admin/app/slots`   | every definition, **retired included**, plus the group keys in use |
| `POST /api/v1/admin/app/slots`  | add one, at v1                                                     |
| `PUT .../slots/[slug]`          | reword one                                                         |
| `PUT .../slots/[slug]/active`   | retire or restore                                                  |
| `GET .../slots/[slug]/history`  | every past version, newest first                                   |
| `POST .../slots/upload/preview` | what a file would do                                               |
| `POST .../slots/upload`         | do it                                                              |
| `GET .../slots/export`          | the taxonomy as a file the upload accepts ("Export" below)         |

All `withAdminAuth`. Rate limiting is the `admin` section tier in `proxy.ts`;
no handler adds a per-flow cap, including the upload, which is a no-op on a
repeat.

**What bounds an uploaded file is the schema, not the platform.** There is no
platform-wide body-size ceiling — `lib/api/multipart-guard.ts` guards
`request.formData()` only, and both upload routes' docblocks once claimed a
ceiling that does not exist. The bound is `slotTaxonomyFileSchema.slots`,
`.min(1).max(1000)`, and it lives on the schema so the preview, the apply, the
seed and the export's round-trip check all inherit the same one. The upload's
work is bounded by the file, not by the stored taxonomy.

### The store is not the provider, and its reader is not `listSlotDefinitions`

`taxonomy-store.ts` is the **provider**: `isActive: true`, the columns the sync
needs. `definitions-admin.ts` is the **editor's** store: every row, plus
`version`, `createdAt`, `updatedAt`. The two share `SLOT_DEFINITION_FIELDS`,
`StoredSlotDefinitionFields` and `changedDefinitionFields()` and nothing else —
widening the provider's select for the editor's sake would make every boot fetch
three columns it never reads.

**And the reader is `getSlotTaxonomyAdminView()`.**
`lib/framework/data-slots/queries.ts` already exports `listSlotDefinitions()`
through the framework barrel, and it reads the _projection_ — no history, and no
way to tell our retirement from a deactivation. A leaf function by that name is
one import away from being the wrong one.

### The lock: an integer `version`, compared twice

Every write that changes a row sends the version the admin read. It is checked
before anything is touched, and again inside the write via a conditional
`updateMany` — so a save racing another _between_ those two is refused as well,
and the refusal rolls the revision back with it.

A stale save is a **409** with `details.reason: 'version_moved'` and
`currentVersion`, and a message naming both versions. The page shows that
message verbatim; it is the only thing that tells the admin what happened.

**The shape is the crisis-resources editor's; the reasoning is not.** There,
`version` exists for the lock. Here it _is_ the revision number, so a lost
update would leave `app_slot_definition_revision` claiming a version whose
wording nothing stored ever had.

### What each write does, and what a no-op does not

A write that changes a field: one revision, `version + 1`, one audit entry, one
`syncGlobalSlotDefinitions()`. A write that changes nothing: **none of those
four.** That is the change rule above, and it is why the page says "Nothing had
changed, so nothing was written" rather than reporting a new version.

Retirement runs through the same machinery — `isActive` is a field like any
other — which is why retiring appends history and bumps the version.

### A failed re-sync is reported, not thrown

The sync runs _after_ the transaction commits. If it fails, the edit is still
saved, so throwing would surface a 500 on a request that did write. The store
returns a `SlotSyncOutcome` instead and the page shows an amber warning naming
the remedy (`HB10`): save again — the pass is idempotent and serialised — or
restart the server.

`not_needed` and `empty` are **different**, deliberately. The first means the
pass never ran because nothing changed. The second is the framework's, and means
it ran and the provider handed it nothing — every slot retired, in which case
that last retirement is not propagated. The page says different things about
them.

### Upload: one planner, two callers

`planTaxonomyUpload(file, mode, stored)` is pure, and both the preview and the
apply call it. That is what makes "the preview matches what apply does" a
property of the code rather than two implementations kept in step by hand.

- **`merge`** adds what is missing, rewords what differs, and leaves a slug the
  file does not mention exactly as it is.
- **`replace`** does that and additionally retires the slugs the file omits.

Neither deletes. **Neither retires anything the preview did not name**, and the
page will not enable Apply until a preview has been read — editing the file or
changing the mode takes the plan back down.

The file is parsed by `slotTaxonomyFileSchema`, the same schema the seed uses,
so the admin reads the same referential errors. A `mode: open` row is refused by
name rather than coerced.

**Apply re-plans inside its own transaction** and returns the plan that _ran_,
which the page then shows. A row someone saved between the preview and the apply
is therefore reconciled as it actually is, and the admin sees that rather than
the plan they clicked.

#### A retired slug listed in the file stays retired

The file format has no `isActive`, so a retired slug appearing in it is
indistinguishable from one that was never retired. Reviving it on that evidence
is the seed's own documented trap, one step removed. It goes in the plan's
`skippedRetired` list instead, and restoring is a deliberate act with its own
route.

#### Idempotent by construction, not by a guard

Every write is driven by `changedDefinitionFields()`, so a second apply of the
same file finds its creates stored and identical, its updates applied and its
retirements retired — and plans nothing.

### Export, and the round trip

`GET .../slots/export` answers a JSON attachment in the **same format the
upload accepts**, so export → edit → import is a real round trip rather than
two formats that resemble each other.

**The panel fetches it; it is not a plain `<a href download>`.** A link was the
first shape, justified as following the waitlist export — but that is the wrong
precedent: the waitlist is the **outlier**, and every other download in the tree
(Sunrise's backup panel and agent export, our own Art. 15 row in
`components/app/account/export-data-row.tsx`) already fetches.

The reason is that this route refuses in the two cases below, and a link answers
a refusal by saving the JSON error envelope to disk while the page stays silent.
`unexportable`'s message is the one that _names the offending rows_, so it is
the message that most has to be read. `export-data-row.tsx` records the same
lesson from t-11, where navigating to an Art. 15 route put a raw
`{"success":false,…}` in a tab — including the detail that the blob URL must
outlive the click (Firefox and Safari read it asynchronously), which is why both
revoke after a minute rather than on the next tick.

**`components/app/admin/waitlist-table.tsx` still has the plain link** and the
same latent gap. It is ours — absent from both upstreams — so there is nothing
to file upstream; it is a follow-up on this codebase, deliberately not bundled
into t-71.

That is an **invariant, not an intention**: `exportTaxonomyFile()` parses what
it is about to return with `slotTaxonomyFileSchema` — the seed's own schema —
and throws rather than hand out a file the import would reject. The store's
test closes the loop by planning an upload of a fresh export and asserting it
writes nothing.

Three things it does not carry, each said in the file's own `notes` so the
statement travels with the download:

- **Retired definitions.** The format has no `isActive`, so exporting them
  would write them as active — and importing that into a fresh database would
  resurrect every retirement ever made. **An export is therefore not a backup**,
  and the page says so beside the button.
- **Group titles and descriptions**, which are not stored (below). They are
  filled in from the key rather than read out of the bundled file, which would
  put prose in the download that never described these rows.
- **Versions and history**, which stay in the database. A file is the wording,
  not the record of how it got there.

It refuses rather than degrades in two cases: nothing active to export
(`reason: 'nothing_to_export'`), and a stored row whose free-form classifier is
not in the vocabulary (`reason: 'unexportable'`, naming the rows). The second
is the one worth understanding — `loadGlobalSlotDefinitions()` _withholds_ such
a row from the sync, and an export must not copy that behaviour: a file
silently missing a definition is how a round trip deletes one.

**No per-flow rate limit**, unlike the waitlist export it is modelled on. That
sub-cap exists because each waitlist download is a copy of other people's email
addresses leaving the building. This file holds the questions, not the answers
— the same reason both definition tables are exclusions in
`lib/app/leaf-data-export.ts` — so the `admin` section tier is the right and
only cap.

### Groups are derived from the rows, not from the file

`app_slot_definition.group` is a free string and there is no group table. The
editor's picker is the distinct groups **in use**, because once seeded the tables
are the taxonomy — reading the bundled file for a vocabulary would let an admin
move a slot into a group no row has, and stop them moving it into one an upload
introduced.

The file's group `title` and `description` are therefore not read back anywhere;
they were decoration on a column that stores a key. **Creating a group from the
editor is not in t-71** — an upload can introduce one, and allowing free text
later is a one-field change with no migration.

### The page calls them "data slots"

In admin copy the unit is a **data slot**, not a "slot" — and the model is
**"the AI"**, never "she". The persona belongs to the member-facing product;
an operator reading this page is looking at configuration. This document keeps
"slot definition" and "slot value" because those are the framework's own table
and type names.

### What an admin cannot do here, and why the surface says so

- **Edit a slug.** Shown, disabled, with the remedy beside it. The routes refuse
  a `slug` in the body rather than ignoring it: someone who thought they were
  renaming a slot has to be told they were not, or they will believe the old
  answers followed.
- **Delete anything.** There is no `DELETE` on any route. "Retire" is the word
  on the button, retired rows stay on the page, and Restore is one click.
- **Choose `mode`.** Never offered; every row is written `targeted`.

## Capture — she writes the profile herself (t-72)

**Locations:** `lib/app/slots/capture.ts` (the guard) · `lib/app/slots/vocabulary.ts`
(what she can see) · `lib/app/capabilities.ts` (the mount) ·
`lib/app/agent/pins.ts` (`SLOT_CAPABILITY_SLUGS`, `SLOT_EXPOSURE_CONFIG`) ·
`lib/app/voice/fingerprint.ts` (when to write) ·
`lib/app/voice/context-contributor.ts` (where the vocabulary is spliced in) ·
`prisma/seeds/app-lelanea/013-agent-slot-tools.ts` (the grant) ·
`scripts/app/smoke-slot-capture.ts`

She holds `get_state` and `fill_slot` and calls them inside her own tool loop.
There is **no side extractor** — owner ruling at claim: a second model reading
untrusted text with write access to the profile was rejected, and so was
delaying `done` to run one.

### The grant, and the two halves of the allowlist

| Facet             | What it says                           | Why                                                                |
| ----------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `write`           | **absent** — she may write anything    | Any restriction also forbids minting; the owner ruled she may mint |
| `read` → `groups` | every group whose slots are all `open` | §12 — a `development` slot must never reach a sentence she says    |

Daybreak's facet filters on `group` and `scope` only, and **a minted slug has
neither**. `facetAllows()` refuses a null group against any named list, so a
`write` facet — however wide — would silently switch minting off. The two
cannot both hold, and the ruling chose minting. What bounds her writing is her
instruction, not the allowlist.

The read list is **derived** by `readableSlotGroups()`, never typed out, so
marking a slot hidden is the whole act. That is only lossless while no group
mixes `open` and `hidden` slots, which
`tests/unit/lib/app/content/slot-taxonomy.test.ts` asserts for any taxonomy —
not just today's.

**The cost, accepted with the ruling:** the same filter drops null-group slots,
so **she cannot read her own mints back**. The panel (t-73) reads by its own
path, not through `get_state`.

**The grant is operator-owned and filled once**, like 007's: created with its
config, and thereafter left alone — switched off, narrowed, widened or cleared.
So **a taxonomy change does not reach an existing grant**; widening is an admin's
act. Reconciling it on every seed would revert every narrowing an operator had
made, which is the worse failure (`fp4`).

### One turn writes a slot once

`framework_slot_value` is insert-only with no turn-scoped idempotency key, and a
turn that fails after its tool calls **may run again under the same id**
(`lib/app/agent/turn-record.ts`). The re-run calls the model on the same words,
it reaches the same reading, and a second version lands. One thing said once,
recorded twice, minutes apart. §8.1 says that must not happen.

`app_turn_slot_write` is the guard, and **the unique index IS the guard** —
`@@unique([turnId, slotSlug])`, the same shape as the turn claim, so two
dispatches cannot both miss it. A suppressed call answers with the version that
_was_ written, not an error: the reading is recorded, which is what the model
asked for. It carries `skipFollowup` too, or a suppressed write would cost a
model pass the real one did not.

**Not guarded, deliberately:** two `fill_slot` calls for one slug inside a single
attempt (a model calling a tool twice, not a retried turn — collapsing it would
drop a second reading meant as a correction), and any dispatch with no turn id
(a workflow step, the general consumer chat route), which runs exactly as before.

### The turn id reaches the capability through a carrier meant for something else

`CapabilityContext` has no turn id — Sunrise does not model a turn. But the chat
handler threads `request.costLogMetadata` into its dispatch context, the
dispatcher shallow-copies the context before `execute()`, and
`lib/app/agent/turns.ts` already puts `{ turnId, seat }` there. So it is
reachable today, through a **cost-attribution** channel.

That is a workaround and `turnIdFrom()` treats it as one: it validates with Zod
rather than casting, and an unusable value degrades to "no turn" instead of
throwing. Filed as
[`sunrise#822`](https://github.com/human-centric-engineering/sunrise/issues/822) —
the blobs for `lib/orchestration/capabilities/types.ts`,
`streaming-handler.ts` and `dispatcher.ts` are identical across all three tiers,
so Daybreak could not have fixed it (`daybreak.filing`). Our evidence on the
write side is commented on
[`daybreak#167`](https://github.com/human-centric-engineering/daybreak/issues/167)
and [`daybreak#156`](https://github.com/human-centric-engineering/daybreak/issues/156),
which is where the framework tier tracks run provenance on slot values.

### Mounting over Daybreak's capability costs one non-obvious line

`GuardedFillSlotCapability` **must re-declare `redactProvenance()`**, even to
delegate straight to `super`. `capabilityDispatcher.register()` refuses any
`processesPii` capability whose redactor it cannot see, and
`isRedactorOverridden()` asks `hasOwnProperty` of the _immediate_ prototype — an
inherited one does not count. That is deliberate upstream.

**The refusal is silent**: it is caught by the registration pass, logged as an
`UnknownError`, and the slug is simply absent, so she goes on searching normally
and quietly captures nothing. Nothing in `capture.ts` fails. What catches it is
the `lib/app/capabilities.ts` row in `tests/unit/lib/app/defaults.test.ts`,
which asserts the handler the dispatcher **actually holds** for the slug — and
it caught exactly this during t-72's build. Noted on `daybreak#167` for the
next fork.

### And she has to be left able to speak

`fill_slot` sets `skipFollowup`, so a silent capture does not cost a second
model pass. That is right for an agent that answers _and_ captures in one pass.
Hers does not: she is told to record before she answers, and the pinned model
obliges with a first pass carrying nothing but tool calls — with the follow-up
skipped, **that pass is the whole turn**, and someone who has just confided
something is answered with an empty string. Measured on a real turn, not
predicted.

`answering()` drops the flag on every return, so the turn always gets a pass in
which she speaks. It costs one extra model call on any turn she captures in —
the cost the owner accepted at claim ("each write also adds a tool pass to her
turn"). It is **not** fixed by rewording the instruction, which would make the
turn's correctness depend on a model choosing to emit text beside a tool call.

### She has to be able to SEE the taxonomy, or none of the above is true

**Granting `fill_slot` does not make her fill an authored slot.** Nothing in the
platform tells a model which slugs exist: the tool's advertised schema names one
example (`"primary_goal"`, not even in this taxonomy), `get_state` returns only
slots already filled so it cannot introduce an empty one, and Daybreak's module
context injects a module's slot _values_ — and this taxonomy hangs on no module
by design.

Measured on the first real turn of the capture smoke: told that someone had not
spoken to their brother since their father died, she minted
`family_communication` and used none of the 50 authored slots covering exactly
that. t-70's taxonomy and t-71's editor were both unreachable from the only path
that writes.

**And it was a data-protection gap, not a wasted feature.** Sensitivity is read
off the slot's _definition_, and masking fires only for `special_category`. A
minted slug has no definition ⇒ always `standard` ⇒ never masked. Nine slots
here are `special_category` — physical, emotional and spiritual health, i.e.
GDPR Art. 9 — so the classification was a no-op on the capture path and raw
health and belief prose was landing in `framework_slot_value.value`. Found by
`/security-review`; the cause was worse than the finding.

`lib/app/slots/vocabulary.ts` is the fix: the live taxonomy, one line per slot,
spliced into her facilitation block per turn. The same message now fills
`life_family_strain`, and an Art. 9 slug stores `<redacted: special_category>`.
Both are asserted in the smoke.

Four things about it worth knowing before you change it:

- **It is not in the tool schema, where it belongs.** `getCapabilityDefinitions()`
  advertises `ai_capability.functionDefinition` from the **database row**, and
  `syncFrameworkCapabilities()` projects that row from Daybreak's own registry
  and reconciles it on every boot. Our subclass wins the _dispatch_, never the
  _advertisement_, so a leaf cannot put the slugs in the schema. Asked for in
  [`daybreak#268`](https://github.com/human-centric-engineering/daybreak/issues/268),
  along with the mint-sensitivity default.
- **It rides in the voice contributor because a request carries one context
  tuple.** A second `registerContextContributor(FACILITATION_CONTEXT_TYPE, …)`
  would _replace_ her voice block, not add to it.
- **Facilitation only.** The admin `voice` path is what the voice comparison
  measures, so adding ~2,000 tokens to it would change what the golden set
  compares between runs.
- **Hidden slots are left out**, so she cannot fill `development`. The strict
  reading of §12 — putting a development scale's descriptions in her prompt is
  the first step toward her reasoning aloud about which rung someone is on.
  Whoever fills development decides how, with that risk in front of them.

**Inventing is the exception, and the rule travels with the list.** Owner
ruling, 21 Sept 2026: she may mint, but only on a strong case — genuinely
salient information with a real gap in the taxonomy — and the behaviour belongs
behind an admin setting we can switch off while we learn what it does (idea
#33). The rule is in her instructions _and_ beside the list, because that is
where a model weighing "does anything here fit?" is reading.

**The residual, accepted:** she can still mint, and a mint still cannot be
masked. That is inherent — an invented slug is unclassified, and the only
fail-safe default would redact every minted value into a sentinel. What reduces
it is her seeing the taxonomy; what would remove it is the admin setting.

### What proves the write

`HB9`: a value written where nobody can read it is indistinguishable from one
not written. t-73 closed that — "Her notes" below is the read surface, and it
is where a person sees the write happen inside the turn that made it. The
smoke stays, because it proves a different thing: the write itself, end to
end.

**`npm run smoke:app-slot-capture`** runs against the dev database, through the
real route, in a running app. It asserts
the value, its conversation, its confidence and its `sourceType`; that every
write reached the stream as a `capability_result`; that a forced-failed turn
re-run under the same id adds no version; and that the hidden group is withheld.

It cannot prove she captures the _right_ things at the right confidence. That is
her judgement, and the voice golden set measures it.

### After a change here

A changed grant or tool schema is dark until each database is reseeded **and the
server restarted** (`sunrise.mcp-reseed`). The dispatcher also caches an agent's
bindings for five minutes, so a fresh grant can be invisible for that long on a
process that had already resolved her.

## Her notes — the member surface (t-73)

**Locations:** `lib/app/slots/notes.ts` (the read and the correction) ·
`lib/app/slots/notes-query.ts` (search, filter and sort — pure, t-79) ·
`lib/app/slots/notes-view.ts` (the wire shape, and the one import-free module) ·
`lib/app/slots/notes-client.ts` (the browser's side) ·
`app/api/v1/app/notes/route.ts` · `app/(lelanea)/app/notes/page.tsx` ·
`components/app/notes/notes-panel.tsx` + `note-card.tsx` + `note-row.tsx` +
`notes-controls.tsx`

This is the other half of §3.3's pairing, and the answer to `HB9`: until it
landed, a value written where nobody could read it was indistinguishable from
one not written, and the only proof was a smoke script.

**Owner rulings, 21 September 2026.** It is **Lelañea's notes**, not a profile —
`/app/notes`, a **sixth nav destination** after "Your journey". The 15 September
ruling sent person-things to the account menu and this looked like one; it is
not, because a note appearing inside the turn that wrote it is the whole
demonstration and nobody witnesses that from inside a popover. And a note has
**two** doors: correct it, or take it back to her.

### The route

| Route                    | Does                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `GET /api/v1/app/notes`  | every current reading about the caller, flat, each with its group |
| `POST /api/v1/app/notes` | `{ slotSlug, value }` — a new version at `user_confirmed`         |

Both `withAuth` with `decidedBy: 'self'`, **never `'policy'`**: `subjectScope`
widens to `{}` for a platform admin, and on this endpoint that would hand an
operator the intimate record of whoever they were signed in beside. There is no
admin door to a member's notes here; an operator reads a slot value through the
admin values browser, which masks by default and audits a reveal.

`no-store`, because a note can land mid-turn and the point of the panel is that
it shows that. No per-flow rate cap — the `/api/v1/**` section tier covers a
small read and a single-row insert on the caller's own rows.

`GET` takes `q`, `group` and `sort` — see
[Finding your way around](#finding-your-way-around-t-79) below.

### Four guarantees, and where each one is enforced

**Hidden slots never leave the server.** Applied as a withholding of _values_,
before anything is shaped, so no later branch can put one back. And the check is
the **union of both tiers** — hidden in `framework_slot_definition` _or_ in
`app_slot_definition`. Those can disagree: `loadGlobalSlotDefinitions()`
withholds a row whose free-form classifier it cannot read, so a slot an admin
has hidden can have a stale projection or none. Either table alone leaves a case
where a development-stage reading reaches a member.

**A retired slot's notes are shown, labelled "no longer asked about", and not
correctable.** Retirement deletes nothing at either tier, so the answers are
still the person's; but filing a fresh reading against a question nobody will
ask again is a write nothing will read.

**An Art. 9 note cannot be corrected**, and this is the one worth reading twice.
`special_category` means masking-before-storage already replaced the reading
with a sentinel _at capture_. A correction runs through `appendSlotValue`, which is the raw
engine and masks nothing — so "let them fix it" would put raw health and belief
prose at rest through the one door built to keep it out, and masking the
correction instead would tell someone their words were kept when they were
discarded. Refused, with the remedy shipped beside it (`HB10`): _ask her about
it_, which routes the words back through the capture path where the masking
applies. The panel says what happened in a sentence rather than printing
`<redacted: special_category>`.

**An Art. 9 note's reasoning is withheld too** (t-80). Masking covers `value`
and nothing else — Daybreak's `fill_slot` passes the reasoning note straight to
`appendSlotValue` — and her instructions ask for that line as a paraphrase of
what the person said ([`voice.md`](./voice.md)). So the card printed the gist of
exactly the words it had just said were not kept. `getNotes()` now returns
`reasoningNote: null` for every `special_category` note, decided by the
classification (like `correctable`) rather than by whether the value happens to
be the sentinel, and before the search runs. The fold says the reasoning is not
shown. `previous` never carried reasoning.

**What this does not fix: the rows at rest.** An Art. 9 row still holds its
reasoning as written, so nothing on the page may say the words were not kept.
The copy says only that they are _left out of these notes_, which is true of
what is displayed. Masking the reasoning at capture, and what to do about rows
already written, are Daybreak's:
[`daybreak#269`](https://github.com/human-centric-engineering/daybreak/issues/269).
When that lands, the stronger wording can come back.

**A correction cannot mint.** The route refuses any slug with no head of the
caller's own — and refuses a hidden slug **with the same 404**, because
answering differently would disclose that one exists and is filled. Without
that rule the correction surface would double as an unbounded self-write.

### The contradiction is a door (§3.12)

`GET` carries `previous` — the version immediately before the head, or `null`.
The card shows it in a **fold**, closed by default, whose head carries the
previous reading's provenance — _"Before this · Lelañea inferred it, 20
September at 12:51"_ — so a reader can decide whether to open it without opening
it. Deliberately not a banner, a tone or an alert: the app has no opinion about
whether someone changed their mind, and dressing a second reading as a problem
teaches people that changing is a fault. It is folded rather than always open
because an open inset put the superseded reading in visual competition with the
current one, which gets the emphasis backwards.

**Several earlier versions: one is shown, the rest are counted** — _"· 2 older
readings as well"_ on the fold's head. §3.12 asks for the previous answer beside
the new one, not a changelog, and a card that unrolled six would bury the
reading the page is for. The count is `version - 1`: versions are monotonic and
nothing is deleted, so it needs no query and no API field. A full, expandable
history is a real history read, which is what `daybreak#156` blocks.

The read for it goes **straight to `framework_slot_value`**, because
`getSlotHeads()` returns current values only and Daybreak has no history read.
One query for the whole page (`version - 1` per head, batched), and our case is
commented on [`daybreak#156`](https://github.com/human-centric-engineering/daybreak/issues/156)
and [`daybreak#162`](https://github.com/human-centric-engineering/daybreak/issues/162).
Delete `readPreviousVersions()` when one lands.

### The register — owner rulings, 21 September 2026

Four rules, each from a screenshot of the running page, and each easy to undo
by someone reading the prototype or the persona doc instead of this.

- **Lelañea by name, never "she" or "her".** A panel that pronouns her
  throughout reads as somebody else describing her to you, and this is the one
  surface where the reader needs to know exactly who is making each claim. (The
  admin surfaces have the opposite rule — "the AI" — for the opposite reason.)
- **The reader is "you", never "they".** Which is why the taxonomy's own
  `description` — third person, written for a model — is not the card's head.
  It is quoted inside "How Lelañea came to this" as _what Lelañea was looking
  for_, where being third person is honest rather than the panel addressing the
  reader as "this person". The slug, humanised, is the card's tag instead.
- **Certainty is humble at every rung** — _Confident · Fairly sure · Not certain
  · Only a guess_. The top rung said "As certain as it gets", which the owner
  read as arrogant, and it was: the scale's ceiling is her judgement, not a fact.
- **The bands are hers.** **8–10 / 5–7 / 3–4 / 1–2**, following the bands her
  instructions tell her to write in (see [`voice.md`](./voice.md)), with her
  "inferred" band split in two for display. The first cut used 9 / 7 / 4 and
  showed a plainly-stated 8 as "Fairly sure" — found by `/pre-pr`'s
  docs-against-code step, which is the only reason it did not ship.

**And the same register one layer down, in what she writes.** A reading and its
reasoning note are read back by the person they are about, so her instructions
now say to write the reading **to** them and to make the reasoning a paraphrase
of what they did with the act named — said, mentioned, noticed, wondered. See
[`voice.md`](./voice.md#the-instructions-are-where-when-to-note-something-lives-t-72).

**"How Lelañea came to this" is a line of text, not a panel** (owner ruling, t-79):
a chevron and muted words, and when opened the detail sits beside a plain left
rule. "Before this" keeps its panel and its purple edge.

### Colour carries a fact, never decoration

Ten notches under the certainty words, the first N filled, in **green / amber /
purple / grey** by band — deliberately not green / amber / red, because red is
this palette's error hue and an uncertain reading is not an error. The bar is
`aria-hidden` and the words beside it say the same thing (WCAG 1.4.1), with a
test that the four bands keep four distinct words, since that is what the hidden
attribute relies on. The superseded fold takes the reflective purple as a left
edge; the Art. 9 card takes `Banner`'s info wash, because it is the one card that
says something about the record rather than about the person.

### Layout: the page is a column, the card is two

`View` gains an opt-in `column` (see [`shell.md`](./shell.md#adding-a-view)) that
centres the whole `<main>` at 54rem, so the head and the cards share one axis.
Inside each card the reading takes the main track and certainty, source and date
take an 11rem aside — they were one interpuncted sentence under the note because
there was nowhere else to put them. The split is a **container query**, the
repo's first: the card's width is set by the workspace pane, which a reader
drags, so a viewport breakpoint would split the columns on a 1400px window while
the pane was 320px wide. Both folds share one component and one `max-w-[27rem]`,
short of the reading, so they read as subordinate to it and cannot go ragged
against each other.

### Two cross-pane channels, both on `ShellLayoutProvider`

The conversation and the workspace are **siblings** and context flows downward
only, so both ride on the provider for `modulePlace`'s reason
([`shell.md`](./shell.md)). Neither is layout, and that is said at both ends.

- **`slotsWritten`** — a counter, incremented **once per turn that wrote**, read
  off `useConversation`'s `capabilities` list so a _refused_ `fill_slot` causes
  no refresh. A counter rather than a boolean (nowhere to go after the first
  turn) or a clock (two turns in one millisecond). The panel's first read is its
  mount, so a mount is never a refresh.
- **`ask` / `takeAsk`** — "Ask her about this" hands the note's question to the
  composer through the **same `insertAtCaret`** the microphone uses. Three rounds
  of review went into where those words land and whether focus is taken; a second
  path would get one of them wrong. `takeAsk` clearing to `null` is what lets the
  same words be handed over twice.

### Group headings are derived, and the order is not the taxonomy's

`life_areas` → `Life areas`: the key with underscores replaced and the first
letter raised, which reproduces five of the six authored titles exactly. The
bundled file's `title` is deliberately **not** read — once seeded the tables are
the taxonomy, and an upload can introduce a group the file never described.

Groups are ordered by that heading, alphabetically. **Not by `priorityWeight`**,
which looked tempting and is a borrowed rationale that does not transfer
(`fp5`): it is capture sequencing — what she should ask about soonest — and says
nothing about how a person wants to read their own record. Within a group the
order is `getSlotHeads`' own, freshest first, which is what puts the note she has
just written at the top of its group.

**Slugs she invented have `group: null`, not a magic key.** A mint has no
definition and therefore no group; a key standing in for "none" is a value that
eventually gets compared against a real one. They sort after every taxonomy
group, under "Lelañea's own headings". (The one place a stand-in exists is the
_query_ value `group=_own` — see below — and it is never stored or returned.)

#### A minted heading is permanent, and there is no suggestion step

Worth saying plainly, because the panel makes it look provisional and it is not.
**Nothing promotes a minted slug into the taxonomy.** She coins the name once, at
capture, and no later pass reviews it, renames it or proposes it to anybody — the
"propose a slot for approval" mode is the third of idea #33's three and is
deliberately not built here.

There **is** a path, and it is an admin's: adding a definition in the editor
whose `slug` is exactly the minted one. The slug is the join key, so every value
already captured under it resolves to that definition on the next read — the
notes leave "Lelañea's own headings" and appear under the group the admin chose,
with its wording, retrospectively. Nothing is migrated and nothing is rewritten.

The trap is the near miss. A definition added as `weekly_rhythms` leaves every
`weekly_rhythm` value exactly where it was, under a heading that now looks
duplicated. There is no fuzzy match, by design: the change rule above makes a
slug the identity, and guessing at one would orphan answers rather than adopt
them.

### Finding your way around (t-79)

A full profile is 50 open targeted slots across five groups plus her own
headings — long enough that "where did Lelañea write down the thing about my
brother" means scrolling. So the page gains a search, a group filter, a sort and
a list view. One PR, owner ruling 21 September 2026.

**The query surface.** `GET /api/v1/app/notes?q=&group=&sort=`, Zod-validated
(`notesQuerySchema`):

| Parameter | Accepts                                     | Notes                                                                     |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `q`       | trimmed, ≤ 200 characters                   | every word must appear; case and accents folded ("lelanea" → "Lelañea")   |
| `group`   | a group key, or `_own` for her own headings | `_own` cannot collide: a group key is a slug and starts with a letter     |
| `sort`    | `grouped` (default) · `recent`              | `recent` is one list, freshest first, each note labelled with its heading |

A malformed value is a 400. A well-formed `group` nobody has notes under —
**hidden or nonexistent — gets the same empty answer, byte for byte**, since
answering differently would disclose that a hidden group exists. Unknown
parameters are dropped, so the page's own `view` can ride in the same link.

**The response is flat.** `{ notes, groups, own, total, matched }`: each note
carries its `group`, `groups` and `own` count the groups in use **before**
filtering (so an option never vanishes as someone narrows), `total` is the whole
record and `matched` what the query kept. It replaced the grouped shape outright
— the panel was its only reader, `recent` has no groups to put notes in, and two
shapes would have been two readers to keep in step. `notes` arrives in display
order; the panel groups consecutive runs and never re-sorts.

**It is an in-memory query, not SQL — and that is the guardrail.** `getNotes()`
already loads every current note for the person and drops hidden slots before
anything is shaped. `queryNotes()` is one pure function over what it returned, so
hidden slots are still removed in **exactly one place** and no query path can
reach one. `ILIKE` would have needed a new query repeating the both-tiers hidden
check and the Art. 9 exclusion in SQL, joined across three tables — a second
copy of the guardrail that can drift from the first. At 50–70 notes the list is
a few kilobytes already in memory. **Revisit if one person passes a few hundred
notes.** No pagination either: hiding half someone's record behind a control is
a worse answer to §3.19 than a long page.

**What a search matches.** The reading, how Lelañea came to it, what she was
looking for, the tag and the heading. **An Art. 9 note matches on the slot's
wording only — never the sentinel, never the reasoning.** Daybreak's `fill_slot`
masks `value` and nothing else, so the reasoning note is stored as written
([`daybreak#269`](https://github.com/human-centric-engineering/daybreak/issues/269));
matching it would answer "is there a health note mentioning X?" about words the
page does not show. Since t-80 `getNotes()` withholds that line before the
search sees it, so this is the second of two. The previous
version is not searched: a match has to be visible in the row it produced.

**The search text is never logged.** The route logs counts, whether a search
and a filter were on, and the sort — never what was looked for. **And it
overrides `url` on its logger**: `getRouteLogger` puts `url: request.url`,
query string included, on every entry's context, so a clean payload alone still
logged each search beside the user id. Found by `/security-review`; the GET
logs the path instead. Any other route taking personal text in a query string
has the same exposure — the platform-level fix is `getRequestContext` logging
the path, which is Sunrise's to make.

**The page.** Every control is in the URL with defaults left out, so a filtered
view can be linked and a reload lands where the reader was. Typing **replaces**
the history entry after a 300ms pause; a group, sort or view change **pushes**
one, so Back steps through choices. `view=cards|list` is the page's alone — the
same response drawn two ways, so switching re-reads nothing. When a turn writes,
the panel re-reads with the current filters, and the stale-response guard still
applies.

**Every navigation is built from the URL last asked for, never the one on
screen.** On this route `useSearchParams` moves only when a navigation commits,
a server round trip later, and the reader goes on typing and clicking
meanwhile. Three `/code-review` rounds found the same defect three ways, each a
navigation built from the committed URL while a newer one was in flight: lost
keystrokes, a group pick undone by a late search, and a filter Clear had removed
coming back. So the panel keeps `target` (the last query string it asked for)
and `sent` (those not yet seen commit, oldest first). A committed URL found in
`sent` is its own echo and changes nothing; one not found — Back, a link — is
the reader going elsewhere, and the box and `target` follow it. The test fake
holds navigations back to prove each case.

The controls are two lines at most — the search, then a group select, a sort
select and a Cards/List pair — because on a narrow pane every row of chrome
pushes the reading down. Selects rather than chip rows: five groups as chips
wrap to three lines at 320px.

**A list row (owner ruling)** is the full reading plus one line of details —
heading (when sorted by recency), tag, certainty, date — and no buttons. The
whole row is the control: it opens the full card in place, where correcting and
"Ask Lelañea about this" work as ever.

**Every note folds and opens by a chevron, in both views (owner ruling).** A row
carries one pointing down; a card's whole header — the eyebrow row, run out to
the card's edges, with a chevron pointing up at its end — is one `<button>`
that folds it to its row, so a click anywhere along the top of a card closes
it. The view only sets the default — all open in cards,
all folded in a list — and a chevron overrides it for that note until the view
changes. Focus follows the note into its new shape. The first cut had a "Back to
the list" button on an opened card instead, which read as navigation and only
existed in one view. Folds survive a re-read, so a card someone just corrected
does not snap shut.

**The page is drawn in the sort it was answered in**, not the one the URL has
just moved to. Between choosing a new sort and its answer landing, the notes on
screen are still the old response; grouping a `recent` list split each heading
into several runs — the same heading twice, and duplicate React keys. Found by
the owner looking at the page.

**No matches is its own message** — _"Nothing in Lelañea's notes matches that"_
with a clear — distinct from a new account's _"Lelañea has written nothing down
yet"_, which gets no controls at all.

**To look at it with a real record**, `npx tsx --env-file=.env.local
scripts/db/seed-dev-notes.ts <email>` replaces that account's slot values with a
fortnight's worth: every visible group, a corrected and a twice-revised note,
two Art. 9 notes (sentinel value, unmasked reasoning — the case search must not
match), two of her own headings and one hidden development note that must never
appear. Dev only; nothing runs it.

### What a person is not shown

- **The conversation id.** The panel says a note was _drawn from something you
  said in conversation_ and stops there. There is no member-facing route that
  opens one exchange yet — the journey view is still a placeholder — and a link
  to nowhere, or a cuid printed as evidence, would both be worse. When the
  journey lands, that line becomes the link.
- **Anything about another person**, obviously; and no log line here carries a
  slug or a value, because a minted slug is model-authored free text drawn from
  what the person said and durable app logs are not erasure-covered — the same
  reasoning `capture.ts` gives for its own.

## What is not here yet

- **Deleting one note.** There is no per-answer deletion at any tier: erasure
  takes the account or nothing. Filed as **t-78 on `f-memory`**, which owns
  deletion propagation — deleting the reading is the easy half, and the
  embedding that carries it is the reason it hangs there rather than here. The
  framework half is a paragraph on
  [`daybreak#156`](https://github.com/human-centric-engineering/daybreak/issues/156),
  offered rather than assumed: `values.ts` is insert-only by design, and whether
  it should expose a removal is a product decision as much as an API one.
- **Admin control over minting** — whether she may invent a slot at all, against
  admin-authored guidance, or only by proposing one for approval. Owner ruling
  20 Sept 2026 that this should be a three-mode setting; captured as its own
  feature rather than built here.
