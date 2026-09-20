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

**Do not read "row withheld" as "slot retired" — it depends on what survived.**
A stored row whose free-form classifier the framework does not recognise is
dropped rather than passed on. If other rows survived, the sync deactivates that
slug's projection and the slot stops being asked: fail-closed, which is what we
want. If **every** row was withheld, the sync reads the empty provider as a
fluke, opens no transaction, and every stale projection stays **active** — the
slots keep being asked under their old wording. That is the fail-**open** case,
and `loadGlobalSlotDefinitions()` logs it distinctly for exactly that reason.

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

## What is not here yet

- **The editor** — t-71. Adding, rewording and retiring a definition, and seeing
  every past version. `changedDefinitionFields()` is here for it — it is the
  executable form of the change rule above — but the read and write paths are
  not, deliberately: the editor's list needs the revision join, and guessing at
  that shape now would have shipped an API t-71 then had to change.

  **Name its reader carefully.** `lib/framework/data-slots/queries.ts` already
  exports a `listSlotDefinitions()`, reachable from the framework barrel, and it
  reads `framework_slot_definition` — the projection, with no history and no
  way to tell _our_ retirement from a deactivation. A leaf function by that name
  is one import away from being the wrong one. An earlier draft of this task had
  exactly that collision; `/code-review` removed it.

- **Capture** — t-72. `fill_slot` writing a value with its provenance and
  confidence, once per turn.
- **The panel** — where the picture assembles for the person it is about.
