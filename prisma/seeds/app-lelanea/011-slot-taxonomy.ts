/**
 * The slot taxonomy, moved into the tables an admin edits — once (f-slots t-70).
 *
 * Fills `app_slot_definition` and its v1 history from the bundled
 * `seed-data/drafted/lelanea_slot_taxonomy.json`, then asks Daybreak's global slot sync
 * to project the result into `framework_slot_definition` as `scope = global`.
 *
 * ## The rows this writes, and who owns them (`fp4`)
 *
 * **Operator-owned.** Written once, while the table is empty, and never again.
 * Emptiness is the marker because the definitions and their revisions land in
 * one transaction: any row present means this has run, whatever an admin has
 * done since. So a re-run after an admin **retired** a slot does not revive it,
 * and one after an admin **reworded** a description does not undo the edit — a
 * per-slug "create if absent" would get the first of those wrong, since a
 * retired row is still a row.
 *
 * A slot later added to the file therefore does not reach a seeded database.
 * That is deliberate: once seeded, the tables are the taxonomy and the editor
 * (t-71) is how a slot is added. The file is not a fallback at read time —
 * `lib/app/slots/taxonomy-store.ts` explains why it must not be.
 *
 * **Safe on empty.** This unit only ever adds rows — it has no removal pass at
 * all. The tier below is safe on empty too, but that is Daybreak's behaviour
 * rather than ours to assert: it is pinned as *"an empty provider on a fluke
 * boot leaves every global row active"* in
 * `tests/integration/lib/framework/data-slots/global-slots.test.ts`. Cite that
 * case rather than restating what `sync.ts` does — every prose restatement of
 * this contract in this feature has turned out to be wrong somewhere.
 *
 * **Idempotent** in the only sense that is reachable: if this unit runs again it
 * reads one row and writes none. Note that "runs again" is rarer than it sounds
 * — `prisma/runner.ts` skips any unit whose source hash matches its
 * `SeedHistory` row, and this one declares no `hashInputs`, so on a database it
 * has already applied to, `db:seed` never enters `run()` at all. Only editing
 * THIS FILE, or `db:reset`, brings it back.
 *
 * **So re-seeding is not how a lost projection is repaired**, whatever it looks
 * like from the outside. If `framework_slot_definition` loses its global rows —
 * restored from an older dump, say — `db:seed` prints `unchanged, skipping` and
 * changes nothing. What repairs it is a **server boot**, whose
 * `syncRegisteredSlotDefinitions()` runs the same global pass, or `db:reset`.
 * An earlier version of this docblock claimed the repair, and `/code-review`
 * caught that the runner makes it unreachable.
 *
 * ## Why it calls the sync itself
 *
 * On a fresh database `prisma/seeds/_framework/000-framework-boot.ts` runs
 * BEFORE this unit (see its docblock on the `_framework/` ordering), so the
 * boot-time global pass finds an empty table and correctly writes nothing.
 * Without the call below, `framework_slot_definition` would hold no global row
 * until the next server boot — and `db:reset` in CI never boots a server. The
 * seam exists to be called again when the source changes (t-69); the seed
 * changing it is the first such caller.
 *
 * The provider is registered here rather than relied on, for the same reason:
 * `000-framework-boot.ts` is skipped on an incremental `db:seed`, so on an
 * existing dev database nothing has registered it and the sync below would find
 * `no_provider` and write nothing. `initLeafApp()` is the registration and is a
 * pure, idempotent one (its own docblock requires that of everything in it), so
 * calling it directly is enough. NOT `syncFrameworkForSeed()`, which
 * `001-journey-map.ts` needs because it depends on framework `Module` rows: this
 * unit depends on none, and the heavier call adds its documented
 * `duplicate slug — last registration wins` warnings to every seed run for
 * nothing.
 *
 * No `hashInputs` over the JSON, deliberately. Editing the file must not
 * re-run a unit that short-circuits on a seeded database — it would read one
 * row and do nothing, while implying the edit had landed.
 *
 * @see lib/app/content/slot-taxonomy.ts — the bundled file
 * @see lib/app/slots/taxonomy-store.ts — the provider the sync calls
 * @see .context/app/slots.md
 */

import type { SeedUnit } from '@/prisma/runner';
import { getSlotTaxonomy } from '@/lib/app/content/slot-taxonomy';
import { SLOT_DEFINITION_FIELDS } from '@/lib/app/slots/taxonomy-store';
import { initLeafApp } from '@/lib/app/leaf-bootstrap';
import { syncGlobalSlotDefinitions } from '@/lib/framework/data-slots';

