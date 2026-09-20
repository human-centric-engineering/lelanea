# The slot taxonomy — what the app aims to learn, as data

What Lelañea learns about a person is a **slot value**; what she is looking for
is a **slot definition**. This document is about the second: where the taxonomy
lives, how it changes, and how an answer given months ago is read back against
the words it was actually captured under.

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
directions**: a development slot that became `open` would reach a member's
profile panel, and an unrelated slot that became `hidden` would be withheld from
the person it is about for no reason.

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
paths) · `app/api/v1/admin/app/slots/**` (six handlers) ·
`app/admin/app/slots/page.tsx` + `components/app/admin/slot-definitions.tsx`

| Route                           | Does                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| `GET /api/v1/admin/app/slots`   | every definition, **retired included**, plus the group keys in use |
| `POST /api/v1/admin/app/slots`  | add one, at v1                                                     |
| `PUT .../slots/[slug]`          | reword one                                                         |
| `PUT .../slots/[slug]/active`   | retire or restore                                                  |
| `GET .../slots/[slug]/history`  | every past version, newest first                                   |
| `POST .../slots/upload/preview` | what a file would do                                               |
| `POST .../slots/upload`         | do it                                                              |

All `withAdminAuth`. Rate limiting is the `admin` section tier in `proxy.ts`;
no handler adds a per-flow cap, including the upload — it is bounded by the
taxonomy's size and is a no-op on a repeat.

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

### What an admin cannot do here, and why the surface says so

- **Edit a slug.** Shown, disabled, with the remedy beside it. The routes refuse
  a `slug` in the body rather than ignoring it: someone who thought they were
  renaming a slot has to be told they were not, or they will believe the old
  answers followed.
- **Delete anything.** There is no `DELETE` on any route. "Retire" is the word
  on the button, retired rows stay on the page, and Restore is one click.
- **Choose `mode`.** Never offered; every row is written `targeted`.

## What is not here yet

- **Capture** — t-72. `fill_slot` writing a value with its provenance and
  confidence, once per turn.
- **The panel** — where the picture assembles for the person it is about.