const unit: SeedUnit = {
  name: 'app-lelanea/011-slot-taxonomy',
  async run({ prisma, logger }) {
    // Registers the global slot provider the sync at the bottom reads. See the
    // docblock: the boot unit that would otherwise have done it is skipped on an
    // incremental seed.
    await initLeafApp();

    const existing = await prisma.appSlotDefinition.findFirst({
      select: { slug: true },
    });
    // "We actually created rows", not "the table was empty" — with a file that
    // declares no slots the two differ, and only the first makes a non-`synced`
    // sync status a failure. The shipped file is schema-guarded non-empty, so
    // this is belt-and-braces; it is also what stops the guard below firing on
    // a state where nothing is wrong.
    let wroteDefinitions = false;
    if (existing) {
      const [total, active] = await Promise.all([
        prisma.appSlotDefinition.count(),
        prisma.appSlotDefinition.count({ where: { isActive: true } }),
      ]);
      logger.info(
        `⏭  Slot taxonomy already in the database (${total} definitions, ${active} active); left as they are`
      );
    } else {
      const file = getSlotTaxonomy();
      const now = new Date();

      await prisma.$transaction([
        prisma.appSlotDefinition.createMany({
          data: file.slots.map((slot) => ({
            slug: slot.slug,
            group: slot.group,
            description: slot.description,
            visibility: slot.visibility,
            mode: slot.mode,
            dataType: slot.dataType,
            sensitivity: slot.sensitivity,
            priorityWeight: slot.priorityWeight,
            isActive: true,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })),
          skipDuplicates: true,
        }),
        prisma.appSlotDefinitionRevision.createMany({
          data: file.slots.map((slot) => ({
            slotSlug: slot.slug,
            version: 1,
            group: slot.group,
            description: slot.description,
            visibility: slot.visibility,
            mode: slot.mode,
            dataType: slot.dataType,
            sensitivity: slot.sensitivity,
            priorityWeight: slot.priorityWeight,
            isActive: true,
            // Against nothing, everything is new. The editor's history view
            // reads v1 as the creation rather than as a change to eight fields.
            changedFields: [...SLOT_DEFINITION_FIELDS],
            origin: 'seed' as const,
            // The operator wrote this, not a person. `origin` is what says so —
            // a null `editorId` alone would be ambiguous with an erased admin.
            editorId: null,
            changedAt: now,
          })),
          skipDuplicates: true,
        }),
      ]);

      wroteDefinitions = file.slots.length > 0;
      const hidden = file.slots.filter((s) => s.visibility === 'hidden').length;
      logger.info(
        `🧬 Seeded the slot taxonomy: ${file.slots.length} definitions in ${file.groups.length} groups (${hidden} hidden), each at v1 (${file.taxonomy.provenance.status})`
      );
    }

    // Project into `framework_slot_definition`. On a fresh seed this is the call
    // that makes the taxonomy reachable at all: the boot pass already ran, one
    // unit earlier, against a table that was still empty.
    const result = await syncGlobalSlotDefinitions();
    if (result.status === 'synced') {
      logger.info(
        `🔗 Global slot sync: ${result.provided} provided, ${result.created} created, ${result.updated} updated, ${result.deactivated} deactivated`
      );
      return;
    }

    // Anything else means the definitions we just wrote reached no agent, and a
    // seed that records success in that state is the exact silent failure this
    // call exists to prevent — the taxonomy would be absent with nothing saying
    // so until someone noticed she was asking nothing. A THROW, not a warning:
    // an unthrown status lets the runner stamp `SeedHistory`, after which this
    // unit is skipped forever and the repair never runs.
    //
    // Only on the path that wrote rows. On the skip path `empty` is reachable
    // without anything being wrong — an admin who has retired every slot — and
    // the framework's own safe-on-empty note says that last retirement is not
    // propagated.
    if (wroteDefinitions) {
      throw new Error(
        `Global slot sync returned "${result.status}" after seeding the taxonomy: ` +
          'the definitions were written but no framework projection was made, so ' +
          'nothing can read them. Check that lib/app/leaf-bootstrap.ts still ' +
          'registers the global slot definition provider.'
      );
    }
    logger.warn(`🔗 Global slot sync: nothing written (${result.status})`);
  },
};

export default unit;
